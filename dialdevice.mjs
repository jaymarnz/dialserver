// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import udev from 'udev'
import HID from 'node-hid'
import { Log } from './log.mjs'

// NOTE: To make this work we must be either running as root or have privileges to read/write
// the HID device via a udev rule for the device based on the vendorId and productId
//
// https://github.com/node-hid/node-hid#udev-device-permissions

const SurfaceDial = {
  vid: 0x045e,
  pid: 0x091b
}

const DeviceType = {
  NONE: 0,
  MULTI_AXIS: 1,
  CONTROL: 2
}

export const EventType = {
  BUTTON: 1,
  ROTATE: 2,
}

export const Button = {
  UP: 0,
  DOWN: 1
}

export class DialDevice {
  static #instance // Singleton instance

  #config
  #discovered = []
  #device
  #eventFunc
  #monitor
  #buttonDown
  #featureTimer

  constructor(eventFunc, config = {}) {
    this.#eventFunc = eventFunc
    this.#config = config
    DialDevice.#instance = this
  }

  run() {
    this.#monitor = udev.monitor('input')
    this.#monitor.on('add', (device) => {
      const deviceType = this.#isSurfaceDial(device)

      // when we've discovered both devices, we're connected!
      if (deviceType !== DeviceType.NONE) {
        this.#discovered[deviceType] = true
        if (this.#discovered[DeviceType.MULTI_AXIS] && this.#discovered[DeviceType.CONTROL]) {
          Log.debug('DialDevice has connected')
          this.#discovered = [] // for next time...
          this.#startListening()
        }
      }
    })

    // is the device already connected?
    if (this.#isPresent()) {
      Log.debug('DialDevice is present')
      this.#startListening()
    }
  }

  // is the SurfaceDial known to HID?
  #isPresent() {
    return HID.devices(SurfaceDial.vid, SurfaceDial.pid).length !== 0
  }

  // is a device the Surface Dial? Return a SurfaceDevice value
  #isSurfaceDial(device) {
    try {
      const parent = udev.getNodeParentBySyspath(device.syspath)

      if (parent && parent.NAME === '"Surface Dial System Multi Axis"') {
        Log.debug('Found multi-axis device: ', device.DEVNAME)
        return DeviceType.MULTI_AXIS
      }
      else if (parent && parent.NAME === '"Surface Dial System Control"') {
        Log.debug('Found control device: ', device.DEVNAME)
        return DeviceType.CONTROL
      }
      else
        return DeviceType.NONE
    } catch (error) {
      // too many unrelated errors on other devices... so stay quiet unless needed for debugging
      // Log.verbose(`isSurfaceDial - udev.getNodeParentBySyspath error for device ${device.syspath}:`, error)
    }

    return false
  }

  #startListening() {
    Log.debug('DialDevice creating HID')
    this.#device = new HID.HID(SurfaceDial.vid, SurfaceDial.pid)
    this.#device.on('data', this.#dataReceived.bind(this))
    this.#device.on('error', (error) => {
        Log.error('HID error:', error)
        clearTimeout(this.#featureTimer)
        this.#device.close()
      })

    this.#buzz(this.#config.buzzRepeatCountConnect)
  }

  #buzz(repeatCount = 0) {
    /*
    buf[0] = 0x01;    // Report ID
    buf[1] = repeat;  // RepeatCount
    buf[2] = 0x03;    // ManualTrigger (1-7)
    buf[3] = 0x00;    // RetriggerPeriod (lo)
    buf[4] = 0x00;    // RetriggerPeriod (hi)
    */
    try {
      if (this.#device && this.#config.buzz) {
        Log.debug('DialDevice sending buzz:', repeatCount)
        this.#device.write([0x01, repeatCount & 0xff, 0x03, 0x00, 0x00])
      }
    } catch (error) {
      Log.error('Error writing to device:', error)
    }
  }

  // call eventFunc with {
  //   type: 'BUTTON' | 'ROTATE', 
  //   value: 'DOWN' | 'UP' | n
  // }
  #dataReceived(data) {
    if (this.#eventFunc) {
      const event = this.#decodeEvent(data)

      // don't keep sending repeated button downs (just the first one)
      if (event) {
        if (event.type === EventType.BUTTON && event.value === Button.UP) {
          // This prevents double button up event which I have occasionally seen
          if (!this.#buttonDown) return // ignore the data
          this.#buttonDown = false
        }

        if (event.type === EventType.BUTTON && event.value === Button.DOWN) {
          if (this.#buttonDown) return // ignore the data
          else this.#buttonDown = true
        }

        this.#eventFunc(event)

        // after every read, update the features because for some reason on Buster they get reset
        // whenever the device reconnects - this is ugly and I want to find a better solution!
        // this isn't necessary on later OS versions
        if (this.#config.sendFeatures) {
          this.#setFeatures()
        }
     }
    }
  }

  #decodeEvent(data) {
    let event

    if (data[0] === 0x01 && data.length >= 4) {
      const value = data.readInt16LE(2)
      if (value) {
        event = { type: EventType.ROTATE, value }
      }
      else if (data[1] & 0x01) {
        event = {
          type: EventType.BUTTON,
          value: Button.DOWN
        }
      }
      else if ((data[1] & 0x01) === 0) {
        event = {
          type: EventType.BUTTON,
          value: Button.UP
        }
      }
    }

    return event
  }

  #setFeatures() {
    /*
    it shouldn't be necessary to send a feature report since this just sets the default values. But for some
    reason I've found on Buster at reconnect it resets the multiplier too low and so the volume doesn't work right
   
    buf[0] = 0x01                               // Feature report 0x01
    buf[1] = 0x10                               // Resolution Multiplier - low
    buf[2] = 0x0E                               // Resolution Multiplier - high
    buf[3] = 0x00                               // Repeat Count (0-255)
    buf[4] = if haptics { 0x03 } else { 0x02 }  // 0x03 = auto trigger (1-7)
    buf[5] = 0x00                               // Waveform Cutoff Time (1-10)
    buf[6] = 0x00                               // retrigger period - low (1-10)
    buf[7] = 0x00                               // retrigger period - high (1-10)
    */

    // Don't change the default number of steps from 3600 or else the aggregation and bluview won't work well
    const features = [0x01, this.#config.dialSteps & 0xff, (this.#config.dialSteps >> 8) & 0xff, 0x00, 0x01, 0x00, 0x00, 0x00]

    // sendFeatureReport is synchronous - so use a 50ms timeout to queue it but this also debounces it
    clearTimeout(this.#featureTimer)
    this.#featureTimer = setTimeout(() => {
      try {
        if (this.#device) {
          this.#device.sendFeatureReport(features)
          Log.verbose('sendFeatureReport:', this.#hexString(features))
        }
      } catch (error) {
        Log.error('Error sending feature report:', error)
        return false
      }
    }, 50)

    return true
  }

  // This is only used for debugging
  // Note: On 32bit Buster the feature report is missing the first byte. This is a bug and doesn't happen on later releases
  #getFeatureReport(reports = [0x01]) {
    if (this.#device) {
      try {
        reports.forEach((i) =>
          Log.verbose(`Feature report ${i.toString(16).padStart(2, '0')}: `, this.#hexString(this.#device.getFeatureReport(i, 16)))
        )
      } catch (error) {
        // Log.verbose('error getting feature report:', error)
        return false
      }
    }

    return true
  }

  #hexString(arr) {
    return Buffer.from(arr).toString('hex').replace(/(.{2})/g, "$1 ").trim().toUpperCase()
  }
}
