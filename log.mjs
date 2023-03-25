export class Log {
  static #debug = false;
  static #verbose = false;

  static init(config = {}) {
    this.#debug = config.debug
    this.#verbose = config.verbose
  }

  static debug(...str) {
    if (this.#debug) console.log(...str)
  }

  static verbose(...str) {
    if (this.#verbose) console.log(...str)
  }

  static error(...str) {
    console.log(...str)
  }
}
