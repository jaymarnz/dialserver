// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { WebSocketServer, WebSocket } from 'ws'
import { Log } from './log.mjs'

export class WsServer {
  #config
  #wss
  #interval

  constructor(config = {}) {
    this.#config = {
      ...{
        wsPort: 3000,
        keepaliveTime: 30 * 1000
      },
      ...config
    }

    this.#wss = new WebSocketServer({ port: this.#config.wsPort })
    Log.debug(`Waiting for websocket clients on port ${this.#config.wsPort}`)

    this.#wss.on('connection', (client, req) => {
      client.id = req.headers['sec-websocket-key'] // for logging purposes create an id for each client
      client.isAlive = true

      Log.debug(`client connected: ${client.id}`)

      client.on('error', Log.error);
      client.on('close', event => Log.debug(`client disconnected: ${client.id}`))
      client.on('message', data => Log.verbose(`< ${client.id} ${data.toString()}`))
      client.on('pong', () => {
        Log.verbose(`client pong received: ${client.id}`)
        client.isAlive = true
      })
    })

    this.#wss.on('close', () => clearInterval(this.#interval))

    this.#interval = setInterval(() => {
      this.#wss.clients.forEach(client => {
        if (client.isAlive === false) {
          Log.debug(`client did not respond to ping: ${client.id}`)
          return client.terminate()
        }

        Log.verbose(`pinging client: ${client.id}`)
        client.isAlive = false
        client.ping()
      })
    }, this.#config.keepaliveTime)
  }

  close() {
    this.#wss.close()
  }

  send(data) {
    const payload = JSON.stringify(data)
    Log.debug('>', payload)

    this.#wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(`${payload}`)
      }
    })
  }
}