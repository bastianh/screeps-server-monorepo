#!/bin/sh
# Container entrypoint for the monorepo Screeps server.
#
# 1. Generate runtime config onto the data dir / PVC (package.json, .screepsrc,
#    mods.json, .npmrc, fingerprint) from the operator's config.yml.
# 2. Install core + mods into the PVC, but only when the fingerprint changed
#    (or the launcher binary is missing). The PVC keeps node_modules across
#    restarts, so unchanged boots are instant.
# 3. Hand off to the @screeps/launcher JS launcher.
set -eu

DATA_DIR="${SCREEPS_DATA_DIR:-/screeps}"
CORE_DIR="${SCREEPS_CORE_DIR:-/opt/screeps-core}"
BOOT_DIR="${SCREEPS_BOOT_DIR:-/opt/screeps-boot}"
STAMP_FILE="$DATA_DIR/.boot-stamp"
FINGERPRINT_FILE="$DATA_DIR/.boot-fingerprint"

# pnpm/node-gyp need a writable HOME; the PVC is the only writable mount when
# running as a non-root user.
export HOME="$DATA_DIR"
# Use the node-gyp headers baked into the image so the driver's native build
# does not need network access at boot.
export npm_config_devdir="${NODE_GYP_DEVDIR:-/opt/node-gyp-cache}"

mkdir -p "$DATA_DIR/assets" "$DATA_DIR/logs"

echo "[entrypoint] generating runtime config"
node "$BOOT_DIR/generate.mjs"

WANT="$(cat "$FINGERPRINT_FILE")"
HAVE=""
[ -f "$STAMP_FILE" ] && HAVE="$(cat "$STAMP_FILE")"

NEEDS_INSTALL=0
if [ ! -x "$DATA_DIR/node_modules/.bin/screeps-launcher" ]; then
  NEEDS_INSTALL=1
elif [ "$WANT" != "$HAVE" ]; then
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo "[entrypoint] installing dependencies (fingerprint changed or first boot)"
  cd "$DATA_DIR"
  # pnpm is installed globally in the image; no corepack shim needed (and the
  # shim dir is not writable for the non-root runtime user).
  # --prod: no devDependencies. --no-frozen-lockfile: there is no committed
  # lockfile for the generated package.json; resolve fresh.
  pnpm install --prod --no-frozen-lockfile
  printf '%s\n' "$WANT" > "$STAMP_FILE"
else
  echo "[entrypoint] dependencies up to date, skipping install"
fi

# Seed world data (db.json + assets) from the launcher's init_dist on first run.
# screepsmod-mongo keeps the real data in Mongo, but the built-in storage server
# still loads db.json (and would crash on an empty one), and the backend serves
# ASSET_DIR. Mirrors what `screeps init` / the screeps-launcher does.
LAUNCHER_INIT="$DATA_DIR/node_modules/@screeps/launcher/init_dist"
if [ -d "$LAUNCHER_INIT" ]; then
  if [ ! -f "$DATA_DIR/db.json" ]; then
    echo "[entrypoint] seeding db.json from init_dist"
    cp "$LAUNCHER_INIT/db.json" "$DATA_DIR/db.json"
  fi
  if [ -d "$LAUNCHER_INIT/assets" ] && [ -z "$(ls -A "$DATA_DIR/assets" 2>/dev/null)" ]; then
    echo "[entrypoint] seeding assets from init_dist"
    cp -r "$LAUNCHER_INIT/assets/." "$DATA_DIR/assets/"
  fi
fi

cd "$DATA_DIR"
echo "[entrypoint] starting screeps launcher"
exec "$DATA_DIR/node_modules/.bin/screeps-launcher" start --log_console
