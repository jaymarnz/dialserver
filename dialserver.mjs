import udev from 'udev'
import { DialDevice } from './dialdevice.mjs'
import { ControlDevice } from './controldevice.mjs'
import { WsServer } from './wsserver.mjs';
import { Log } from './log.mjs'

// these are the only event types I've observed with the Surface Dial
// see https://www.kernel.org/doc/Documentation/input/event-codes.txt
const EventType = {
  EV_SYN: 0,
  EV_KEY: 1,
  EV_REL: 2,
  EV_MSC: 4
}

export class DialServer {
  #config
  #wsServer
  #aggregate = 0
  #aggregateTimer
  #dialDevice
  #controlDevice

  constructor(config) {
    this.#config = config
    this.#wsServer = new WsServer(this.#config)
  }

  // main processing loop
  async run() {
    await this.#startup()
    await this.#monitor()
  }

  // see if the devices are already connected
  async #startup() {
    let devices = {}

    for (const device of udev.list('input')) {
      switch (DialDevice.isSurfaceDial(device)) {
        case DialDevice.DeviceType.CONTROL: {
          devices.control = device.DEVNAME
          break
        }
        case DialDevice.DeviceType.MULTI_AXIS: {
          devices.multiAxis = device.DEVNAME
          break
        }
      }
    }

    // get the ball rolling right away if the devices are already connected
    return Promise.allSettled([
      devices.control ? this.#startDeviceControl(devices.control) : Promise.resolve(),
      devices.multiAxis ? this.#processDeviceInput(devices.multiAxis) : Promise.resolve()
    ])
  }

  // start monitoring for the Surface Dial to connect
  async #monitor() {
    udev.monitor('input').on('add', async (device) => {
      switch (DialDevice.isSurfaceDial(device)) {
        case DialDevice.DeviceType.CONTROL: {
          await this.#startDeviceControl(device.DEVNAME)
          break
        }
        case DialDevice.DeviceType.MULTI_AXIS: {
          await this.#processDeviceInput(device.DEVNAME)
          break
        }
      }
    })
  }

  // process input from the device
  async #processDeviceInput(devname) {
    Log.debug('device stream is connected:', devname)

    try {
      this.#dialDevice = new DialDevice(devname, this.#config)
      await this.#dialDevice.open()

      // read events from the input device
      while (true) {
        const event = await this.#dialDevice.read()

        // after every read, update the features because for some reason on buster they get reset
        // whenever the device reconnects - this is ugly and I want to find a better solution!
        // this isn't necessary on bullseye and bookworm
        if (this.#controlDevice && this.#config.sendFeatures)
          this.#controlDevice.setFeatures()

        // aggregate rotation but immediately process clicks
        switch (event.type) {
          case EventType.EV_KEY:
            // Log.verbose('EV_KEY:', event.value)
            this.#wsServer.send({ button: event.value ? 'down' : 'up' })
            break
          case EventType.EV_REL:
            // Log.verbose('EV_REL:', event.value)
            this.#aggregateRotation(event.value)
            break
        }
      }
    } catch (error) {
      if (error.code === 'ENODEV') { // this is the expected error when it disconnects
        Log.debug('device has disconnected')
      } else {
        console.error('error reading events:', error)
      }
    }

    await this.#closeDevices()
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

  // send haptic feedback when connected
  async #startDeviceControl(devname) {
    // don't bother if we're not configured for haptic feedback
    // this also allows us to run as a normal user or without udev permissions

    // if (this.#config.buzz) {
    Log.debug('control hid is connected:', devname)
    try {
      this.#controlDevice = new ControlDevice(devname, this.#config)
      await this.#controlDevice.open()
      await this.#controlDevice.buzz(this.#config.buzzRepeatCountConnect)
    } catch (error) {
      console.error('error from control device:', error)
    }
    // }
  }

  // close the devices if they are open
  async #closeDevices() {
    try {
      if (this.#dialDevice) {
        await this.#dialDevice.close()
        this.#dialDevice = undefined
      }
    } catch (error) {
      console.error('error closing dialDevice:', error)
    }

    try {
      if (this.#controlDevice) {
        await this.#controlDevice.close()
        this.#controlDevice = undefined
      }
    } catch (error) {
      console.error('error closing controlDevice:', error)
    }
  }
}
