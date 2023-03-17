import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { Portable } from './portable.mjs'

export class DialDevice {
  #config
  #bufferSize
  #buf
  #fd

  constructor(config = {}) {
    this.#config = config
    if (this.#config.verbose) console.log('DialDevice constructor')

    this.#bufferSize = Portable.is64Bit() ? 24 : 16
    this.#buf = Buffer.alloc(this.#bufferSize)
  }
  
  async open() {
    if (this.#config.verbose) console.log('DialDevice open')
    this.#fd = await open(this.#config.eventFilePath, 'r')
    // if (this.#config.verbose) console.log('FD:', this.#fd)
  }

  async close() {
    if (this.#config.verbose) console.log('DialDevice close')
    let fd = this.#fd
    this.#fd = undefined
    return fd ? fd.close() : Promise.resolve()
  }

  async read() {
    if (this.#config.verbose) console.log('DialDevice read')
    const result = await this.#fd.read(this.#buf, { length: this.#bufferSize })

    const event = Portable.is64Bit() ? {
      timeS: new Portable(result.buffer).readBigUInt64(0),
      timeMS: new Portable(result.buffer).readBigUInt64(8),
      type: new Portable(result.buffer).readUInt16(16),
      code: new Portable(result.buffer).readUInt16(18),
      value: new Portable(result.buffer).readInt32(20)
    } : {
      timeS: new Portable(result.buffer).readUInt32(0),
      timeMS: new Portable(result.buffer).readUInt32(4),
      type: new Portable(result.buffer).readUInt16(8),
      code: new Portable(result.buffer).readUInt16(10),
      value: new Portable(result.buffer).readInt32(12)
    }

    // if (this.#config.verbose) console.log('DialDevice:', event)
    return event
  }

  readUInt32or64(buffer, offset) {
    return buffer.readBigUInt64LE(offset)
  }

  readUInt16(buffer,offset) {
    return buffer.readUInt16LE(offset)
  }

  readInt32(buffer,offset) {
    return buffer.readInt32LE(offset)
  }
}
