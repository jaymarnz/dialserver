import { WebSocketServer, WebSocket } from 'ws'

export class WsServer {
  #config
  #wss
  #interval

  constructor(config = {}) {
    this.#config = { 
      ...{ 
        wsPort: 3000,
        keepaliveTime: 30*1000
      },
      ...config
    }
    
    this.#wss = new WebSocketServer({ port: this.#config.wsPort })
    if (this.#config.logging) console.log(`Waiting for websocket clients on port ${this.#config.wsPort}`)

    this.#wss.on('connection', (client, req) => {
      client.id = req.headers['sec-websocket-key'] // for logging purposes create an id for each client
      client.isAlive = true

      if (this.#config.logging) console.log(`client connected: ${client.id}`)
      this.send({ status: 'connected' })

      client.on('error', console.error);
      client.on('close', event => console.log(`client disconnected: ${client.id}`))
      client.on('message', data => console.log(`< ${client.id} ${data.toString()}`))
      client.on('pong', () => {
        if (this.#config.logging) console.log(`client pong received: ${client.id}`)
        client.isAlive = true
      })
    })

    this.#wss.on('close', () => clearInterval(this.#interval))

    this.#interval = setInterval(() => {
      this.#wss.clients.forEach(client => {
        if (client.isAlive === false) {
          if (this.#config.logging) console.log(`client did not respond to ping: ${client.id}`)
          return client.terminate()
        }

        if (this.#config.logging) console.log(`pinging client: ${client.id}`)
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
    if (this.#config.logging) console.log('>', payload)

    this.#wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(`${payload}`)
      }
    })
  }
}