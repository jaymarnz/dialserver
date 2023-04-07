import udev from 'udev'
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

  static DeviceType = {
    NONE: 0,
    MULTI_AXIS: 1,
    CONTROL: 2
  }

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
    // Log.verbose('DialDevice read')
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

    // Log.verbose('DialDevice:', event)
    return event
  }

  // is this device the Surface Dial? Return a SurfaceDevice value
  static isSurfaceDial(device) {
    try {
      const parent = udev.getNodeParentBySyspath(device.syspath)

      if (parent && parent.NAME === '"Surface Dial System Multi Axis"') {
        Log.verbose('found multi-axis device: ', device.DEVNAME)
        return this.DeviceType.MULTI_AXIS
      }
      else if (parent && parent.NAME === '"Surface Dial System Control"') {
        Log.verbose('found control device: ', device.DEVNAME)
        return this.DeviceType.CONTROL
      }
      else
        return this.DeviceType.NONE
    } catch (error) {
      console.error('isSurfaceDial error:', error)
      Log.debug('device:', device)
    }

    return false
  }
}
