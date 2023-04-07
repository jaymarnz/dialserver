import yargs from 'yargs'
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
  minDegrees: 0.5, // minimum reportable rotation
  dialSteps: 3600, // number of subdivisions the dial should use (don't change this)
  buzzRepeatCountConnect: 4 // controls the "feel" on device wake-up
}

const argv = yargs(hideBin(process.argv))
  .strictOptions()
  .usage('Usage: $0 [options]')
  .help()
  .alias('v', 'version')
  .alias('h', 'help')
  .option('d', {
    alias: 'debug',
    describe: 'enable debug logging',
    type: 'boolean',
    default: false
  })
  .option('verbose', {
    describe: 'enable verbose logging',
    type: 'boolean',
    default: false
  })
  .option('b', {
    alias: 'buzz',
    describe: 'enable buzz on wake-up',
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
    buzz: argv.buzz
  }
}

Log.init(config)
if (config.htmlPort !== 0) new HtmlServer(config)
await new DialServer(config).run()
