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
  minDegrees: 0.1, // minimum reportable degrees - one count at dialSteps 3600 (360/3600), so slow
                   // turns still register each window instead of being discarded below threshold

  // Input transport: a passive HCI-monitor helper (dialmon) rather than hidraw. See
  // dialdevice.mjs and devdocs/reconnect-speedup-plan.md. The bonded Surface Dial is
  // auto-discovered by vendor/product, so there's nothing to configure. Internal overrides:
  //   inputHandle - ATT attribute handle of the dial's input report (Surface Dial firmware const)
  //   dialmonPath - path to the helper binary (default: ./dialmon next to the app)
  inputHandle: '0x001a',
  dialDiscoveryPollTime: 30000, // ms between rescans when no bonded Surface Dial is present yet

  // Press-vs-turn discrimination (dialdevice.mjs #decodeInput). The dial's flag bits can't tell a
  // press from a turn: the button bit trips mid-turn AND a real press can carry the motion bit with
  // zero rotation. What separates them is that a press settles while a turn keeps rotating, judged
  // only from the rotation AFTER the button bit rises (a preceding turn must not taint the next
  // press). A button-hold becomes a turn once post-button rotation exceeds pressTurnThreshold; it
  // becomes a real press once the dial stays still for pressConfirmTime while held. Measured on the
  // dial: a press accumulates <=~27 counts total; a turn bursts far past 50 within a report or two.
  pressTurnThreshold: 50, // counts of post-button rotation above which the hold is a turn, not a press
  pressConfirmTime: 50,   // ms the dial must be still while held before it counts as a real press (DOWN)

  // Battery reporting. The dial's battery level isn't available over HID, only over BLE, so it's
  // read from BlueZ over D-Bus (busctl --json) after each (re)connect and broadcast as
  // { battery: n }. Rather than guess when GATT is resolved, the read retries until Battery1
  // answers; this is the interval between those retries. Fully async - never delays dial input.
  batteryRetryTime: 2000, // ms between battery-read retries until it succeeds (or we disconnect)

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
const dialServer = new DialServer(config)

// Clean shutdown: kill the dialmon child so running directly (not under systemd) doesn't orphan
// it on Ctrl+C. Under systemd the cgroup also stops dialmon; the two are compatible (see
// DialDevice.stop). Idempotent so a SIGINT followed by SIGTERM can't double-run it.
let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    Log.debug(`received ${signal}, shutting down`)
    dialServer.stop()
    process.exit(0)
  })
}
