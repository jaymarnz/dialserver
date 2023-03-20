#!/bin/bash
# create the target directory, copy files and set permissions
[ ! -d "/opt/dialserver" ] && mkdir -m 755 /opt/dialserver
cp -r * /opt/dialserver
chmod 664 /opt/dialserver/*

# if present delete the service file link
[ -r /etc/systemd/system/dialserver.service ] && rm -f /etc/systemd/system/dialserver.service

# create a symlink to the service file at /etc/systemd/system/dialserver.service
[ ! -L /etc/systemd/system/dialserver.service ] && ln -s /opt/dialserver/dialserver.service /etc/systemd/system/dialserver.service

# stop the service in case we're upgrading, enable at boot and start it now
systemctl daemon-reload
systemctl stop dialserver.service
systemctl enable --now dialserver.service
