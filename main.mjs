import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { DialServer } from './dialserver.mjs'
import { HtmlServer } from './htmlserver.mjs'

// Configuration parameters
const defaultConfig = {
  logging: false,
  dialLogging: false, // enable logging only during debugging since it's very noisy
  keepaliveTime: 30000, // if changed then client must also be changed
  wsPort: 3000,
  htmlPort: 3080,
  inputDir: '/dev/input',
  eventFile: undefined, // must be supplied in command line arg
  aggregationTime: 50,
  minDegrees: 0.5 // minimum reportable rotation
}

const argv = yargs(hideBin(process.argv))
  .strictOptions()
  .usage('Usage: $0 <event-file> [options]')
  .help()
  .alias('v', 'version')
  .alias('h', 'help')
  .command('<event-file>', 'event file found in /dev/input')
  .demandCommand(1, 1, 'event-file is required', 'too many command line arguments')
  // .demandCommand(1, 'event-file is required')
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
    eventFile: argv._[0],
    eventFilePath: defaultConfig.inputDir + '/' + argv._[0],
    logging: argv.debug,
    verbose: argv.verbose,
    wsPort: argv.port,
    htmlPort: argv.web,
  }
}

// create a shortcut to the full path of the event file and away we go...
new HtmlServer(config)

await new DialServer({
  ...config,
  ...{ eventFilePath: config.inputDir + '/' + config.eventFile } })
.run()
