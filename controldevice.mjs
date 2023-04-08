import HID from 'node-hid'
import { Log } from './log.mjs'

// NOTE: To make this work we must be either running as root or have privileges to write
// to the HID device via a udev rule for the device based on the vendorId and productId
//
// https://github.com/node-hid/node-hid#udev-device-permissions

export class ControlDevice {
  #config
  #dev
  #featTimeout
  #featInterval

  // devname is never used since I use the HID api but it is here for api compatibility with DialDevice
  #devname

  constructor(devname, config = {}) {
    this.#devname = devname
    this.#config = config
    Log.verbose('ControlDevice constructor')
  }

  // these are async to make this interface compatible with DialDevice but in fact
  // the various functions in HID are all synchronous
  async open() {
    try {
      Log.verbose('ControlDevice open')
      this.#dev = new HID.HID(0x045e, 0x091b)

      if (this.#config.verbose)
        this.#featInterval = setInterval(() => this.#getFeatureReport(), 30 * 1000)
    } catch (error) {
      console.error('error opening ControlDevice:', error)
    }
  }

  setFeatures() {
    /*
    it shouldn't be necessary to send a feature report since this just sets the default values. But for some
    reason I've found on Buster at reconnect it resets the multiplier too low and the volume doesn't work right

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

  #readComplete(err, data) {
    if (err) Log.verbose('readComplete error:', err)
    else Log.verbose('readComplete:', data)
    this.#dev.read((err, data) => this.#readComplete(err, data))
  }

  async close() {
    Log.verbose('ControlDevice close')
    if (this.#featTimeout) clearTimeout(this.#featTimeout)
    if (this.#featInterval) clearInterval(this.#featInterval)
    if (this.#dev) this.#dev.close()
    this.#dev = undefined
  }

  async buzz(repeatCount = 0) {
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
      console.error('error writing to ControlDevice:', error)
    }
  }
}
