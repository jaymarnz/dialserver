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
$ node main.mjs <event-file> [options]`
```

`event-file` is required and is found in /dev/input. See the installation instructions to determine the name of this file.

Options:
<table>
<tr><td>-p,</td><td>--port</td><td>Web sockets port (ws://)</td><td>default: 3000</td>
<tr><td>-w,</td><td>--web</td><td>Web server port (http://)</td><td>default: 3080</td>
<tr><td>-d,</td><td>--debug</td><td>Enable debug logging</td><td></td>
<tr><td></td><td>--verbose</td><td>Enable verbose logging</td><td></td>
<tr><td>-v</td><td>--version</td><td>Show version number</td><td></td>
<tr><td>-h</td><td>--help</td><td>Show help</td><td></td>
</table>

By default it creates both a web server and a web-socket server. The web server is just used for testing and spying on the output. Connect to it with your browser and it only serves a single page that displays data coming from the web-socket. You can disable this with `-w 0`

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
    I'm using v16 LTS but you can use the most recent version if you want
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
You only need to do this once to pair your RPi with the Suface Dial. After it has been paired it should stay paired across reboots of the RPi, etc.

Thanks to https://cuteprogramming.wordpress.com/2020/10/31/controlling-raspberry-pi-with-surface-dial/ for this and other useful Surface Dial info.

1. For all of these commands we use `bluetoothctl`
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

5. Once you've paired the Surface Dial an event file is created in `/dev/input`. You now just need to figure out which one corresponds to the Surface Dial.
    ````
    $ cat /proc/bus/input/devices
    ````
    You'll see something like this:
    ````
    ...
    I: Bus=0005 Vendor=045e Product=091b Version=0108
    N: Name="Surface Dial System Multi Axis"
    ...
    H: Handlers=event2 
    ...
      
    I: Bus=0005 Vendor=045e Product=091b Version=0108
    N: Name="Surface Dial System Control"
    ...
    H: Handlers=kbd event3  
    ...
    ````
    The one you want is associated with "Surface Dial System Multi Axis". This provides the raw data stream. In this example "event2". This is what you'll pass to DialServer when running it directly or to the install script for running it as a service.

    ***Note:*** The Surface Dial times out and goes to sleep after about 5 minutes of inactivity. While it is asleep the event handler file won't be there anymore. So if it's taken a few minutes to do the above, touch the Surface Dial (click or rotate it) and it will wake up although it takes a second or so for it to wake up. See below for this issue.

## Configure and install DialServer
1. Copy the contents of this repository to a directory somewhere (eg. `~/dialserver`)

2. Download required Node packages
    ````
    $ cd ~/dialserver
    $ npm install
    ````

3. To keep it running all the time you can install it as a service substituting the event file from where you paired the Surface Dial in the steps above.
    ````
    $ chmod +x install.sh
    $ ./install <event-file>
    ````

4. You can also run it directly using the options shown above. If you've already started it as a service then you'll need to stop it first
    ````
    $ sudo systemctl stop dialserver.service
    $ node main.mjs <event-file>
    ````
## Web socket messages
See `index.html` for an example of connecting and viewing the web socket messages. All messages are in JSON format. Examples:
````
{ "button" : "up" }
{ "button" : "down" }
{ "degrees" : "3.1" }
{ "degrees" : "-5.3" }
````

## Issues
### ***Falls asleep way too fast***
The only issue I'm aware of is the Surface Dial goes to sleep after about 5 mins of inactivity. This is super annoying! But I haven't been able to find any info about how to work-around this yet. So, you'll need to wake it up by pressing the button or turning it and then wait a few seconds for it come fully awake. At that point it will work as expected until its idle timeout kicks in again.

## Roadmap
1. I'd like to figure out how to keep the Surface Dial awake for longer. Perhaps this can be done by exploring the Surface Dial System Control event handler. If anyone has experience with this, I'd appreciate hearing about it.

2. I use this Web Socket server with my BluView web app to display and control a Bluesound NODE. It works great but I'd like to experiment with using the Web Bluetooth api to see if I can interface BluView directly to the Surface and eliminate it's need for this Web Socket server. See that repository if you are interested or have information to share.
