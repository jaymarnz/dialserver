// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import { WebSocketServer, WebSocket } from 'ws'
import { Log } from './log.mjs'

export class WsServer {
  #config
  #wss
  #interval
  #onConnection

  // onConnection(send) is called for each newly connected client with a send function
  // bound to just that client, so the caller can push the current state to it immediately.
  constructor(config = {}, onConnection) {
    this.#config = {
      ...{
        wsPort: 3000,
        keepaliveTime: 30 * 1000
      },
      ...config
    }
    this.#onConnection = onConnection

    this.#wss = new WebSocketServer({ port: this.#config.wsPort })
    this.#wss.on('error', error => Log.error('WsServer error:', error))

    Log.debug(`Waiting for websocket clients on port ${this.#config.wsPort}`)

    this.#wss.on('connection', (client, req) => {
      client.id = req.headers['sec-websocket-key'] // for logging purposes create an id for each client
      client.isAlive = true

      Log.debug(`Client connected: ${client.id}`)

      client.on('error', error => Log.error('ws client error:', error));
      client.on('close', event => Log.debug(`Client disconnected: ${client.id}`))
      client.on('message', data => Log.verbose(`< ${client.id} ${data.toString()}`))
      client.on('pong', () => {
        Log.verbose(`client pong received: ${client.id}`)
        client.isAlive = true
      })

      // let the caller push current state (eg. dial connection status) to this new client
      if (this.#onConnection) {
        try {
          this.#onConnection((data) => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data))
          })
        } catch (error) {
          Log.error('ws onConnection error:', error)
        }
      }
    })

    this.#wss.on('close', () => clearInterval(this.#interval))

    this.#interval = setInterval(() => {
      this.#wss.clients.forEach(client => {
        try {
          if (client.isAlive === false) {
            Log.debug(`client did not respond to ping: ${client.id}`)
            return client.terminate()
          }

          Log.verbose(`pinging client: ${client.id}`)
          client.isAlive = false
          client.ping()
        } catch (error) {
          Log.error('ws ping error:', error)
        }
      })
    }, this.#config.keepaliveTime)
  }

  close() {
    try {
      this.#wss.close()
    } catch (error) {
      Log.error(error)
    }
  }

  send(data) {
    const payload = JSON.stringify(data)
    Log.verbose('>', payload)
    
    this.#wss.clients.forEach(client => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(`${payload}`)
        }
      } catch (error) {
        Log.error('ws send error:', error)
      }
    })
  }
}