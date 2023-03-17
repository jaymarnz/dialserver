// a simple portability wrapper around a few buffer extractors to handle endianness and 32/64 bit
import os from 'os'

export class Portable {
  #isLE = os.endianness() == 'LE'
  #buffer

  constructor(buffer) {
    this.#buffer = buffer
  }

  static is64Bit() {
    return ['arm64', 'ppc64', 'x64', 's390x'].includes(os.arch())
  }

  readBigUInt64(offset) {
    return this.#isLE ? this.#buffer.readBigUInt64LE(offset) : this.#buffer.readBigUInt64BE(offset)
  }

  readUInt32(offset) {
    return this.#isLE ? this.#buffer.readUInt32LE(offset) : this.#buffer.readUInt32BE(offset)
  }

  readUInt16(offset) {
    return this.#isLE ? this.#buffer.readUInt16LE(offset) : this.#buffer.readUInt16BE(offset)
  }

  readInt32(offset) {
    return this.#isLE ? this.#buffer.readInt32LE(offset) : this.#buffer.readUInt16BE(offset)
  }
}
