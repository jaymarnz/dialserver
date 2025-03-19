#!/bin/bash

SOURCE_DIR="."
DESTINATION="${USER}@dialserver:dialserver"

EXCLUDE=(
  --exclude ".*"
  --exclude "devdocs"
  --exclude "node_modules"
  --exclude "copy2device.sh"
  --exclude "install-node-*.sh"
)
rsync -az "${EXCLUDE[@]}" --out-format="%f%L" "$SOURCE_DIR" "$DESTINATION"
