import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { Portable } from './portable.mjs'
import { Log } from './log.mjs'

export class DialDevice {
  #config
  #devname
  #bufferSize
  #buf
  #fd

  constructor(devname, config = {}) {
    this.#devname = devname
    this.#config = config
    Log.verbose('DialDevice constructor')

    this.#bufferSize = Portable.is64Bit() ? 24 : 16
    this.#buf = Buffer.alloc(this.#bufferSize)
  }

  async open() {
    Log.verbose('DialDevice open')
    this.#fd = await open(this.#devname, 'r')
    // Log.verbose('FD:', this.#fd)
  }

  async close() {
    Log.verbose('DialDevice close')
    let fd = this.#fd
    this.#fd = undefined
    return fd ? fd.close() : Promise.resolve()
  }

  async read() {
    Log.verbose('DialDevice read')
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

    Log.verbose('DialDevice:', event)
    return event
  }

  readUInt32or64(buffer, offset) {
    return buffer.readBigUInt64LE(offset)
  }

  readUInt16(buffer, offset) {
    return buffer.readUInt16LE(offset)
  }

  readInt32(buffer, offset) {
    return buffer.readInt32LE(offset)
  }
}
