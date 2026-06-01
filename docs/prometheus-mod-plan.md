# Prometheus Metrics Mod — Implementation Plan

A `screepsmod-prometheus` mod that exposes a `/metrics` endpoint for Prometheus, modelled after the reference xxscreeps mod in `reference/prometheus/`.

## Goal

Collect server and per-player metrics from across all processes and expose them at `http://localhost:21025/api/metrics` in the Prometheus text exposition format.

## Architecture

The mod runs in every process (that's how screeps mods work). Each section guards itself with `if (config.engine)` / `if (config.backend)` so the right code only activates in the right process. Metric state is accumulated in `storage.env` (which supports Redis-like `hset/hget/sadd/smembers/setex`), making it accessible cross-process.

```
engine_main  ──┐
engine_runner  ├──▶  storage.env  ──▶  backend /api/metrics  ──▶  Prometheus
engine_processor──┘
```

## Files to Create

```
mods/screepsmod-prometheus/
  index.js        — mod entry point (all logic)
  package.json    — workspace package
```

Enable by adding to `mods.json`:
```json
{ "mods": ["mods/screepsmod-prometheus/index.js"] }
```

## Implementation Sections

### 1. Engine Main Process — tick timing & counts

Hook into `mainLoopStage` events on `config.engine`:

| Stage | Action |
|---|---|
| `'start'` | Record `Date.now()` as tick start |
| `'addUsersToQueue'` | Write `metrics/tick_active_users` = `users.length` |
| `'addRoomsToQueue'` | Write `metrics/tick_active_rooms` = `rooms.length` |
| `'finish'` | Write `metrics/tick_time_ms` = elapsed, `metrics/tick_game_time` from `storage.env.get(GAMETIME)` |

### 2. Runner Process — per-user CPU & memory

Hook into `runnerLoopStage` events on `config.engine`. The `userId` is passed at the `'runUser'` stage; `runResult` is passed at `'saveResultStart'`:

- Track current `userId` from `'runUser'` stage
- On `'saveResultStart'`:
  - `runResult.usedCleanTime` → `hset metrics/user_cpu_last_ms <userId> <value>`
  - `hincrby metrics/user_cpu_total_ms <userId> <value>`
  - `runResult.memory` size → `hset metrics/user_memory_bytes <userId> <size>`
  - On error (`runResult.error`) → `hincrby metrics/user_errors_total <userId> 1`

> **Note**: `runnerLoopStage` passes `userId` at `'runUser'` but not at `'saveResultStart'`, so userId must be captured in a closure between the two events.

### 3. Process Memory Reporter — all processes

Each process (main, runner, backend) runs a `setInterval` every 10 s:
- Key: `metrics/process:<service>:<pid>` with `setex` TTL of 30 s
- Value: JSON with `{ rss, heapTotal, heapUsed, external, service, pid }`
- Register the key in `sadd metrics/active_processes <key>`
- On read, clean up expired keys with `srem`

### 4. Backend Process — `/metrics` endpoint

`config.backend.router.get('/metrics', async (req, res) => { ... })`

Reads all keys from `storage.env` and formats them as Prometheus text:

```
# HELP screeps_tick_time_ms Last game tick duration in milliseconds
# TYPE screeps_tick_time_ms gauge
screeps_tick_time_ms 142

# HELP screeps_user_cpu_last_ms CPU used by player last tick
# TYPE screeps_user_cpu_last_ms gauge
screeps_user_cpu_last_ms{user="Alice"} 38
...
```

Helper: `writeMetric(name, type, help, [{labels, value}])` — same pattern as the reference mod.

## Metrics Exposed

| Metric | Type | Source |
|---|---|---|
| `screeps_tick_time_ms` | gauge | main: finish − start |
| `screeps_tick_game_time` | counter | main: `GAMETIME` env key |
| `screeps_tick_active_users` | gauge | main: users queue length |
| `screeps_tick_active_rooms` | gauge | main: rooms queue length |
| `screeps_user_cpu_last_ms{user}` | gauge | runner: `runResult.usedCleanTime` |
| `screeps_user_cpu_total_ms{user}` | counter | runner: accumulated |
| `screeps_user_memory_bytes{user}` | gauge | runner: `runResult.memory` size |
| `screeps_user_errors_total{user}` | counter | runner: `runResult.error` presence |
| `screeps_process_memory_bytes{service,pid,type}` | gauge | all processes: `process.memoryUsage()` |

## Optional `packages/` Patch — IVM Heap Stats

IVM heap statistics (`heapUsed`, `heapTotal` per player isolate) require a small patch to `packages/driver/lib/runtime/make.js`. Add a call to `isolate.getHeapStatisticsSync()` after execution and write the result into the existing `$set` update that is already sent to the users collection:

```js
// after: const cpuUsed = Math.ceil(runResult.usedCleanTime + intentsCpu);
if (!vm.isolate.isDisposed) {
    const heap = vm.isolate.getHeapStatisticsSync();
    $set.lastHeapUsed  = heap.used_heap_size;
    $set.lastHeapTotal = heap.total_heap_size;
}
```

The mod detects these fields with a null-check (`u.lastHeapUsed != null`) and silently omits the metrics when the patch is not applied. No configuration needed — the mod works without the patch and automatically gains the extra metrics with it.

Skip this for a first version — the mod can be fully self-contained without it.

## Storage Key Reference

| Key | Type | Written by |
|---|---|---|
| `metrics/tick_time_ms` | string | engine main |
| `metrics/tick_game_time` | string | engine main |
| `metrics/tick_active_users` | string | engine main |
| `metrics/tick_active_rooms` | string | engine main |
| `metrics/user_cpu_last_ms` | hash (userId → ms) | runner |
| `metrics/user_cpu_total_ms` | hash (userId → ms) | runner |
| `metrics/user_memory_bytes` | hash (userId → bytes) | runner |
| `metrics/user_errors_total` | hash (userId → count) | runner |
| `metrics/active_processes` | set of keys | all processes |
| `metrics/process:<service>:<pid>` | string (JSON, TTL 30s) | all processes |

## Notes

- `storage.env` must be connected before use: wrap setup in `storage._connect().then(...)` inside the relevant config hook, or use the `pubsub.subscribe(TICK_STARTED)` event as the trigger.
- Username lookup: `storage.env` keys use `userId`. The `/metrics` handler can do a single `storage.db.users.find({})` to build a `userId → username` map for labelling.
- No `pnpm exec gulp` needed — this mod is plain JS, not compiled.
