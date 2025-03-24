// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { DialDevice, EventType, Button } from './dialdevice.mjs'
import { WsServer } from './wsserver.mjs';
import { Log } from './log.mjs'

export class DialServer {
  static #instance // Singleton instance

  #config
  #wsServer
  #buttonTimer
  #aggregateTimer
  #aggregate = 0

  constructor(config) {
    this.#config = config
    this.#wsServer = this.#wsServer || new WsServer(this.#config)
    DialServer.#instance = this
  }

  // main processing loop - never returns
  async run() {
    const dialDevice = new DialDevice(this.#eventReceived.bind(this), this.#config).run()
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // process input from the device
  // aggregate rotation but immediately process clicks
  #eventReceived(event) {
    switch (event.type) {
      case EventType.BUTTON:
        Log.verbose('BUTTON:', event.value)
        this.#wsServer.send({ button: (event.value == Button.DOWN) ? 'down' : 'up' })

        // the button timer prevents sending rotations while the button is being touched
        // this is needed since small rotations are frequent when pressing the dial and
        // a rotation when muted acts just like a button press (on purpose for a better UX)
        clearTimeout(this.#buttonTimer)
        this.#buttonTimer = setTimeout(() => {
          this.#buttonTimer = undefined // re-enable rotation events
        }, this.#config.buttonTime)
        break

      case EventType.ROTATE:
        if (!this.#buttonTimer) {
          Log.verbose('ROTATE:', event.value)
          this.#aggregateRotation(event.value)
        }
        break
    }
  }

  // don't send every rotation. rather, aggregate them and send periodically
  #aggregateRotation(value) {
    this.#aggregate += value

    this.#aggregateTimer = this.#aggregateTimer || setTimeout(() => {
      const degrees = this.#aggregate / 10.0 // this expects the dial is set to its default 3600 steps
      this.#aggregateTimer = undefined
      this.#aggregate = 0
      if (Math.abs(degrees) >= this.#config.minDegrees) {
        this.#wsServer.send({ degrees })
      }
    }, this.#config.aggregationTime)
  }
}
