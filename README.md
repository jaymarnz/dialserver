# DialServer - WebSocket interface for Surface Dial
This is a Web Socket server that provides a continous stream of decoded events from a Microsoft Surface Dial. It's intended to be used to feed a volume controller for network streamers or other network connected audio devices. In particular it works with my [BluView app to control volume and playback on a BlueOS device like a BlueSound NODE](https://github.com/jaymarnz/bluview).

It's designed to run on a Raspberry Pi Zero 2W and the installation instructions are for that device but it should also be easily adapted to other devices running Linux.

## Example web socket messages
See `index.html` for an example of connecting and viewing the web socket messages. All messages are in JSON format. Examples:
````
{ "button" : "down" }
{ "button" : "up" }
{ "degrees" : 3.1 }
{ "degrees" : -5.3 }
````

## Operating system choices
At the present time to get the best performance I recommend running it on Raspberry Pi OS Legacy Buster. I've tested on Bullseye and Bookworm but Buster has significantly better performance when the Surface Dial comes out of sleep and reconnects. This happens when idle for 5 minutes so it has a big effect on the UX.

## Usage
The preferred method is to install it as a service so it's always running. See the installation section. However, for testing and development you can run it directly:
```
$ sudo node main.mjs [options]
```

Options:
<table>
<tr><td>-p,</td><td>--port</td><td>Web sockets port (ws://)</td><td>default: 3000</td>
<tr><td>-w,</td><td>--web</td><td>Web server port (http://)</td><td>default: 3080</td>
<tr><td>-b,</td><td>--buzz</td><td>Enable buzz on wake-up</td><td></td>
<tr><td>-d,</td><td>--debug</td><td>Enable debug logging</td><td></td>
<tr><td></td><td>--verbose</td><td>Enable verbose logging</td><td></td>
<tr><td>-v</td><td>--version</td><td>Show version number</td><td></td>
<tr><td>-h</td><td>--help</td><td>Show help</td><td></td>
</table>

It creates both a web server and a web-socket server. The web server is just used for spying on the output primarily for debugging. Connect to it with your browser and it serves a single page that displays data coming from the web-socket. See [index.html](https://github.com/jaymarnz/dialserver/blob/master/index.html) for an example. You can disable the web server with `--web=0`. By default the web server is disabled when run as as service and enabled when run from the command line.

The Surface Dial's haptic feedback is optional to let you know when it wakes up and is ready to handle gestures. You can enable this with `--buzz`. When running on Bullseye or Bookworm this is very helpful since it takes several seconds to reconnect. On Buster reconnections happen in about 0.2 seconds or less so it's not necessary and that's why I recommend running on Buster.

## Running as root
By default DialServer needs to be run as root which the install does for you. But if you want to run from non-root then you must create a udev rule based on the vendorId and productId. I had trouble getting this to work but you might give it try. The Microsoft Surface Dial vendorId is 0x045e and the productId is 0x091b. See https://github.com/node-hid/node-hid#udev-device-permissions for an example. I don't view running as root a big issue since the Rpi is dedicated to the Surface Dial and doesn't do anything else.

## Installation
I've tested this on an RPi Zero 2W with 64 bit Raspberry PI OS but it should work, or be easily adapted, to most any other Linux.

****IMPORTANT:**** I've found when using Raspberry Pi OS Bullseye and Bookworm there is a significant delay upon reconnect when the Surface Dial goes to sleep after its been idle for 5 minutes. There is virtually no delay when running the legacy version of Raspberry Pi OS based on Debian Buster.

Consequently, I recommend using the Debian Buster version. I've verified that this version works well for me:
````
$ uname -a
Linux dialserver2 5.10.103-v8+ #1529 SMP PREEMPT Tue Mar 8 12:26:46 GMT 2022 aarch64 GNU/Linux
````

### Installation Steps ###
1. Download and unzip the official Buster legacy version:
https://downloads.raspberrypi.org/raspios_lite_arm64/images/raspios_lite_arm64-2021-05-28/2021-05-07-raspios-buster-arm64-lite.zip 

1. Create an image on an SD card using the Raspberry Pi Imager. You can download the official imager from: https://www.raspberrypi.com/software/

    Select the custom OS option and the image from the zip file: ***2021-05-07-raspios-buster-arm64-lite.img***

    **IMPORTANT:** This is the lite image with no GUI so set the SSH parameters in the Raspberry Pi Imager before you create the image.

1. Because this image was created prior to the Zero 2 you need to copy a file on the SD card after the image has been created. Look for the **boot** partition and copy ***bcm2710-rpi-3-b.dtb*** to ***bcm2710-rpi-zero-2.dtb***. For example on a MacOS terminal (you can do this with Finder or Windows Explorer too):
    ```
    $ cp /Volumes/boot/bcm2710-rpi-3-b.dtb /Volumes/boot/bcm2710-rpi-zero-2.dtb
    ```

1. Unmount the SD card, put it in your Rpi, and boot it.

1. ssh to the Rpi and update the package list and all packages (the upgrade takes a few minutes):
    ```
    $ sudo apt update
    $ sudo apt upgrade -y
    ```

1. Add the Node repository and install Node 16 (this version is needed in order to install some of the dependencies on the old Buster legacy OS):
    ```
    $ curl -sL https://deb.nodesource.com/setup_16.x | sudo bash -
    $ sudo apt install -y nodejs

1. Install additional development tools to support NPM modules that require compilation:
    ```
    $ sudo apt install -y build-essential libusb-1.0-0 libusb-1.0-0-dev libudev-dev git curl
    ```
1. Reboot to get everything up-to-date:
    ```
    $ sudo reboot
    ````

    At this stage you should now be running the final version of Buster with all dependencies installed. Reconnect via ssh and verify the OS version. Here is what mine looks like:
    ```
    $ uname -a
    Linux dialserver2 5.10.103-v8+ #1529 SMP PREEMPT Tue Mar 8 12:26:46 GMT 2022 aarch64 GNU/Linux
    ```

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

## Issues
### ***Raspberry Pi OS Bullseye and Bookworm***
The only issue I'm aware of is the Surface Dial goes to sleep after about 5 mins of inactivity. When running on Raspberry Pi OS Bullseye or Bookworm this is super annoying because there are several seconds delay when it wakes up and reconnects. But I've found when running on Raspberry Pi OS Buster it reconnects almost instantly. So I recommend sticking with Buster. The Buster legacy OS is no longer available through the Raspberry Pi Imager's browser but you can download the official version from the links in the **Installation Steps** above.

If you do want to run on Bullseye or Bookworm, you'll need to wake up the Surface Dial by pressing the button or turning it and then waiting for it come fully awake. At that point it will work as expected until its idle timeout kicks in again.

Because of this delay during reconnection and to improve the UX, DialServer can optionally use the Surface Dial's haptic feedback to indicate when it is awake and ready to handle gestures. Use the `--buzz` option to enable this. When running as a service, edit the `dialserver.service` file to add that option to the command line and re-install using `sudo bash ~/dialserver/install.sh`
````
...

[Service]
Type=idle
ExecStart=/usr/bin/node /opt/dialserver/main.mjs --web=0 --buzz

...
````
