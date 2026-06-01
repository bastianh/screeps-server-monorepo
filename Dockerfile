FROM node:24-slim

# Build tools needed to compile native modules (isolated-vm, native.node)
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.2

WORKDIR /app

# Install dependencies first (better layer caching).
# packages/driver/native/ must be present alongside its package.json because
# pnpm install triggers node-gyp rebuild -C native as an install script.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common/package.json      packages/common/
COPY packages/driver/package.json      packages/driver/
COPY packages/driver/native/           packages/driver/native/
COPY packages/engine/package.json      packages/engine/
COPY packages/storage/package.json     packages/storage/
COPY packages/backend-local/package.json packages/backend-local/
COPY packages/launcher/package.json    packages/launcher/
COPY mods/example-mod/package.json     mods/example-mod/
COPY mods/screepsmod-prometheus/package.json mods/screepsmod-prometheus/

RUN pnpm install

# Copy sources and build engine
COPY packages/ packages/
COPY mods/     mods/

RUN cd packages/engine && pnpm exec gulp

# Runtime config and data
COPY .screepsrc mods.json ./
RUN mkdir -p assets logs

EXPOSE 21025 21026

CMD ["node", "packages/launcher/bin/screeps.js", "start", "--log_console"]
