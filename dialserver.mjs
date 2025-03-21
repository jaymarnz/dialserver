// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import udev from 'udev'
import { DialDevice, DeviceType, EventType, Button } from './dialdevice.mjs'
import { WsServer } from './wsserver.mjs';
import { Log } from './log.mjs'

export class DialServer {
  #config
  #wsServer
  #aggregateTimer
  #monitor
  #aggregate = 0
  #baseDelayMs = 25
  #maxDelayMs = 60 * 1000

  constructor(config) {
    this.#config = config
    this.#wsServer = new WsServer(this.#config)
  }

  // main processing loop
  async run() {
    let retries = 0

    while (true) {
      if (!DialDevice.isPresent())
        await this.#waitForDevice()

      await this.#processDeviceInput()

      // processDeviceInput shouldn't ever return but just in case, let's wait a bit before
      // trying again which also prevents filling /var/log/syslog
      const delayMs = Math.min(Math.pow(2, retries++) * this.#baseDelayMs, this.#maxDelayMs)
      Log.debug(`processDeviceInput has returned - will wait ${delayMs} msec before trying again`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // start monitoring for the Surface Dial
  async #waitForDevice() {
    Log.debug('Waiting for DialDevice to connect')
    const devices = []

    return new Promise(resolve => {
      // don't create the udev.monitor here (eg. const monitor = udev.monitor(...)) because
      // it will go out of scope and that will close the monitor but I won't have control over
      // when that happens and it will abort if I've already closed it. This way, I can determine
      // when I want to close the monitor
      this.#monitor = udev.monitor('input')
      this.#monitor.on('add', async (device) => {
        const deviceType = DialDevice.isSurfaceDial(device)

        // when we've discovered both devices, we're connected!
        if (deviceType !== DeviceType.NONE) {
          devices[deviceType] = true
          if (devices[DeviceType.MULTI_AXIS] && devices[DeviceType.CONTROL]) {
            Log.debug('DialDevice has connected')
            this.#monitor.close()
            resolve()
          }
        }
      })
    })
  }

  // process input from the device
  async #processDeviceInput() {
    Log.debug('Processing device input')
    let dialDevice

    try {
      dialDevice = new DialDevice(this.#config)
      dialDevice.buzz(this.#config.buzzRepeatCountConnect)

      while (true) {
        const event = await dialDevice.read()

        // after every read, update the features because for some reason on buster they get reset
        // whenever the device reconnects - this is ugly and I want to find a better solution!
        // this isn't necessary on bullseye and bookworm
        if (dialDevice && this.#config.sendFeatures)
          dialDevice.setFeatures()

        // aggregate rotation but immediately process clicks
        switch (event.type) {
          case EventType.BUTTON:
            Log.verbose('BUTTON:', event.value)
            this.#wsServer.send({ button: (event.value == Button.DOWN) ? 'down' : 'up' })
            break
          case EventType.ROTATE:
            Log.verbose('ROTATE:', event.value)
            this.#aggregateRotation(event.value)
            break
        }
      }
    } catch (error) {
      Log.error('error processing events:', error)
    }

    this.#closeDevice(dialDevice)
  }

  // don't send every rotation. rather, aggregate them and send periodically
  #aggregateRotation(value) {
    this.#aggregate += value

    this.#aggregateTimer = this.#aggregateTimer || setTimeout(() => {
      const degrees = this.#aggregate / 10.0 // this expects the dial is set to its default 3600 steps
      this.#aggregateTimer = undefined
      this.#aggregate = 0
      if (Math.abs(degrees) >= this.#config.minDegrees)
        this.#wsServer.send({ degrees })
    }, this.#config.aggregationTime)
  }

  // close the device if open
  #closeDevice(dialDevice) {
    try {
      if (dialDevice) {
        dialDevice.close()
        dialDevice = undefined
      }
    } catch (error) {
      Log.error('error closing dialDevice:', error)
    }
  }
}
