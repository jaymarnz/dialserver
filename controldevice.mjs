import HID from 'node-hid'
import { Log } from './log.mjs'

// NOTE: To make this work we must be either running as root or have privileges to write
// to the HID device via a udev rule for the device based on the vendorId and productId
//
// https://github.com/node-hid/node-hid#udev-device-permissions

export class ControlDevice {
  #config
  #dev

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

      /*
      buf[0] = 0x01;
      buf[1] = steps_lo as u8;                    // steps
      buf[2] = steps_hi as u8;                    // steps
      buf[3] = 0x00;                              // Repeat Count
      buf[4] = if haptics { 0x03 } else { 0x02 }; // 0x03 = auto trigger
      buf[5] = 0x00;                              // Waveform Cutoff Time
      buf[6] = 0x00;                              // retrigger period (lo)
      buf[7] = 0x00;                              // retrigger period (hi)
      */

      /*
      This isn't necessary at this time. Also don't change the default number of steps or else the
      aggregation and bluview won't work well

      if (this.#dev) {
        for (let i = 0; i <= 2; i++) { Log.verbose(`Feature report ${i}: `, this.#dev.getFeatureReport(i, 16)) }
        // These are the defaults after removing and reinserting batteries:
        // 0 & 1: [ 14, 0, 0, 5, 80, 0 ]
        // 2: [ 0, 1, 0, 15, 0, 3, 4, 5, 0 ]

        // this.#dev.sendFeatureReport([0x01, this.#config.dialSteps & 0xff, (this.#config.dialSteps >> 8) & 0xff, 0x00, 0x02, 0x00, 0x00, 0x00])
        // for (let i = 0; i <= 2; i++) { Log.verbose(`Feature report ${i}: `, this.#dev.getFeatureReport(i, 16)) }
      }
      */
    } catch (error) {
      Log.debug('error opening ControlDevice:')
      Log.debug(error)
    }
  }

  async close() {
    Log.verbose('ControlDevice close')

    if (this.#dev) this.#dev.close()
    this.#dev = undefined
  }

  async buzz(repeatCount = 0) {
    /*
    buf[0] = 0x01;    // Report ID
    buf[1] = repeat;  // RepeatCount
    buf[2] = 0x03;    // ManualTrigger
    buf[3] = 0x00;    // RetriggerPeriod (lo)
    buf[4] = 0x00;    // RetriggerPeriod (hi)
    */
    try {
      if (this.#dev && this.#config.buzz)
        this.#dev.write([0x01, repeatCount & 0xff, 0x03, 0x00, 0x00])
    } catch (error) {
      Log.debug('error writing to ControlDevice:')
      Log.debug(error)
    }
  }
}
