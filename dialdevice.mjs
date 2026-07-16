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
  #btnPhase = 'idle'    // button-hold state machine: 'idle'|'pending'|'down'|'turn' (see #decodeInput)
  #settleRot = 0        // |rotation| seen since the button bit rose (decides press vs. turn)
  #heldRot = 0          // rotation withheld during 'pending' so press jitter can't leak as volume
  #confirmTimer         // fires once the dial is still while held -> commit a real DOWN
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
      this.#resetGesture()
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
    clearTimeout(this.#confirmTimer)
    this.#confirmTimer = undefined
    if (this.#helper) {
      this.#helper.kill()   // SIGTERM; no-op/false if it's already gone
      this.#helper = undefined
    }
  }

  // clear per-gesture button/rotation state (on connect, disconnect, or a lost helper)
  #resetGesture() {
    clearTimeout(this.#confirmTimer)
    this.#confirmTimer = undefined
    this.#btnPhase = 'idle'
    this.#settleRot = 0
    this.#heldRot = 0
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
        this.#resetGesture()
        if (this.#eventFunc) this.#eventFunc({ type: EventType.CONNECT, mac })
        break
      }
      case 'D':
        Log.debug('DialDevice disconnected')
        this.#resetGesture()
        if (this.#eventFunc) this.#eventFunc({ type: EventType.DISCONNECT })
        break
      case 'N':
        this.#decodeInput(arg)
        break
      default:
        Log.debug('dialmon unknown line:', line)
    }
  }

  // Decode one input report and forward ROTATE / BUTTON events. Report byte layout (no report-id
  // prefix): data[0] flags (bit 0x01 = button, bit 0x02 = motion), data[1..2] = int16 rotation.
  //
  // The flag bits are NOT reliable discriminators on their own. The button is so sensitive that a
  // hard turn/flick trips its bit mid-turn (0x03), and - conversely - a real press often arrives
  // with the motion bit set and ZERO rotation (also 0x03). Pressing and turning are mutually
  // exclusive intents; what separates them is that a press's rotation SETTLES (stops) while a turn's
  // CONTINUES. So when the button bit rises we don't decide yet - we hold, withholding rotation so
  // jitter can't leak as volume, and watch:
  //   - rotation keeps coming (> pressTurnThreshold): it's a turn - flush the held rotation, stream
  //     the rest, never emit a button (rejects the mid-turn trip and the rotate-into-press case).
  //   - the dial goes still for pressConfirmTime while held: it's a real press - emit DOWN now and
  //     UP on release, preserving the real hold duration. BlueView times DOWN->UP to tell a short
  //     press (mute) from a long press (>=500ms, pause), so a genuine duration is required.
  //   - released before it settled (a quick tap): emit DOWN+UP at once - still a short press.
  #decodeInput(hex) {
    if (!this.#eventFunc || hex.length < 6) return // need at least 3 bytes (1 flags + 2 rotation)
    const data = Buffer.from(hex, 'hex')
    if (data.length < 3) return

    const value = data.readInt16LE(1)
    const buttonBit = (data[0] & 0x01) !== 0
    const threshold = this.#config.pressTurnThreshold || 50
    let forwardRot = true

    if (buttonBit) {
      if (this.#btnPhase === 'idle') {
        this.#btnPhase = 'pending'
        this.#settleRot = 0
        this.#heldRot = 0
        this.#armConfirm()
      }
      if (this.#btnPhase === 'pending') {
        this.#settleRot += Math.abs(value)
        this.#heldRot += value
        if (this.#settleRot > threshold) {
          // rotation kept coming - this hold is a turn, not a press: release what we withheld
          clearTimeout(this.#confirmTimer)
          this.#confirmTimer = undefined
          this.#btnPhase = 'turn'
          if (this.#heldRot) this.#eventFunc({ type: EventType.ROTATE, value: this.#heldRot })
        } else if (Math.abs(value) >= 2) {
          // still moving (>1 count is real motion, not settle jitter) - restart the quiet timer
          this.#armConfirm()
        }
        forwardRot = false // withhold pending rotation (flushed above if it just became a turn)
      } else if (this.#btnPhase === 'down') {
        forwardRot = false // pressed and held; dialserver also suppresses rotation while down
      }
      // 'turn': fall through and stream rotation normally
    } else {
      if (this.#btnPhase === 'pending') {
        // released before it settled - a quick tap: emit a full (short) press now
        clearTimeout(this.#confirmTimer)
        this.#confirmTimer = undefined
        this.#eventFunc({ type: EventType.BUTTON, value: Button.DOWN })
        this.#eventFunc({ type: EventType.BUTTON, value: Button.UP })
        forwardRot = false
      } else if (this.#btnPhase === 'down') {
        this.#eventFunc({ type: EventType.BUTTON, value: Button.UP })
        forwardRot = false
      }
      this.#btnPhase = 'idle'
    }

    if (forwardRot && value) this.#eventFunc({ type: EventType.ROTATE, value })
  }

  // (re)arm the settle timer: once the dial has been still for pressConfirmTime while the button is
  // held, the hold is a real press - commit DOWN (UP follows on release, giving BlueView the true
  // duration it needs to distinguish a mute tap from a long-press pause).
  #armConfirm() {
    clearTimeout(this.#confirmTimer)
    this.#confirmTimer = setTimeout(() => {
      this.#confirmTimer = undefined
      if (this.#btnPhase !== 'pending') return
      this.#btnPhase = 'down'
      this.#eventFunc({ type: EventType.BUTTON, value: Button.DOWN })
    }, this.#config.pressConfirmTime || 50)
  }
}
