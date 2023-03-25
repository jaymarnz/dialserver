import express from 'express'
import { Log } from './log.mjs'

// hack to get __dirname when within a module
import path from 'path'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Note: It's possible to run both html and ws sessions on the same port
// but I don't think it's worth the trouble for this application. The html
// server is just for debugging and never used otherwise so it's fine
// to run it on it's own port. If I want to change this in the future,
// here's a reference: https://github.com/websockets/ws/issues/1810

// a simple webserver that always returns the index page
export class HtmlServer {
  #config

  constructor(config) {
    this.#config = {
      ...{
        htmlPort: 3080,
        indexFile: '/index.html',
      },
      ...config
    }

    const webserver = express()
      .use((req, res) => res.sendFile(this.#config.indexFile, { root: __dirname }))
      .listen(this.#config.htmlPort, () => {
        Log.debug(`Web server listening on ${this.#config.htmlPort}`)
      })
      .on('error', console.error)
  }
}
