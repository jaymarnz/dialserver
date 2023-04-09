import { DialDevice, DeviceType, EventType, Button } from './dialdevice.mjs'
import { WsServer } from './wsserver.mjs';
import { Log } from './log.mjs'

export class DialServer {
  #config
  #wsServer
  #aggregate = 0
  #aggregateTimer

  constructor(config) {
    this.#config = config
    this.#wsServer = new WsServer(this.#config)
  }

  // main processing loop
  async run() {
    while (true) {
      try {
        await this.#processDeviceInput()
      } catch (error) {
        console.error('error in run loop:', error)
      }
    }
  }

  // process input from the device
  async #processDeviceInput() {
    Log.debug('Processing device input')
    let dialDevice

    try {
      dialDevice = new DialDevice(this.#config)

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
      console.error('error processing events:', error)
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
      console.error('error closing dialDevice:', error)
    }
  }
}
