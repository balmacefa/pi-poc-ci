#!/usr/bin/env bash
# Starts pi: the local build mounted at /opt/pi-local when present, otherwise the pi installed from npm.
set -eu

if [ -f /opt/pi-local/dist/bundle/cli.js ]; then
  # The mounted checkout has no node_modules (they live at the repo root); reuse the ones npm installed for pi.
  export NODE_PATH=/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules
  exec node /opt/pi-local/dist/bundle/cli.js "$@"
fi
exec pi "$@"
