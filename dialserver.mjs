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

const SurfaceDevice = {
  NONE: 0,
  MULTI_AXIS: 1,
  CONTROL: 2
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

  async run() {
    // get the ball rolling right away if the device is already connected
    let devices = {}

    for (const device of udev.list('input')) {
      switch (this.#isSurfaceDial(device)) {
        case SurfaceDevice.CONTROL: {
          devices.control = device.DEVNAME
          break
        }
        case SurfaceDevice.MULTI_AXIS: {
          devices.multiAxis = device.DEVNAME
          break
        }
      }
    }

    await Promise.allSettled([
      devices.control ? this.#startDeviceControl(devices.control) : Promise.resolve(),
      devices.multiAxis ? this.#processDeviceInput(devices.multiAxis) : Promise.resolve()
    ])

    // monitor for the Surface Dial to connect
    udev.monitor('input').on('add', async (device) => {
      switch (this.#isSurfaceDial(device)) {
        case SurfaceDevice.CONTROL: {
          await this.#startDeviceControl(device.DEVNAME)
          break
        }
        case SurfaceDevice.MULTI_AXIS: {
          await this.#processDeviceInput(device.DEVNAME)
          break
        }
      }
    })
  }

  // is this device the Surface Dial? Return a SurfaceDevice value
  #isSurfaceDial(device) {
    try {
      const parent = udev.getNodeParentBySyspath(device.syspath)

      if (parent && parent.NAME === '"Surface Dial System Multi Axis"') {
        Log.verbose('found multi-axis device: ', device.DEVNAME)
        return SurfaceDevice.MULTI_AXIS
      }
      else if (parent && parent.NAME === '"Surface Dial System Control"') {
        Log.verbose('found control device: ', device.DEVNAME)
        return SurfaceDevice.CONTROL
      }
      else
        return SurfaceDevice.NONE
    } catch (error) {
      // I'm not sure yet why but udev sometimes throws "device not found" for this syspath
      // Probably a timing thing but once I figure it out I can make this function static
      // again when the logging is removed.
      Log.debug('isSurfaceDial error')
      Log.debug(error)
      Log.debug('device:', device)
    }

    return false
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

        // aggregate rotation but immediately process clicks
        switch (event.type) {
          case EventType.EV_KEY:
            this.#wsServer.send({ button: event.value ? 'down' : 'up' })
            break
          case EventType.EV_REL:
            this.#aggregateRotation(event.value)
            break
        }
      }
    } catch (error) {
      if (error.code === 'ENODEV') { // this is the expected error when it disconnects
        Log.debug('device has disconnected')
      } else {
        Log.debug('error reading events:')
        Log.debug(error)
      }
    }

    // close the devices if they are open
    try {
      if (this.#dialDevice) {
        await this.#dialDevice.close()
        this.#dialDevice = undefined
      }
      if (this.#controlDevice) {
        await this.#controlDevice.close()
        this.#controlDevice = undefined
      }
    } catch (error) {
      Log.debug('error closing dialDevice:')
      Log.debug(error)
    }
  }

  // don't send every rotation. rather, aggregate them and send periodically
  #aggregateRotation(value) {
    this.#aggregate += value

    if (!this.#aggregateTimer) {
      this.#aggregateTimer = setTimeout(() => {
        this.#aggregateTimer = undefined
        let degrees = this.#aggregate / 10.0 // this expects the dial is set to its default 3600 steps
        this.#aggregate = 0
        if (Math.abs(degrees) >= this.#config.minDegrees)
          this.#wsServer.send({ degrees })
      }, this.#config.aggregationTime)
    }
  }

  async #startDeviceControl(devname) {
    Log.debug('control hid is connected:', devname)

    try {
      this.#controlDevice = new ControlDevice(devname, this.#config)
      await this.#controlDevice.open()
      await this.#controlDevice.buzz(this.#config.buzzRepeatCountConnect)
    } catch (error) {
      if (error.code === 'ENODEV') { // this is the expected error when it disconnects
        Log.debug('control has disconnected')
      } else {
        Log.debug('error from control:')
        Log.debug(error)
      }
    }
  }
}
