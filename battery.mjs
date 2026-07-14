// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { spawn } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { SurfaceDial } from './dialdevice.mjs'
import { Log } from './log.mjs'

// Reports the Surface Dial's battery level. The dial does NOT expose battery over HID - only
// over BLE GATT (Battery Service 0x180F). BlueZ's battery plugin already caches that value and
// exposes it on D-Bus as org.bluez.Battery1.Percentage, so we just read that property with
// busctl. This is entirely separate from the passive HCI-monitor input path in dialdevice.mjs.
//
// The read is low-priority and time-insensitive and MUST never delay dial input: everything
// here is async (subprocesses via spawn, sysfs via fs/promises) so the event loop stays free to
// dispatch button/rotation events. The only synchronous work is scheduling one setTimeout.
export class Battery {
  #config
  #emit
  #lastPercent
  #devPath      // cached BlueZ object path, eg. /org/bluez/hci0/dev_70_BC_10_87_BF_6F
  #connectMac   // MAC reported by the monitor helper on connect (preferred over sysfs discovery)
  #connected = false
  #pendingTimer
  #reading = false

  // emit(percent) is called with an integer 0-100 whenever a fresh reading is obtained
  constructor(config = {}, emit) {
    this.#config = config
    this.#emit = emit
  }

  // called on dial CONNECT - read now, retrying until it succeeds. The battery only becomes
  // readable once BlueZ has resolved the dial's GATT services (~1.5s), so rather than guess a
  // fixed delay we just retry until org.bluez.Battery1 answers (or we disconnect).
  onConnect(mac) {
    if (mac) this.#connectMac = mac
    this.#connected = true
    clearTimeout(this.#pendingTimer)
    this.#pendingTimer = undefined
    this.#read()
  }

  // called on dial DISCONNECT - stop retrying so we don't poll a device that's gone
  onDisconnect() {
    this.#connected = false
    clearTimeout(this.#pendingTimer)
    this.#pendingTimer = undefined
  }

  // last known percentage (undefined until the first successful read), for pushing to new clients
  lastPercent() {
    return this.#lastPercent
  }

  // retry the read while still connected (Battery1 not resolved yet, or a transient failure)
  #scheduleRetry() {
    if (!this.#connected || this.#pendingTimer) return
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = undefined
      this.#read()
    }, this.#config.batteryRetryTime || 2000)
  }

  async #read() {
    if (this.#reading) return // never pile up reads
    this.#reading = true
    try {
      if (!this.#devPath) this.#devPath = await this.#resolveDevPath()

      // --json gives a stable, structured result ({"type":"y","data":96}) instead of the
      // human-oriented "y 96" text, so parsing can't drift with busctl's pretty-printing.
      const out = this.#devPath && await this.#run('busctl',
        ['--json=short', 'get-property', 'org.bluez', this.#devPath, 'org.bluez.Battery1', 'Percentage'])

      const percent = out ? this.#parsePercentage(out) : undefined
      if (percent === undefined) {
        // Battery1 isn't resolved yet (early in the connect) or a transient miss - try again
        Log.debug('battery: not readable yet, will retry')
        this.#scheduleRetry()
        return
      }

      this.#lastPercent = percent
      Log.verbose('battery:', percent)
      if (this.#emit) this.#emit(percent)
    } catch (error) {
      Log.debug('battery read failed:', error.message)
      this.#scheduleRetry()
    } finally {
      this.#reading = false
    }
  }

  // resolve the dial's BlueZ object path. Discover the MAC from the existing HID/hidraw stack
  // (async), then match it against the BlueZ object tree so the hci index isn't hardcoded.
  async #resolveDevPath() {
    const fragment = await this.#deviceFragment()
    if (!fragment) return undefined

    const tree = await this.#run('busctl', ['tree', 'org.bluez'])
    const re = /\/org\/bluez\/hci\d+\/dev_[0-9A-Fa-f_]+/g
    for (const line of tree.split('\n')) {
      const matches = line.match(re)
      if (matches) {
        for (const path of matches) {
          if (path.endsWith('/' + fragment)) return path
        }
      }
    }
    return undefined
  }

  // build the dev_XX_XX.. object-path fragment. Prefer the MAC the monitor helper discovered on
  // connect, then fall back to sniffing it from sysfs.
  async #deviceFragment() {
    let mac = this.#connectMac || await this.#discoverMac()
    if (!mac) return undefined
    mac = mac.replace(/^dev_/i, '')
    return 'dev_' + mac.toUpperCase().replace(/[:-]/g, '_')
  }

  // Fallback MAC discovery when the monitor-reported MAC isn't available yet: read the dial's
  // Bluetooth MAC from the (still-present) hidraw uevent (HID_UNIQ). Fully async.
  async #discoverMac() {
    const base = '/sys/class/hidraw'
    let entries
    try {
      entries = await readdir(base)
    } catch (error) {
      Log.debug('battery: cannot read', base, error.message)
      return undefined
    }

    for (const entry of entries) {
      try {
        const uevent = await readFile(`${base}/${entry}/device/uevent`, 'utf8')
        const fields = {}
        for (const line of uevent.split('\n')) {
          const i = line.indexOf('=')
          if (i > 0) fields[line.slice(0, i)] = line.slice(i + 1).trim()
        }

        // HID_ID is BUS:VVVVVVVV:PPPPPPPP eg. 0005:0000045E:0000091B
        const id = (fields.HID_ID || '').split(':')
        if (id.length === 3 &&
            parseInt(id[1], 16) === SurfaceDial.vid &&
            parseInt(id[2], 16) === SurfaceDial.pid &&
            fields.HID_UNIQ) {
          return fields.HID_UNIQ
        }
      } catch {
        // not the dial or transient - skip this node
      }
    }
    return undefined
  }

  // parse busctl --json output ({"type":"y","data":96}) and validate 0-100
  #parsePercentage(out) {
    try {
      const n = JSON.parse(out).data
      return (Number.isInteger(n) && n >= 0 && n <= 100) ? n : undefined
    } catch {
      return undefined
    }
  }

  // run a command and resolve its stdout. Async spawn only - never *Sync - so it can't block
  // the event loop and delay dial input.
  #run(cmd, args) {
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const child = spawn(cmd, args)
      child.stdout.on('data', d => stdout += d)
      child.stderr.on('data', d => stderr += d)
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`))
      })
    })
  }
}
