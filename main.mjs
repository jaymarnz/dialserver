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

  // Input transport: a passive HCI-monitor helper (dialmon) rather than hidraw. See
  // dialdevice.mjs and devdocs/reconnect-speedup-plan.md. The bonded Surface Dial is
  // auto-discovered by vendor/product, so there's nothing to configure. Internal overrides:
  //   inputHandle - ATT attribute handle of the dial's input report (Surface Dial firmware const)
  //   dialmonPath - path to the helper binary (default: ./dialmon next to the app)
  inputHandle: '0x001a',
  dialDiscoveryPollTime: 30000, // ms between rescans when no bonded Surface Dial is present yet

  // Wake-up flush suppression. This existed because the OLD hidraw path opened late (~1.35s) and
  // then flooded the buffered reports in one burst, spiking the volume. The passive monitor
  // delivers reports live with no such flood, so it's disabled (connectFlushTime: 0). Kept as a
  // configurable safety net; note maxNormalRotation must be recalibrated for the resolution in use
  // before enabling (at dialSteps 3600 a fast turn legitimately exceeds the old value of 2).
  connectFlushTime: 0,   // ms after a (re)connect to suppress a buffered wake-up flush (0 = off)
  maxNormalRotation: 2,  // largest |value| a real turn produces per report; larger => backlog

  // Battery reporting. The dial's battery level isn't available over HID, only over BLE, so it's
  // read from BlueZ over D-Bus (busctl) after each (re)connect and broadcast as { battery: n }.
  // The read is deferred to give BlueZ time to resolve services; it's fully async so it never
  // delays dial input.
  batteryReadDelay: 15000, // ms after a (re)connect before reading the battery level

  // The dial's rotation resolution (counts per revolution). We use the dial's native default of
  // 3600 (documented in devdocs/dialReportDescriptor.txt as the report's Logical/Physical Maximum)
  // and never write a Resolution Multiplier feature report - the app is fully passive. Rotation is
  // aggregated in software to degrees (aggregate * 360/dialSteps), so BlueView is unaffected.
  // (bluview may need adjustment only if this is changed.)
  dialSteps: 3600,

  // Special-casing for the fast event stream (aggregation window + post-button suppression).
  // Should be true whenever dialSteps > 360, which it now always is by default.
  highResolution: true
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
  }
}

Log.init(config)
Log.verbose('config:', config)

if (config.htmlPort !== 0) new HtmlServer(config)
new DialServer(config)
