# DialServer - WebSocket interface for Microsoft Surface Dial
This is a Web Socket server that provides a continous stream of decoded events from a Microsoft Surface Dial.

It's intended to be used to feed a volume controller for network streamers or other network connected audio devices. In particular it works with my BluView app to control volume and playback on a BlueOS device like a BlueSound NODE.

It is designed to run on pretty-much any Linux box. I'm currently using it on a Raspberry Pi and the installation instructions are for that OS but should either work or be easily adapted to others.

## Operating system choices
The code is designed to be portable between 32/64 bit and big or little endian.

At the present time to get the best performance I recommend running it on Raspberry Pi OS Legacy (Buster).

## Usage
The preferred method is to install it as a service so it is always running. See the installation section. However, for testing and development you can run it directly:
```
$ node main.mjs [options]
```

Options:
<table>
<tr><td>-p,</td><td>--port</td><td>Web sockets port (ws://)</td><td>default: 3000</td>
<tr><td>-w,</td><td>--web</td><td>Web server port (http://)</td><td>default: 3080</td>
<tr><td>-b,</td><td>--buzz</td><td>Enable buzz on wake-up</td><td></td>
<tr><td>-f,</td><td>--features</td><td>Send feature reports</td><td>default: depends on OS version</td>
<tr><td>-d,</td><td>--debug</td><td>Enable debug logging</td><td></td>
<tr><td></td><td>--verbose</td><td>Enable verbose logging</td><td></td>
<tr><td>-v</td><td>--version</td><td>Show version number</td><td></td>
<tr><td>-h</td><td>--help</td><td>Show help</td><td></td>
</table>

It creates both a web server and a web-socket server. The web server is just used for testing and spying on the output. Connect to it with your browser and it only serves a single page that displays data coming from the web-socket. You can disable this with `--web=0`. Note: By default the web server is disabled when installed and run as as service and enabled when run from the command line.

In order to support Raspberry Pi OS based on Buster the `--features` option has been introduced. For Bullseye (not recommended) or Bookworm based systems it is not necessary and so the default value (true or false) is determined based on this. Consequently, you should not need to specify this option but can override it with `--features` or `--no-features`. When enabled a feature report is sent to the Surface Dial at appropriate times. This overcomes a bug in Buster that resets the number of dial steps whenever the Surface Dial reconnects.

The Surface Dial's haptic feedback is optional to let you know when it wakes up and is ready to handle gestures. You can enable this with `--buzz`. When running on Bullseye this is very helpful since it takes several seconds to reconnect. On Buster reconnections happen in about 0.2 seconds or less so it's not necessary and that's why I recommend running on Buster.

If buzz or features is enabled you must run DialServer as root which the install does for you. But if you want to run from non-root and need either of these options then you must create a udev rule based on the vendorId and productId. The Microsoft Surface Dial vendorId is 0x045e and the productId is 0x091b. See https://github.com/node-hid/node-hid#udev-device-permissions for an example.

## Installation
I've tested this on an RPi running both 32 bit and 64 bit Raspberry PI OS but it should work, or be easily adapted, to most any Linux.

****IMPORTANT:**** I've discovered when using the latest Raspberry Pi OS (64-bit) (Debian Bullseye) there is a significant delay upon wake-up when the Surface goes to sleep after its been idle for 5 minutes. There is virtually no wake-up delay when running the legacy version of Raspberry Pi OS (32-bit) based on Debian Buster (released 2023-02-21).

This seems to be a driver issue and until it is fixed in the Bullseye version, I recommend using the Debian Buster version. I've verified that this version works well for me:
````
$ uname -a
Linux rpi 5.10.103-v7l+ #1529 SMP Tue Mar 8 12:24:00 GMT 2022 armv7l GNU/Linux
````

### Installation Steps ###
1. Create an image using the Raspberry Pi Imager and boot it on your RPi. I use Raspberry PI Debian **Buster** OS (32-bit) without a desktop environment and SSH for all the rest of the steps.

    ***Important:*** See the issues section below if you intend to install on Raspberry Pi OS based on Bullseye. I currently don't recommend using Bullseye.

2. Update the package list and all packages:
    ```
    $ sudo apt update
    $ sudo apt upgrade
    ```
3. Add Node repository:
    ```
    $ curl -sL https://deb.nodesource.com/setup_16.x | sudo bash -
    ```    
    I'm using v16 LTS but you can use the most recent version if you want:
    ```
    $ curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
    ```

4. Install Node and verify version:
    ```
    $ sudo apt install nodejs
    $ node -v
    ```

    You may also have to install NPM separately if `npm -v` says its not found:
     ```
    $ sudo apt install npm
    $ npm -v
    ```   

5. Install additional development tools to support NPM modules that require compilation. These were already installed on my RPi distribution but you might need them if you use another.
    ```
    $ sudo apt install build-essential libusb-1.0-0 libusb-1.0-0-dev libudev-dev
    ```

## Pairing the Microsoft Surface Dial
You only need to do this once to pair your RPi with the Surface Dial. After it has been paired it will stay paired across reboots of the RPi, etc.

1. For all of these commands use `bluetoothctl`:
    ```
    $ sudo bluetoothctl
    [bluetooth]#
    ```

2. Register the agent:

    ```
    [bluetooth]# agent on
    Agent registered

    [bluetooth]# default-agent
    Default agent request successful
    ```

3. Push the pairing button on the bottom if the Surface Dial (under the rubber base) and hold until the tiny white LED comes on. Then scan for nearby Bluetooth devices and wait for a few seconds for the Surface Dial to be found:
    ```
    [bluetooth]# scan on
    Discovery started
    [NEW] Device XX:XX:XX:XX:XX:XX Surface Dial
    ```
4. Pair to the Surface Dial using its address:
    ```
    [bluetooth]# pair XX:XX:XX:XX:XX:XX
    ...
    [bluetooth]# connect XX:XX:XX:XX:XX:XX
    Attempting to connect to XX:XX:XX:XX:XX:XX
    [CHG] Device XX:XX:XX:XX:XX:XX Connected: yes
    ```
5. Set the Surface Dial to trusted so it can reconnect:
    ```
    [bluetooth]# trust XX:XX:XX:XX:XX:XX
    ```

## Configure and install DialServer
1. Download the contents of this repository to a directory (eg. `~/dialserver`):
    ```
    git clone https://github.com/jaymarnz/dialserver.git
    ```

2. Install required Node packages:
    ````
    $ cd dialserver
    $ npm install
    ````

3. To keep it running all the time you can install it as a service. The install script copies the files to /opt/dialserver and uses systemctl to create, enable and start the dialserver service:
    ````
    $ chmod +x install.sh
    $ sudo ./install.sh
    ````

4. You can also run it directly using the options shown above. If you've already started it as a service then you'll need to stop it first:
    ````
    $ sudo systemctl stop dialserver
    $ node main.mjs [options]
    ````
## Web socket messages
See `index.html` for an example of connecting and viewing the web socket messages. All messages are in JSON format. Examples:
````
{ "button" : "down" }
{ "button" : "up" }
{ "degrees" : 3.1 }
{ "degrees" : -5.3 }
````

## Issues
### ***Falls asleep way too fast - Raspberry Pi OS Bullseye only***
The only issue I'm aware of is the Surface Dial goes to sleep after about 5 mins of inactivity. When running on Raspberry Pi OS Bullseye this is super annoying because there are several seconds delay when it wakes up and reconnects. But I've found when running on Raspberry Pi OS Buster it reconnects nearly instantly. So for now, I recommend sticking with Buster. The Buster legacy OS is available through the Raspberry Pi Imager using the `Raspberry Pi OS (Other)` menu and at https://www.raspberrypi.com/software/operating-systems/#raspberry-pi-os-legacy.

If you do want to run on Bullseye, you'll need to wake up the Surface Dial by pressing the button or turning it and then waiting a few seconds for it come fully awake. At that point it will work as expected until its idle timeout kicks in again. Because of the delay during reconnection and to improve the UX, DialServer can optionally use the Surface Dial's haptic feedback to indicate when it is awake and ready to handle gestures. Use the `--buzz` option to enable this. When running as a service, edit the `dialserver.service` file to add that option to the command line and re-install using `sudo ./install.sh`
````
...

[Service]
Type=idle
ExecStart=/usr/bin/node /opt/dialserver/main.mjs --web=0 --buzz

...
````
