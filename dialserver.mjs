import udev from 'udev'
import { DialDevice } from './msdial.mjs'
import { WsServer } from './wsserver.mjs';

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

  constructor(config) {
    this.#config = config
    this.#wsServer = new WsServer(this.#config)
  }

  async run() {
    // get the ball rolling right away if the device is connected
    for (const device of udev.list('input')) {
      if (this.#isSurfaceDial(device)) await this.#processDeviceInput(device.DEVNAME)
    }

    // monitor new input devices for the Surface Dial to connect
    udev.monitor('input').on('add', async (device) => {
      if (this.#isSurfaceDial(device)) await this.#processDeviceInput(device.DEVNAME)
    })
  }

  // is this device the Surface Dial?
  #isSurfaceDial(device) {
    try {
      const parent = udev.getNodeParentBySyspath(device.syspath)
      return (parent && parent.NAME === '"Surface Dial System Multi Axis"')
    } catch (error) {
      // I'm not sure yet why but udev sometimes throws "device not found" for this syspath
      // Probably a timing thing but once I figure it out I can make this function static
      // again when the logging is removed.
      this.#log('isSurfaceDial error')
      this.#log(error)
      this.#log('device:', device)
    }

    return false
  }

  // process input from the device
  async #processDeviceInput(devname) {
    let dialDevice
    this.#log('device is connected')

    try {
      dialDevice = new DialDevice(devname, this.#config)
      await dialDevice.open()

      // read events from the input device
      while (true) {
        const event = await dialDevice.read()

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
        this.#log('device has disconnected')
      } else {
        this.#log('error reading events:')
        this.#log(error)
      }
    }

    // close the dialDevice
    try {
      if (dialDevice) await dialDevice.close()
    } catch (error) {
      this.#log('error closing dialDevice:')
      this.#log(error)
    }
  }

  // don't send every rotation. rather, aggregate them and send periodically
  #aggregateRotation(value) {
    this.#aggregate += value

    if (!this.#aggregateTimer) {
      this.#aggregateTimer = setTimeout(() => {
        this.#aggregateTimer = undefined
        let degrees = this.#aggregate / 10.0
        this.#aggregate = 0
        if (Math.abs(degrees) >= this.#config.minDegrees)
          this.#wsServer.send({ degrees })
      }, this.#config.aggregationTime)
    }
  }

  #log(...str) {
    if (this.#config.logging) console.log(...str)
  }
}