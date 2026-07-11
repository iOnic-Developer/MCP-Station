#!/bin/sh
# Seed bundled modules (telegram, gemini, _template) into the mcps volume
# without overwriting anything the user has created or edited.
set -e

mkdir -p "$MCPS_DIR"
for d in /app/mcps-dist/*/; do
  name="$(basename "$d")"
  if [ ! -d "$MCPS_DIR/$name" ]; then
    cp -r "$d" "$MCPS_DIR/$name"
    echo "[entrypoint] seeded module: $name"
  fi
done

exec node server/index.js
