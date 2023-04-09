import HID from 'node-hid'
import { Log } from './log.mjs'

// NOTE: To make this work we must be either running as root or have privileges to read/write
// the HID device via a udev rule for the device based on the vendorId and productId
//
// https://github.com/node-hid/node-hid#udev-device-permissions

export const EventType = {
  BUTTON: 1,
  ROTATE: 2,
}

export const Button = {
  UP: 0,
  DOWN: 1
}

export const DeviceType = {
  NONE: 0,
  MULTI_AXIS: 1,
  CONTROL: 2
}

export class DialDevice {
  #config
  #dev
  #featTimeout
  #featInterval
  #buttonDown

  constructor(config = {}) {
    this.#config = config
    Log.verbose('DialDevice constructor')

    try {
      this.#dev = new HID.HID(0x045e, 0x091b)
      this.#dev.on('error', (error) => { throw new Error(error) })

      if (this.#config.verbose)
        this.#featInterval = setInterval(() => this.#getFeatureReport(), 30 * 1000)
    } catch (error) {
      console.error('error opening DialDevice:', error)
      throw error
    }
  }

  close() {
    Log.verbose('DialDevice close')
    if (this.#featTimeout) clearTimeout(this.#featTimeout)
    if (this.#featInterval) clearInterval(this.#featInterval)
    if (this.#dev) this.#dev.close()
    this.#dev = undefined
  }

  buzz(repeatCount = 0) {
    /*
    buf[0] = 0x01;    // Report ID
    buf[1] = repeat;  // RepeatCount
    buf[2] = 0x03;    // ManualTrigger (1-7)
    buf[3] = 0x00;    // RetriggerPeriod (lo)
    buf[4] = 0x00;    // RetriggerPeriod (hi)
    */
    try {
      if (this.#dev && this.#config.buzz)
        this.#dev.write([0x01, repeatCount & 0xff, 0x03, 0x00, 0x00])
    } catch (error) {
      console.error('error writing to dialDevice:', error)
    }
  }

  // returns: {
  //   type: 'BUTTON' | 'ROTATE', 
  //   value: 'DOWN' | 'UP' | n
  // }
  async read() {
    let event

    while (!event) {
      const data = await this.#readAsync()
      event = this.#decodeEvent(data)

      // don't keep sending repeated button downs (just the first one)
      if (event) {
        if (event.type === EventType.BUTTON && event.value === Button.UP) {
          // This prevents double button up event which I have occasionally seen
          if (!this.#buttonDown) {
            event = undefined
            continue
          }

          this.#buttonDown = false
        }

        if (event.type === EventType.BUTTON && event.value === Button.DOWN) {
          if (this.#buttonDown) event = undefined
          else this.#buttonDown = true
        }
      }
    }

    return event
  }

  setFeatures() {
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

    try {
      // sendFeatureReport is synchronous - so use a 50ms timeout to queue it but this also debounces it
      clearTimeout(this.#featTimeout)
      this.#featTimeout = setTimeout(() => {
        Log.verbose('sendFeatureReport:', this.#hexString(features))
        this.#dev.sendFeatureReport(features)
      }, 50)
    } catch (error) {
      console.error('error sending feature report:', error)
      return false
    }

    return true
  }

  // This is only used for debugging
  // Note: On 32bit Buster the feature report is missing the first byte. This is a bug and doesn't happen on Bookworm
  #getFeatureReport(reports = [0x01]) {
    if (this.#dev) {
      try {
        reports.forEach((i) =>
          Log.verbose(`Feature report ${i.toString(16).padStart(2, '0')}: `, this.#hexString(this.#dev.getFeatureReport(i, 16)))
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

  async #readAsync() {
    return new Promise((resolve, reject) => {
      this.#dev.read((err, data) => {
        if (err) return reject(err)
        resolve(data)
      })
    })
  }

  #decodeEvent(data) {
    let event

    if (data[0] === 0x01 && data.length >= 4) {
      const value = data.readInt16LE(2)
      if (value) {
        event = {
          type: EventType.ROTATE,
          value: data.readInt16LE(2)
        }
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
}
