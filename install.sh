#!/bin/bash
#
# ./install.sh handler-name
# handler-name is the file within /dev/input that corresponds with the Surface Dial
#
# To find this file, pair the Surface Dial using bluetoothctl and once paired:
#   cat /proc/bus/input/devices
#
# Look for the handler for "Surface Dial System Multi Axis". It will look like:
#   H: Handlers=event2
#
# For example, you should see a matching file named /dev/input/event2
#
handler="$1"
[ $# -eq 0 ] && { echo "Usage: $0 handler-name"; exit 1; }

[ ! -r "/dev/input/$handler" ] && \
  { echo "/dev/input/$handler does not exist. Pair/connect the Surface Dial to Bluetooth and try again"; exit 1; }

# create the installation directory and edit the service file to include the handler-name
[ ! -d "/opt/dialserver" ] && mkdir -m 664 /opt/dialserver
cp -r * /opt/dialserver
chmod 775 /opt/dialserver/*
sed -i "s/{HANDLER-NAME}/$handler/" /opt/dialserver/dialserver.service

# if present delete the service file link
[ -r /etc/systemd/system/dialserver.service ] && rm -f /etc/systemd/system/dialserver.service

# create a symlink to the service file at /etc/systemd/system/dialserver.service
[ ! -L /etc/systemd/system/dialserver.service ] && ln -s /opt/dialserver/dialserver.service /etc/systemd/system/dialserver.service

# stop the service in case we're upgrading, enable at boot and start it now
systemctl daemon-reload
systemctl stop dialserver.service
systemctl enable --now dialserver.service
