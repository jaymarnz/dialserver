#!/bin/bash

# Make sure we are running as root
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root" 1>&2
  exit 1
fi

# determine the directory where this script is located
DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# if /opt/dialserver/ exists, delete it (this also facilitates updating from npm to pnpm)
[ -d /opt/dialserver ] && rm -rf /opt/dialserver

# create the target directory, copy files (except node_modules) and set permissions
mkdir -m 755 /opt/dialserver
(cd $DIR; rsync -rt --exclude node_modules . /opt/dialserver)
chmod 664 /opt/dialserver/*

# install dependencies
(cd /opt/dialserver; pnpm install)

# if present delete the service file link
[ -r /etc/systemd/system/dialserver.service ] && rm -f /etc/systemd/system/dialserver.service

# create a symlink to the service file at /etc/systemd/system/dialserver.service
[ ! -L /etc/systemd/system/dialserver.service ] && ln -s /opt/dialserver/dialserver.service /etc/systemd/system/dialserver.service

# stop the service in case we're upgrading, enable at boot and start it now
systemctl daemon-reload
systemctl stop dialserver.service
systemctl enable --now dialserver.service
