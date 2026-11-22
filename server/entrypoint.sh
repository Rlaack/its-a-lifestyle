#!/bin/sh
set -e
# Only touch ownership if the volume isn't already writable by the app user.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  [ "$(stat -c %U /data)" = "node" ] || chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups node /app/relay.mjs
fi
exec node /app/relay.mjs
