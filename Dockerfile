# syntax=docker/dockerfile:1
#
# Multi-stage build for the monorepo Screeps server.
#
#  build stage:   install the workspace, build the engine (gulp), and pack the
#                 core @screeps/* packages (including the locally-patched
#                 driver) plus local mods into /opt/screeps-core/*.tgz.
#  runtime stage: ship the tarballs + a boot generator. At container start the
#                 entrypoint installs core + operator-chosen mods onto the PVC
#                 (node-linker=hoisted) and launches the server. Mods are added
#                 by editing config.yml (ConfigMap) + restart -- no rebuild.
#
# The driver's native.node is rebuilt via node-gyp during the on-PVC install,
# so the runtime image carries the toolchain plus baked node-gyp headers for an
# offline build. isolated-vm uses its published prebuilt binary.

# ---------------------------------------------------------------------------
FROM node:24-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.2

WORKDIR /app

# Manifests first for layer caching. driver/native must accompany its
# package.json because pnpm install triggers node-gyp rebuild -C native.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common/package.json        packages/common/
COPY packages/driver/package.json        packages/driver/
COPY packages/driver/native/             packages/driver/native/
COPY packages/engine/package.json        packages/engine/
COPY packages/storage/package.json       packages/storage/
COPY packages/backend-local/package.json packages/backend-local/
COPY packages/launcher/package.json      packages/launcher/
COPY mods/example-mod/package.json       mods/example-mod/
COPY mods/screepsmod-prometheus/package.json mods/screepsmod-prometheus/

# --no-frozen-lockfile: the workspace root lists runtime mods (screepsmod-*)
# that are installed onto the PVC at boot, not baked here, and may not be in the
# lockfile. The build only needs to gulp the engine and pack the core packages,
# so resolving them loosely is fine.
RUN pnpm install --no-frozen-lockfile

# Sources + engine build
COPY packages/ packages/
COPY mods/     mods/
RUN cd packages/engine && pnpm exec gulp

# Build the driver's IVM runtime bundle (build/runtime.bundle.js). The official
# `screeps` package does this in its postinstall; without it the runner cannot
# create user isolates and no player code executes. The .npmignore was patched
# to stop excluding build/ so it is included in the packed tarball. The snapshot
# is dropped so the runtime falls back to compiling the bundle (avoids any
# cross-build V8 snapshot mismatch); it is only a cold-start optimization.
RUN cd packages/driver && pnpm exec webpack && rm -f build/runtime.snapshot.bin

# Pack core packages and local mods to stable tarball names.
RUN mkdir -p /opt/screeps-core \
 && pnpm --filter @screeps/common   pack --out /opt/screeps-core/screeps-common.tgz \
 && pnpm --filter @screeps/driver   pack --out /opt/screeps-core/screeps-driver.tgz \
 && pnpm --filter @screeps/engine   pack --out /opt/screeps-core/screeps-engine.tgz \
 && pnpm --filter @screeps/storage  pack --out /opt/screeps-core/screeps-storage.tgz \
 && pnpm --filter @screeps/backend  pack --out /opt/screeps-core/screeps-backend.tgz \
 && pnpm --filter @screeps/launcher pack --out /opt/screeps-core/screeps-launcher.tgz \
 && pnpm --filter screepsmod-prometheus pack --out /opt/screeps-core/screepsmod-prometheus.tgz

# Cache node-gyp headers for the runtime native rebuild (offline at boot).
RUN npx --yes node-gyp install --devdir /opt/node-gyp-cache

# ---------------------------------------------------------------------------
FROM node:24-slim

# Toolchain for the on-PVC native rebuild of the driver at boot.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.2

# Baked tarballs + node-gyp headers from the build stage.
COPY --from=build /opt/screeps-core  /opt/screeps-core
COPY --from=build /opt/node-gyp-cache /opt/node-gyp-cache

# Boot generator (config.yml -> runtime config) + its js-yaml dependency.
COPY docker/generate.mjs   /opt/screeps-boot/generate.mjs
COPY docker/entrypoint.sh  /opt/screeps-boot/entrypoint.sh
COPY docker/boot-package.json /opt/screeps-boot/package.json
RUN cd /opt/screeps-boot && npm install --omit=dev --no-package-lock \
 && chmod +x /opt/screeps-boot/entrypoint.sh

ENV SCREEPS_DATA_DIR=/screeps \
    SCREEPS_CORE_DIR=/opt/screeps-core \
    SCREEPS_BOOT_DIR=/opt/screeps-boot \
    NODE_GYP_DEVDIR=/opt/node-gyp-cache

WORKDIR /screeps
EXPOSE 21025 21026

ENTRYPOINT ["/opt/screeps-boot/entrypoint.sh"]
