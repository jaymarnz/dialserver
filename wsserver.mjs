import { WebSocketServer, WebSocket } from 'ws'

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
    this.#log(`Waiting for websocket clients on port ${this.#config.wsPort}`)

    this.#wss.on('connection', (client, req) => {
      client.id = req.headers['sec-websocket-key'] // for logging purposes create an id for each client
      client.isAlive = true

      this.#log(`client connected: ${client.id}`)
      this.send({ status: 'connected' })

      client.on('error', console.error);
      client.on('close', event => this.#log(`client disconnected: ${client.id}`))
      client.on('message', data => this.#log(`< ${client.id} ${data.toString()}`))
      client.on('pong', () => {
        this.#log(`client pong received: ${client.id}`)
        client.isAlive = true
      })
    })

    this.#wss.on('close', () => clearInterval(this.#interval))

    this.#interval = setInterval(() => {
      this.#wss.clients.forEach(client => {
        if (client.isAlive === false) {
          this.#log(`client did not respond to ping: ${client.id}`)
          return client.terminate()
        }

        this.#log(`pinging client: ${client.id}`)
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
    this.#log('>', payload)

    this.#wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(`${payload}`)
      }
    })
  }

  #log(...str) {
    if (this.#config.logging) console.log(...str)
  }
}