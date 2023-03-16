import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'

export class DialDevice {
  #config
  #bufferSize
  #buf
  #fd

  constructor(config = {}) {
    this.#config = { 
      ...{ 
        dialLogging: false // enable logging only during debugging since it's very noisy
      },
      ...config
    }

    if (this.#config.dialLogging) console.log('DialDevice constructor')

    this.#bufferSize = 24
    this.#buf = Buffer.alloc(this.#bufferSize)
  }
  
  async open() {
    if (this.#config.dialLogging) console.log('DialDevice open')
    this.#fd = await open('/dev/input/' + this.#config.dialEventFile, 'r')
    // if (this.#config.dialLogging) console.log('FD:', this.#fd)
  }

  async close() {
    if (this.#config.dialLogging) console.log('DialDevice close')
    let fd = this.#fd
    this.#fd = undefined
    return fd ? fd.close() : Promise.resolve()
  }

  async read() {
    if (this.#config.dialLogging) console.log('DialDevice read')
    const result = await this.#fd.read(this.#buf, { length: this.#bufferSize })
    const event = {
      timeS: result.buffer.readBigUInt64LE(0),
      timeMS: result.buffer.readBigUInt64LE(8),
      type: result.buffer.readUInt16LE(16),
      code: result.buffer.readUInt16LE(18),
      value: result.buffer.readInt32LE(20)
    }
    // if (this.#config.dialLogging) console.log('DialDevice:', event)
    return event
  }
}
