import { access } from 'node:fs/promises'
import { watch } from 'node:fs/promises'
import { DialDevice } from './msdial.mjs'
import { WsServer } from './wsserver.mjs';

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
    // get the ball rolling right away if the event file already exists
    if (await this.#fileExists(this.#config.eventFilePath)) {
      await this.#processDeviceInput()
      await this.#waitForEventFile()
    } else await this.#waitForEventFile()
  }

  // watch for the event file to be present and process it
  async #waitForEventFile() {
    this.#log('waitForEventFile')
    for await (const event of watch('/dev/input/')) {
      if (event.eventType === 'rename' && event.filename === this.#config.eventFile) {
        // retry processing the event file in case of an unexpected error
        // stop processing when the file is gone and we'll wait for it to reappear
        while (await this.#fileExists(this.#config.eventFilePath))
          await this.#processDeviceInput()
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  // process input from the device
  async #processDeviceInput() {
    let dialDevice
    this.#log('processDeviceInput')

    try {
      dialDevice = new DialDevice(this.#config)
      await dialDevice.open()

      // read events from the input device
      while (true) {
        const event = await dialDevice.read()

        // aggregate rotation but immediately process clicks
        switch (event.type) {
          case 1:
            this.#wsServer.send({ button: event.value ? 'down' : 'up' })
            break
          case 2:
            this.#aggregateRotation(event.value)
            break
        }
      }
    } catch (error) {
      this.#log('error reading events:')
      this.#log(error)
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

  // return true if a file exists
  async #fileExists(filename) {
    try {
      await access(filename)
      return true
    } catch (error) {
      if (!['ENOENT', 'EACCES'].includes(error.code)) {
        this.#log('error checking file existance:')
        this.#log(error)
      }
    }

    return false
  }

  #log(...str) {
    if (this.#config.logging) console.log(...str)
  }
}