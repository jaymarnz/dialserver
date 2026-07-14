// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { spawn } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { Log } from './log.mjs'

// Passive fast-path input source for the Surface Dial.
//
// We do NOT read the dial over HID/hidraw. After an idle BLE drop the dial re-advertises on the
// next touch, and BlueZ then spends ~1.35 s rebuilding the HID-over-GATT device before hidraw
// delivers anything - that delay was the whole UX problem. The dial's rotation/button
// notifications are actually on the air ~200 ms after the link comes up; they're just withheld by
// that rebuild. So instead we run a tiny privileged helper (`dialmon`) that passively reads the
// kernel HCI monitor channel (the decrypted view `btmon` uses) and forwards the input
// notifications immediately, without touching the BlueZ-managed connection. See
// devdocs/reconnect-speedup-plan.md for the full investigation.
//
// The helper prints line-delimited events on stdout:
//   C <MAC>          connected
//   D                disconnected
//   N <hexpayload>   input report value (no report-id prefix)
// Input report payload decode: button = data[0] & 0x01, rotation = int16LE(data[1..2]).

// Kept for battery.mjs, which still locates the dial's MAC from the (still-present) hidraw
// sysfs node by vendor/product id. We simply never open that node ourselves anymore.
export const SurfaceDial = {
  vid: 0x045e,
  pid: 0x091b
}

export const EventType = {
  BUTTON: 1,
  ROTATE: 2,
  CONNECT: 3,
  DISCONNECT: 4,
}

export const Button = {
  UP: 0,
  DOWN: 1
}

export class DialDevice {
  static #instance // Singleton instance

  #config
  #eventFunc
  #helper
  #target        // the MAC we tell dialmon to watch (or the literal 'auto')
  #buffer = ''
  #buttonDown = false
  #stopping = false
  #respawnTimer

  constructor(eventFunc, config = {}) {
    this.#eventFunc = eventFunc
    this.#config = config
    DialDevice.#instance = this
  }

  run() {
    this.#startWhenReady()
    return this
  }

  // Auto-discover the bonded Surface Dial's MAC by vendor/product so dialmon filters strictly on
  // a real device identity rather than a coincidental ATT handle - the dial is identified with no
  // configuration. If no dial is bonded there's nothing to do (the user has no dial or hasn't
  // paired it yet): rather than exit - which would just crash-loop under systemd - we keep the
  // WebSocket server up (reporting disconnected) and re-check periodically so pairing later
  // "just works". (dialmon itself still accepts a MAC or 'auto' argument for manual/debug use.)
  async #startWhenReady() {
    if (this.#stopping) return

    const mac = await this.#discoverBondedDialMac()
    if (mac) {
      this.#target = mac
      Log.debug('DialDevice discovered bonded Surface Dial', mac)
      this.#spawnHelper()
    } else {
      const wait = this.#config.dialDiscoveryPollTime || 30000
      Log.error(`No bonded Surface Dial (${this.#hex(SurfaceDial.vid)}:${this.#hex(SurfaceDial.pid)}) ` +
                `found - pair one with bluetoothctl. Rechecking in ${wait / 1000}s.`)
      setTimeout(() => this.#startWhenReady(), wait)
    }
  }

  // Find the bonded Surface Dial's MAC from BlueZ's on-disk bond files. Each bonded device is a
  // dir named by its MAC containing an `info` file whose [DeviceID] carries the (decimal)
  // vendor/product - a reliable device identity that works even while the dial is disconnected.
  async #discoverBondedDialMac() {
    const base = '/var/lib/bluetooth'
    const isMac = (s) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(s)
    let adapters
    try {
      adapters = await readdir(base)
    } catch (error) {
      Log.debug('DialDevice cannot read', base, '-', error.message)
      return undefined
    }
    for (const adapter of adapters) {
      if (!isMac(adapter)) continue
      let devices
      try { devices = await readdir(`${base}/${adapter}`) } catch { continue }
      for (const dev of devices) {
        if (!isMac(dev)) continue
        try {
          const info = await readFile(`${base}/${adapter}/${dev}/info`, 'utf8')
          if (this.#isDial(info)) return dev.toUpperCase()
        } catch {
          // not readable / no info file - skip
        }
      }
    }
    return undefined
  }

  // does a bond `info` file's [DeviceID] identify the Surface Dial? (Vendor/Product are decimal)
  #isDial(info) {
    const section = (info.match(/\[DeviceID\]([\s\S]*?)(?=\n\[|\s*$)/) || [, info])[1]
    const vendor = /Vendor=(\d+)/.exec(section)
    const product = /Product=(\d+)/.exec(section)
    return !!vendor && !!product &&
           parseInt(vendor[1], 10) === SurfaceDial.vid &&
           parseInt(product[1], 10) === SurfaceDial.pid
  }

  #hex(n) { return '0x' + n.toString(16).padStart(4, '0') }

  #spawnHelper() {
    const bin = this.#config.dialmonPath || fileURLToPath(new URL('./dialmon', import.meta.url))
    const target = this.#target || 'auto'
    const handle = this.#config.inputHandle || '0x001a'
    Log.debug(`DialDevice spawning ${bin} ${target} ${handle}`)

    this.#helper = spawn(bin, [target, handle], { stdio: ['ignore', 'pipe', 'pipe'] })

    this.#helper.on('error', (err) => {
      Log.error('dialmon spawn error:', err.message)
      this.#scheduleRespawn()
    })
    this.#helper.stderr.on('data', (d) => Log.debug('dialmon:', d.toString().trim()))
    this.#helper.stdout.on('data', (chunk) => this.#onData(chunk))
    this.#helper.on('exit', (code, signal) => {
      if (this.#stopping) { Log.debug('dialmon stopped'); return }
      Log.error(`dialmon exited (code=${code} signal=${signal})`)
      // a lost helper means we also lost the connection state
      if (this.#buttonDown) this.#buttonDown = false
      this.#scheduleRespawn()
    })
  }

  // supervise the helper: never leave it dead. Backoff avoids a tight crash loop.
  #scheduleRespawn() {
    if (this.#stopping || this.#respawnTimer) return
    this.#respawnTimer = setTimeout(() => {
      this.#respawnTimer = undefined
      if (!this.#stopping) this.#spawnHelper()
    }, this.#config.dialmonRespawnTime || 1000)
  }

  // Stop the helper and cancel any pending respawn. Idempotent. Used on shutdown so a directly-run
  // instance (not under systemd) doesn't orphan dialmon on Ctrl+C. Under systemd this is redundant
  // with the cgroup kill and harmless: kill() on an already-signalled/exited child returns false
  // rather than throwing, so the two "stoppers" can't conflict.
  stop() {
    this.#stopping = true
    clearTimeout(this.#respawnTimer)
    this.#respawnTimer = undefined
    if (this.#helper) {
      this.#helper.kill()   // SIGTERM; no-op/false if it's already gone
      this.#helper = undefined
    }
  }

  #onData(chunk) {
    this.#buffer += chunk
    let i
    while ((i = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, i).trim()
      this.#buffer = this.#buffer.slice(i + 1)
      if (line) this.#onLine(line)
    }
  }

  #onLine(line) {
    const sp = line.indexOf(' ')
    const tag = sp < 0 ? line : line.slice(0, sp)
    const arg = sp < 0 ? '' : line.slice(sp + 1)

    switch (tag) {
      case 'C': {
        // the helper discovers the dial's MAC from the LL connect and reports it here; pass it
        // along so the battery reader doesn't have to sniff it out of sysfs separately
        const mac = (arg && arg.toLowerCase() !== 'unknown') ? arg : undefined
        Log.debug('DialDevice connected', mac || '')
        this.#buttonDown = false
        if (this.#eventFunc) this.#eventFunc({ type: EventType.CONNECT, mac })
        break
      }
      case 'D':
        Log.debug('DialDevice disconnected')
        this.#buttonDown = false
        if (this.#eventFunc) this.#eventFunc({ type: EventType.DISCONNECT })
        break
      case 'N':
        this.#decodeInput(arg)
        break
      default:
        Log.debug('dialmon unknown line:', line)
    }
  }

  // Decode one input report notification and forward BUTTON/ROTATE events. Mirrors the previous
  // HID decode semantics: a report carrying rotation is treated as rotation (button interplay is
  // handled downstream), otherwise it's a button transition with the same up/down de-duplication.
  #decodeInput(hex) {
    if (!this.#eventFunc || hex.length < 6) return // need at least 3 bytes
    const data = Buffer.from(hex, 'hex')
    if (data.length < 3) return

    const value = data.readInt16LE(1)
    if (value) {
      this.#eventFunc({ type: EventType.ROTATE, value })
      return
    }

    // no rotation => a button state report
    if (data[0] & 0x01) {
      if (this.#buttonDown) return // ignore repeated downs
      this.#buttonDown = true
      this.#eventFunc({ type: EventType.BUTTON, value: Button.DOWN })
    } else {
      if (!this.#buttonDown) return // ignore spurious ups
      this.#buttonDown = false
      this.#eventFunc({ type: EventType.BUTTON, value: Button.UP })
    }
  }
}
