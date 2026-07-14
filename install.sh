#!/bin/bash

# Make sure we are running as root
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root" 1>&2
  exit 1
fi

# Define color variables
BLUE='\e[34;1m'
NC='\e[0m' # No Color

# determine the directory where this script is located
DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="/opt/dialserver"

# create the target directory if needed, copy files (except node_modules), and set permissions
echo -e "${BLUE}Copying files from $DIR to $DEST${NC}"
[ ! -d "$DEST" ] && mkdir -m 755 $DEST
rsync -rt --delete --exclude node_modules $DIR/ $DEST
find $DEST -type f -print0 | xargs -0 chmod 664
find $DEST -type d -print0 | xargs -0 chmod 755

# build the passive HCI-monitor helper (requires gcc / build-essential)
echo -e "${BLUE}Building dialmon helper${NC}"
if ! gcc -O2 -Wall -o $DEST/dialmon $DEST/dialmon.c; then
  echo "ERROR: failed to build dialmon (is build-essential installed?)" 1>&2
  exit 1
fi
chmod 755 $DEST/dialmon

# install dependencies
echo -e "${BLUE}Installing dependencies${NC}"
(cd $DEST; npm install)

echo -e "${BLUE}Updating service links${NC}"

# if present delete the service file link
[ -r /etc/systemd/system/dialserver.service ] && rm -f /etc/systemd/system/dialserver.service

# create a symlink to the service file at /etc/systemd/system/dialserver.service
[ ! -L /etc/systemd/system/dialserver.service ] && ln -s $DEST/dialserver.service /etc/systemd/system/dialserver.service

# stop the service in case we're upgrading, enable at boot and start it now
echo -e "${BLUE}Starting the service${NC}"

systemctl daemon-reload
systemctl stop dialserver.service
systemctl enable --now dialserver.service
