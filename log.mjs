// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

export class Log {
  static #debug = false;
  static #verbose = false;

  static init(config = {}) {
    this.#debug = config.debug
    this.#verbose = config.verbose
  }

  static #timeStamp() {
    // return as ISO 9557: '2025-03-30T08:37:06.613+13:00' 
    const date = new Date()
    const pad = (n,l=2) => `${Math.floor(Math.abs(n))}`.padStart(l, '0')
    const getTimezoneOffset = date => {
      const tzOffset = -date.getTimezoneOffset()
      const diff = tzOffset >= 0 ? '+' : '-'
      return diff + pad(tzOffset / 60) + ':' + pad(tzOffset % 60)
    };

    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
           'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) +
           '.' + pad(date.getMilliseconds(), 3) + getTimezoneOffset(date)
  }

  static #writeLog(severity, ...str) {
    console.log(`${this.#timeStamp()} (${severity})`, ...str)
  }

  static debug(...str) {
    if (this.#debug) this.#writeLog('DEBUG', ...str)
  }

  static verbose(...str) {
    if (this.#verbose) this.#writeLog('VERBOSE', ...str)
  }

  static error(...str) {
    this.#writeLog('ERROR', ...str)
  }
}

