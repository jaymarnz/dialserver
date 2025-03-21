// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

export class Log {
  static #debug = false;
  static #verbose = false;

  static init(config = {}) {
    this.#debug = config.debug
    this.#verbose = config.verbose
  }

  static debug(...str) {
    if (this.#debug) console.log(new Date(), ...str)
  }

  static verbose(...str) {
    if (this.#verbose) console.log(new Date(), ...str)
  }

  static error(...str) {
    console.log(new Date(), ...str)
  }
}
