// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { spawn } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { SurfaceDial } from './dialdevice.mjs'
import { Log } from './log.mjs'

// Reports the Surface Dial's battery level. The dial does NOT expose battery over HID - only
// over BLE GATT (Battery Service 0x180F). BlueZ's battery plugin already caches that value and
// exposes it on D-Bus as org.bluez.Battery1.Percentage, so we just read that property with
// busctl. This is entirely separate from the node-hid/hidraw transport and the udev reconnect
// path.
//
// The read is low-priority and time-insensitive and MUST never delay dial input: everything
// here is async (subprocesses via spawn, sysfs via fs/promises) so the event loop stays free to
// dispatch button/rotation events. The only synchronous work is scheduling one setTimeout.
export class Battery {
  #config
  #emit
  #lastPercent
  #devPath      // cached BlueZ object path, eg. /org/bluez/hci0/dev_70_BC_10_87_BF_6F
  #pendingTimer
  #reading = false

  // emit(percent) is called with an integer 0-100 whenever a fresh reading is obtained
  constructor(config = {}, emit) {
    this.#config = config
    this.#emit = emit
  }

  // called on dial CONNECT - schedule a deferred read. The delay lets BlueZ finish
  // ServicesResolved and keeps the work clear of the reconnect wake-up flush window.
  onConnect() {
    clearTimeout(this.#pendingTimer)
    this.#pendingTimer = setTimeout(() => this.#read(), this.#config.batteryReadDelay || 15000)
  }

  // called on dial DISCONNECT - cancel a pending read so a disconnect inside the delay
  // window doesn't try to read a device that's no longer there
  onDisconnect() {
    clearTimeout(this.#pendingTimer)
    this.#pendingTimer = undefined
  }

  // last known percentage (undefined until the first successful read), for pushing to new clients
  lastPercent() {
    return this.#lastPercent
  }

  async #read() {
    if (this.#reading) return // never pile up reads
    this.#reading = true
    try {
      if (!this.#devPath) this.#devPath = await this.#resolveDevPath()
      if (!this.#devPath) {
        Log.debug('battery: could not resolve BlueZ device path')
        return
      }

      const out = await this.#run('busctl',
        ['get-property', 'org.bluez', this.#devPath, 'org.bluez.Battery1', 'Percentage'])

      const percent = this.#parsePercentage(out)
      if (percent === undefined) {
        Log.debug('battery: could not parse percentage from:', out.trim())
        return
      }

      this.#lastPercent = percent
      Log.verbose('battery:', percent)
      if (this.#emit) this.#emit(percent)
    } catch (error) {
      // low-priority and best-effort: log and wait for the next reconnect, never retry aggressively
      Log.debug('battery read failed:', error.message)
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

  // build the dev_XX_XX.. object-path fragment from --mac or from sysfs discovery
  async #deviceFragment() {
    let mac = this.#config.mac || await this.#discoverMac()
    if (!mac) return undefined
    mac = mac.replace(/^dev_/i, '')
    return 'dev_' + mac.toUpperCase().replace(/[:-]/g, '_')
  }

  // find the dial's Bluetooth MAC via the hidraw uevent (HID_UNIQ). Fully async - no
  // synchronous node-hid enumeration on the event loop.
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

  // busctl prints a variant like "y 96"; pull the trailing integer and validate 0-100
  #parsePercentage(out) {
    const m = out.trim().match(/(\d+)\s*$/)
    if (!m) return undefined
    const n = parseInt(m[1], 10)
    return (n >= 0 && n <= 100) ? n : undefined
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
