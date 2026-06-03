# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Key Commands

**Install dependencies:**
```bash
pnpm install
```

**Build the game engine (required once after install):**
```bash
cd packages/engine && pnpm exec gulp && cd ../..
```

**Start the server (foreground with logs):**
```bash
node packages/launcher/bin/screeps.js start --log_console
```

**Connect to the running server CLI:**
```bash
npx screeps cli
```

**Update a core Screeps subtree package:**
```bash
pnpm subtree:update:engine   # or: common, backend, driver, launcher, storage
pnpm subtree:update:all      # update all at once
```

**Run engine tests:**
```bash
cd packages/engine && pnpm test
```

## Architecture

This is a **pnpm monorepo** (`pnpm-workspace.yaml`) with two types of packages:

- **`packages/`** — Official Screeps server core modules, integrated via `git subtree` (not edited directly unless syncing upstream changes):
  - `common` — Shared constants, config manager, and the storage client used by all other modules
  - `engine` — Game engine compiled from `src/` via Gulp into `dist/`; runs as `main`, `runner`, and `processor` processes
  - `driver` — Bridge between engine and storage; native module (`isolated-vm`) requiring Node 24
  - `storage` — Standalone storage server using LokiJS; persists to `db.json`
  - `backend-local` — Express web server exposing the HTTP API at port 21025
  - `launcher` — Reads `.screepsrc`, spawns all sub-processes (storage, backend, engine main, runners, processors)

- **`mods/`** — Custom server mods (workspace packages). `example-mod` shows the pattern.

All internal packages reference each other via `workspace:*` — changes to a core package are immediately reflected across the workspace.

## Server Process Model

The launcher spawns these processes in order: `storage` → `backend` → `engine_main` → `engine_runner1..N` → `engine_processor1..N`. Count is configured in `.screepsrc` via `runners_cnt`, `runner_threads`, and `processors_cnt`.

## Mod Development

Every mod exports a single function called at server init:

```javascript
const common = require('@screeps/common');

module.exports = function(config) {
    // config keys: common, storage, backend, engine, driver
};
```

To enable a mod, add its path to `mods.json`:
```json
{ "mods": ["mods/my-mod/index.js"] }
```

### Storage API (via `@screeps/common`)

```javascript
const storage = require('@screeps/common').storage;
await storage._connect();

storage.db.users.findOne({ username: 'name' })
storage.db['rooms.objects'].update(query, { $set: { hits: 100 } })
storage.env.get(storage.env.keys.GAMETIME)
storage.pubsub.subscribe(storage.pubsub.keys.TICK_STARTED, (tick) => { })
```

### Adding HTTP Endpoints

```javascript
module.exports = function(config) {
    if (config.backend) {
        // Mount under /api:
        config.backend.router.get('/my-mod/status', (req, res) => res.json({ ok: true }));

        // Or hook into Express app lifecycle:
        config.backend.on('expressPostConfig', (app) => {
            app.get('/custom-route', (req, res) => res.send('hello'));
        });
    }
};
```

## Local patches to `packages/`

These files diverge intentionally from upstream. When a `subtree:update` produces a conflict in one of them, keep both the upstream change and the local addition.

| File | What was changed | Why |
|---|---|---|
| `packages/driver/lib/runtime/make.js` | Writes `lastHeapUsed` / `lastHeapTotal` into the user `$set`, and `$inc`s `metricsCpuMsTotal` (cumulative CPU ms), after each IVM execution | `screepsmod-prometheus` reads these fields for `/metrics` |
| `packages/driver/.npmignore` | Removed `build` from the ignore list | So the webpack-built `build/runtime.bundle.js` is included when the driver is `pnpm pack`ed for the container image |
| `packages/driver/package.json` | Added `@screeps/pathfinding` to `dependencies` | The bundled runtime (`lib/runtime/mapgrid.js`) requires it; it must resolve from the driver's own `node_modules` during the webpack build |

**The driver's IVM runtime bundle must be webpack-built** (`cd packages/driver && pnpm exec webpack`) before packing/running — the official `screeps` package does this in its postinstall. Without `build/runtime.bundle.js` the runner cannot create user isolates and **no player code executes**. The container `Dockerfile` runs this after the engine gulp build.

**Container image must be built for the cluster arch** (`docker buildx build --platform linux/amd64`); the zeta nodes are amd64 while the typical build host (Apple Silicon) is arm64 — a mismatched image fails with `exec format error`.

## Conventions

- **Node version**: Always Node 24 (pinned in `mise.toml`). Use `mise exec -- node ...` if your shell doesn't auto-activate mise.
- **`workspace:*` protocol** for all internal `@screeps/` dependencies.
- The `screepsmod-client` symlink at the root points to `../screeps-client/screeps-mod-client/dist` — it must exist for the client mod to work.
