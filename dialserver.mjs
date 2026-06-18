// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { DialDevice, EventType, Button } from './dialdevice.mjs'
import { WsServer } from './wsserver.mjs';
import { Log } from './log.mjs'

export class DialServer {
  static #instance // Singleton instance

  #config
  #wsServer
  #device
  #buttonState
  #buttonTimer
  #aggregateTimer
  #aggregate = 0
  #flushUntil = 0
  #dialConnected = false

  constructor(config) {
    DialServer.#instance = this
    this.#config = config
    // push the current dial status to each newly connected client so it knows the state
    // immediately (eg. dial already connected before the client joined, or vice versa)
    this.#wsServer = this.#wsServer || new WsServer(this.#config, (send) => {
      send({ status: this.#dialConnected ? 'connected' : 'disconnected' })
    })
    this.#device = new DialDevice(this.#eventReceived.bind(this), this.#config).run()
  }

  // process input from the device
  // aggregate rotation but immediately process clicks
  #eventReceived(event) {
    switch (event.type) {
      case EventType.CONNECT:
        Log.verbose('CONNECT')
        // start the window during which we suppress the dial's buffered wake-up flush
        this.#flushUntil = Date.now() + this.#config.connectFlushTime
        this.#dialConnected = true
        this.#wsServer.send({ status: 'connected' })
        break

      case EventType.DISCONNECT:
        Log.verbose('DISCONNECT')
        this.#dialConnected = false
        this.#wsServer.send({ status: 'disconnected' })
        break

      case EventType.BUTTON:
        Log.verbose('BUTTON:', event.value)
        this.#wsServer.send({ button: (event.value == Button.DOWN) ? 'down' : 'up' })

        // don't send rotations while the button is down and for some time after the button
        // is up. This prevents slight movement while the button is pressed, which happens frequently
        // when dial is set for high resolution, because a rotation when muted acts just like a
        // button press (on purpose for a better UX)
        this.#buttonState = event.value

        if (this.#config.highResolution && event.value == Button.UP) {
          clearTimeout(this.#buttonTimer)
          this.#buttonTimer = setTimeout(() => {
            this.#buttonTimer = undefined // re-enable rotation events
          }, this.#config.buttonTime)
        }
        break

      case EventType.ROTATE:
        // Ignore the coalesced backlog the dial dumps right after a (re)connect. Real turning
        // never exceeds maxNormalRotation per report, so a larger report this soon after connect
        // is buffered wake-up motion, not intent - dropping it prevents the volume spike.
        if (Date.now() < this.#flushUntil && Math.abs(event.value) > this.#config.maxNormalRotation) {
          Log.verbose('ignoring wake-up flush ROTATE:', event.value)
          break
        }

        if (!this.#config.highResolution || (this.#buttonState !== Button.DOWN && !this.#buttonTimer)) {
          Log.verbose('ROTATE:', event.value)
          this.#aggregateRotation(event.value)
        }
        break
    }
  }

  // don't send every rotation if dial is set for high resolution.
  // rather, aggregate them and send periodically
  #aggregateRotation(value) {
    this.#aggregate += value

    this.#aggregateTimer = this.#aggregateTimer || setTimeout(() => {
      const degrees = this.#aggregate * (360 / this.#config.dialSteps)
      this.#aggregateTimer = undefined
      this.#aggregate = 0
      if (Math.abs(degrees) >= this.#config.minDegrees) {
        this.#wsServer.send({ degrees })
      }
    }, this.#config.highResolution ? this.#config.aggregationTime : 0)
  }
}
