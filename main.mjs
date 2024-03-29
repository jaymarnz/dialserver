// Copyright 2023 jaymarnz, https://github.com/jaymarnz
// See LICENSE for details

import yargs from 'yargs'
import Os from 'os'
import { hideBin } from 'yargs/helpers'
import { DialServer } from './dialserver.mjs'
import { HtmlServer } from './htmlserver.mjs'
import { Log } from './log.mjs'

// Configuration parameters
const defaultConfig = {
  debug: false,
  verbose: false,
  sendFeatures: false,
  keepaliveTime: 30000, // if changed then client must also be changed
  wsPort: 3000,
  htmlPort: 3080,
  aggregationTime: 50,
  minDegrees: 0.5, // minimum reportable rotation
  dialSteps: 3600, // number of subdivisions the dial should use (don't change this)
  buzzRepeatCountConnect: 4 // controls the "feel" on device wake-up
}

const system = {
  platform: Os.platform(),
  major: Os.release().split('.')[0],
  minor: Os.release().split('.')[1]
}

const argv = yargs(hideBin(process.argv))
  .strictOptions()
  .usage('Usage: $0 [options]')
  .help()
  .alias('v', 'version')
  .alias('h', 'help')
  .option('d', {
    alias: 'debug',
    describe: 'Enable debug logging',
    type: 'boolean',
    default: false
  })
  .option('verbose', {
    describe: 'Enable verbose logging',
    type: 'boolean',
    default: false
  })
  .option('b', {
    alias: 'buzz',
    describe: 'Enable buzz on wake-up',
    type: 'boolean',
    default: false
  })
  .option('f', {
    alias: 'features',
    describe: 'Send feature reports',
    type: 'boolean',
    // default to true if we're running on Buster only
    default: system.platform === 'linux' && system.major === '5' && system.minor === '10'
  })
  .option('p', {
    alias: 'port',
    describe: 'Web sockets port (ws://)',
    type: 'number',
    default: 3000
  })
  .option('w', {
    alias: 'web',
    describe: 'Web server port (http://)',
    type: 'number',
    default: 3080
  })
  .parseSync()

const config = {
  ...defaultConfig,
  ...{
    debug: argv.debug || argv.verbose,
    verbose: argv.verbose,
    wsPort: argv.port,
    htmlPort: argv.web,
    buzz: argv.buzz,
    sendFeatures: argv.features
  }
}

Log.init(config)
if (config.htmlPort !== 0) new HtmlServer(config)
await new DialServer(config).run()
