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
  keepaliveTime: 30000, // if changed then client must also be changed
  wsPort: 3000,
  htmlPort: 3080,
  aggregationTime: 50,
  buttonTime: 100, // ms to ignore rotations after a button press - needed because a rotation when muted acts like a button press
  minDegrees: 0.5, // minimum reportable degrees
  buzzRepeatCountConnect: 4, // controls the "feel" on device wake-up
  
  // The number of subdivisions (aka resolution) the dial should use (bluview may need to be adjusted if this is changed)
  // More importantly, this is the setting that the surface dial always re-connects with on Buster. By setting it here to match
  // then I no longer have to reset the features after every event. It also makes this work on legacy as well as new
  // versions of the OS without any special conditions.
  //
  // However, if DialServer is being used for other purposes and not running on Buster then
  // you can use this value to control the dial resolution. See also highResolution below
  dialSteps: 72,
  
  // true to enable special cases needed when the dial is sending events faster. Probably should be set to
  // true if dialSteps > 360 but may require some experimentation
  highResolution: false 
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
  }
}

Log.init(config)
Log.verbose('config:', config)

if (config.htmlPort !== 0) new HtmlServer(config)
new DialServer(config)
