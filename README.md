# DialServer - WebSocket interface for Surface Dial
This is a Web Socket server that provides a continous stream of decoded events from a Microsoft Surface Dial. It's intended to be used to feed a volume controller for network streamers or other network connected audio devices. In particular it works with my [BluView app to control volume and playback on a BlueOS device like a BlueSound NODE](https://github.com/jaymarnz/bluview).

It's designed to run on a Raspberry Pi Zero 2W and the installation instructions are for that device but it should also be easily adapted to other devices running Linux.

## Example web socket messages
See `index.html` for an example of connecting and viewing the web socket messages. All messages are in JSON format. Examples:
````
{ "status" : "connected" }
{ "button" : "down" }
{ "button" : "up" }
{ "degrees" : 3.1 }
{ "degrees" : -5.3 }
{ "status": "disconnected" }
````

## Operating system choices
I've done my latest testing on a Raspberry Pi Zero 2W running Raspberry Pi OS Lite (64-bit) based on Trixie released 2025-12-04 and recommend using this OS as described in the installation steps below.

## Usage
The preferred method is to install it as a service so it's always running. See the installation section. However, for testing and development you can run it directly:
```
$ sudo node main.mjs [options]
```

Options:
<table>
<tr><td>-p,</td><td>--port</td><td>Web sockets port (ws://)</td><td>default: 3000</td>
<tr><td>-w,</td><td>--web</td><td>Web server port (http://)</td><td>default: 3080</td>
<tr><td>-b,</td><td>--buzz</td><td>Enable haptic feedback on wake-up (useful if there's a noticeable delay)</td><td></td>
<tr><td>-d,</td><td>--debug</td><td>Enable debug logging</td><td></td>
<tr><td></td><td>--verbose</td><td>Enable verbose logging</td><td></td>
<tr><td>-v</td><td>--version</td><td>Show version number</td><td></td>
<tr><td>-h</td><td>--help</td><td>Show help</td><td></td>
</table>

It creates both a web server and a web-socket server. The web server is just used for spying on the output primarily for debugging. Connect to it with your browser and it serves a single page that displays data coming from the web-socket. See [index.html](https://github.com/jaymarnz/dialserver/blob/master/index.html) for an example. You can disable the web server with `--web=0`

The Surface Dial's haptic feedback is optional to let you know when it wakes up and is ready to handle gestures. You can enable this with `--buzz`. This is useful if there is a noticeable delay when the device wakes up and reconnects. This was the case previously running on Bookworm but no longer seems to be so significant on Trixie. Try it without the haptic feedback but enable it if the delay is too long.

When running as a server edit the comand line parameters in the ***dialserver.service*** file like this:
```
ExecStart=/usr/bin/node /opt/dialserver/main.mjs --web=0 --buzz
```

## Running as root
By default DialServer needs to be run as root which the install does for you. But if you want to run from non-root then you must create a udev rule based on the vendorId and productId. I had trouble getting this to work but you might give it try. The Microsoft Surface Dial vendorId is 0x045e and the productId is 0x091b. See https://github.com/node-hid/node-hid#udev-device-permissions for an example. I don't view running as root a big issue since the Rpi is dedicated to the Surface Dial and doesn't do anything else.

## Installation ##
1. Create an image on an SD card using the Raspberry Pi Imager. You can download the official imager from: https://www.raspberrypi.com/software/

    Select the ***Raspberry Pi OS (other)*** option and then ***Raspberry Pi OS Lite (64-bit)*** for a headless installation.

    **IMPORTANT:** This is the lite image with no GUI so set the WiFi and SSH parameters in the Raspberry Pi Imager before you create the image or you won't be able to connect or login.

1. Unmount the SD card and put it in your Rpi. Power it up and wait for it to initialize and connect to your WiFi network.

1. ssh to the Rpi and update the package list and all packages (the upgrade takes a few minutes):
    ```
    $ sudo apt update
    $ sudo apt upgrade -y
    ```

1. Install the latest NodeJS version:
    ```
    $ apt install nodejs npm
    ```
1. Install additional development tools to support NPM modules that require compilation:
    ```
    $ sudo apt install -y build-essential libusb-1.0-0 libusb-1.0-0-dev libudev-dev git curl
    ```
1. Reboot to get everything up-to-date:
    ```
    $ sudo reboot
    ````

## Pairing the Microsoft Surface Dial
You only need to do this once to pair your RPi with the Surface Dial. After it has been paired it will stay paired across reboots of the RPi, etc.

1. For all of these commands use `bluetoothctl`:
    ```
    $ sudo bluetoothctl
    [bluetooth]#
    ```

1. Register the agent:

    ```
    [bluetooth]# agent on
    Agent registered

    [bluetooth]# default-agent
    Default agent request successful
    ```

1. Push the pairing button on the bottom if the Surface Dial (under the rubber base) and hold until the tiny white LED starts blinking. Then scan for nearby Bluetooth devices and wait for a few seconds for the Surface Dial to be found:
    ```
    [bluetooth]# scan on
    Discovery started
    [NEW] Device XX:XX:XX:XX:XX:XX Surface Dial
    ```
1. Pair to the Surface Dial using its address:
    ```
    [bluetooth]# pair XX:XX:XX:XX:XX:XX
    ...
    [bluetooth]# connect XX:XX:XX:XX:XX:XX
    Attempting to connect to XX:XX:XX:XX:XX:XX
    [CHG] Device XX:XX:XX:XX:XX:XX Connected: yes
    ```
1. Set the Surface Dial to trusted so it can reconnect:
    ```
    [bluetooth]# trust XX:XX:XX:XX:XX:XX
    ```

## Install DialServer
1. Download the contents of this repository to a directory on the Rpi (eg. `~/dialserver`):
    ```
    $ git clone https://github.com/jaymarnz/dialserver.git
    $ cd dialserver
    ```

1. Install required Node packages (only necessary if you want to run it directly rather than installing it as a service in the next step):
    ````
    $ npm install
    ````

1. To keep it running all the time you can run it as a service. The install script copies the files to /opt/dialserver, installs dependencies, and uses systemctl to create, enable and start the dialserver service:
    ````
    $ sudo bash ~/dialserver/install.sh
    ````

1. You can also run it directly using the options shown above. If you've already started it as a service then you'll need to stop it first:
    ````
    $ sudo systemctl stop dialserver
    $ sudo node main.mjs [options]
    ````

## Setting the Wifi connection to retry forever
By default the Raspberry Pi OS sets the WiFi connection to only retry a limited number of times. In a powerfail situation, or similar, it's likely the Rpi will reboot faster
than the WiFi router and will run out of retries. In that case it will appear dead and have to be power cycled to cause it to connect to the WiFi router. Execute these commands (for recent versions of Rpi OS):

````
$ nmcli connection show
NAME                 UUID                                  TYPE      DEVICE 
netplan-wlan0-XXXXX  3be7c803-e17d-398a-a81a-018b9ebb51f0  wifi      wlan0  
lo                   13e02f27-f81e-436a-a762-b7fb3002f9d3  loopback  lo     
netplan-eth0         75a1216a-9d1a-30cd-8aca-ace5526ec021  ethernet  --
````
The XXXXX above should be your WiFi SSID. Substitute that into this command:

````
$ nmcli connection modify "netplan-wlan0-XXXXX" connection.autoconnect-retries 0
````

This causes the WiFi to retry forever. You can confirm with:

````
$ nmcli connection show netplan-wlan0-XXXXX | grep autoconnect
connection.autoconnect:                 yes
connection.autoconnect-priority:        0
connection.autoconnect-retries:         0 (forever)
connection.autoconnect-slaves:          -1 (default)
connection.autoconnect-ports:           -1 (default)
````