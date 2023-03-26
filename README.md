# DialServer - WebSocket interface for Microsoft Surface Dial
This is a Web Socket server that provides a continous stream of decoded events from a Microsoft Surface Dial.

It's intended to be used to feed a volume controller for network streamers or other network connected audio devices.
In particular it works with my BluView app to control volume and playback on a BlueOS device like a BlueSound NODE.

It is designed to run on pretty-much any Linux box. I'm currently using it on a Raspberry Pi and the installation
instructions are for that OS but should either work or be easily adapted to others.

The code is designed to be portable between 32/64 bit and big or little endian but I've only tested on 64 bit BE.

## Usage
The preferred method is to install it as a service so it is always running. See the installation section. However, for testing and development you can run it directly:
```
$ node main.mjs [options]
```

Options:
<table>
<tr><td>-p,</td><td>--port</td><td>Web sockets port (ws://)</td><td>default: 3000</td>
<tr><td>-w,</td><td>--web</td><td>Web server port (http://)</td><td>default: 3080</td>
<tr><td>-b,</td><td>--no-buzz</td><td>Disable buzz on wake-up</td><td></td>
<tr><td>-d,</td><td>--debug</td><td>Enable debug logging</td><td></td>
<tr><td></td><td>--verbose</td><td>Enable verbose logging</td><td></td>
<tr><td>-v</td><td>--version</td><td>Show version number</td><td></td>
<tr><td>-h</td><td>--help</td><td>Show help</td><td></td>
</table>

By default it creates both a web server and a web-socket server. The web server is just used for testing and spying on the output. Connect to it with your browser and it only serves a single page that displays data coming from the web-socket. You can disable this with `-w 0`

It uses the Surface Dial's haptic feedback to let you know when it wakes up and is ready to handle gestures. You can disable this with `--no-buzz`. If buzz is enabled you must run DialServer as root which the install below does for you. But if you want to run from non-root and have buzz on wake-up then you must create a udev rule based on the vendorId and productId. The Microsoft Surface Dial vendorId is 0x045e and the productId is 0x091b. See https://github.com/node-hid/node-hid#udev-device-permissions for an example.

## Installation
I've tested this on an RPi running 64 bit Raspberry PI OS but it should work, or be easily adapted, to most any Linux.

1. Create an image using the Raspberry Pi Imager and boot it on your RPi. I used Raspberry PI OS (64-bit) without a desktop environment and used SSH for all the rest of the steps.

2. Update the package list and all packages
    ```
    $ sudo apt update
    $ sudo apt upgrade
    ```
3. Add Node repository
    ```
    $ curl -sL https://deb.nodesource.com/setup_16.x | sudo bash -
    ```    
    I'm using v16 LTS but you can use the most recent version if you want:
    ```
    $ curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
    ```

4. Install Node and verify version
    ```
    $ sudo apt install nodejs
    $ node -v
    ```

5. Install additional development tools to support NPM modules that require compilation. These were already installed on my RPi distribution but you might need them if you use another.
    ```
    $ sudo apt install build-essential
    ```

## Pairing the Microsoft Surface Dial
You only need to do this once to pair your RPi with the Surface Dial. After it has been paired it will stay paired across reboots of the RPi, etc.

Thanks to https://cuteprogramming.wordpress.com/2020/10/31/controlling-raspberry-pi-with-surface-dial/ for this and other useful Surface Dial info.

1. For all of these commands use `bluetoothctl`
    ```
    $ sudo bluetoothctl
    [bluetooth]#
    ```

2. Register the agent

    ```
    [bluetooth]# agent on
    Agent registered

    [bluetooth]# default-agent
    Default agent request successful
    ```

3. Scan for neary Bluetooth devices and wait for a few seconds for the Surface Dial to be found
    ```
    [bluetooth]# scan on
    Discovery started
    [NEW] Device XX:XX:XX:XX:XX:XX Surface Dial
    ```
4. Pair to the Surface Dial using its address
    ```
    [bluetooth]# pair XX:XX:XX:XX:XX:XX
    ...
    [bluetooth]# connect XX:XX:XX:XX:XX:XX
    Attempting to connect to XX:XX:XX:XX:XX:XX
    [CHG] Device XX:XX:XX:XX:XX:XX Connected: yes
    ```

## Configure and install DialServer
1. Download the contents of this repository to a directory somewhere (eg. `~/dialserver`)

2. Install required Node packages
    ````
    $ cd ~/dialserver
    $ npm install
    ````

3. To keep it running all the time you can install it as a service. The install script copies the files to /opt/dialserver and uses systemctl to create, enable and start the dialserver.service
    ````
    $ chmod +x install.sh
    $ sudo ./install.sh
    ````

4. You can also run it directly using the options shown above. If you've already started it as a service then you'll need to stop it first
    ````
    $ sudo systemctl stop dialserver.service
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
### ***Falls asleep way too fast***
The only issue I'm aware of is the Surface Dial goes to sleep after about 5 mins of inactivity. This is super annoying! But I haven't been able to find any info about how to work-around this yet. So, you'll need to wake it up by pressing the button or turning it and then wait a few seconds for it come fully awake. At that point it will work as expected until its idle timeout kicks in again. Because of the short delay during wake-up and to improve the UX, DialServer uses the Surface Dial's haptic feedback to indicate when it is awake and ready to handle gestures.

## Roadmap
1. I'd like to figure out how to keep the Surface Dial awake for longer. Perhaps this can be done via the Surface Dial's Control endpoint. If anyone has experience with this, I'd appreciate hearing about it.

2. I use this Web Socket server with my BluView web app to display and control a Bluesound NODE. It works great but I'd like to experiment with using the Web Bluetooth api to see if I can interface BluView directly and eliminate its need for this Web Socket server. See that repository if you are interested or have information to share about using Web Bluetooth with a Surface Dial.
