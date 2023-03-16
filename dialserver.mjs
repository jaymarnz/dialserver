import { DialDevice } from './msdial.mjs'
import { HtmlServer } from './htmlserver.mjs'
import { WsServer } from './wsserver.mjs';

// Configuration parameters
const config = {
  logging: false,
  keepaliveTime: 30000, // if changed then client must also be changed
  wsPort: 3000,
  htmlPort: 3080,
  dialEventFile: 'event2', // TBS ********** make this a parameter
  retryTimer: 50, // time between retries on device errors
  sendTimer: 50, // aggregation time
  minDegrees: 0.5 // minimum reportable rotation
}

// dial rotation aggregation
let aggregate = 0
let aggregating = false

// The usual sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// create html and websocket servers
const webServer = new HtmlServer(config)
const wsServer = new WsServer(config)

// read from the event device with retries
while (true) {
  let dialDevice

  try {
    dialDevice = new DialDevice(config)
    await dialDevice.open()

    // read events from the input device
    while (true) {
      const event = await dialDevice.read()

      // aggregate rotation but immediately process clicks
      switch (event.type) {
        case 1:
          wsServer.send({ button: event.value ? 'down' : 'up' })
          break
        case 2:
          aggregateEvents(wsServer, event.value)
          break
      }
    } 
  } catch (error) {
    // console.error('error reading events:', error)
  }

  // close the dialDevice and try again
  try {
    if (dialDevice) await dialDevice.close()
  } catch (error) {
    console.error('error closing dialDevice:', error)
  }
  
  // wait a little bit before trying again
  dialDevice = undefined
  await sleep(config.retryTimer)
}

// event aggregation and emission
async function aggregateEvents(wsServer, value) {
  aggregate += value
  if (!aggregating) {
    aggregating = true
    sleep(config.sendTimer)
    .then (() => {
      let degrees = aggregate / 10.0
      aggregating = false
      aggregate = 0
      if (Math.abs(degrees) >= config.minDegrees) wsServer.send({ degrees })
    })
  }
}