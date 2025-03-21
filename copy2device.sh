#!/bin/bash

# usage: ./copy2device.sh [host]
# default host name if not supplied: "dialserver"

SOURCE_DIR="."
HOST=${1:-dialserver}
DESTINATION="${USER}@${HOST}:dialserver"

EXCLUDE=(
  --exclude ".*"
  --exclude "devdocs"
  --exclude "node_modules"
  --exclude "copy2device.sh"
  --exclude "install-node-*.sh"
)
rsync -az "${EXCLUDE[@]}" --out-format="%f%L" "$SOURCE_DIR" "$DESTINATION"
