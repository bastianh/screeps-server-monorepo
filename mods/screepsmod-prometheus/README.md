# screepsmod-prometheus

Exposes server and per-player metrics in Prometheus format.

## Endpoints

### `GET /api/metrics` — global
Server-wide metrics for your monitoring stack (VictoriaMetrics/Prometheus):
- `screeps_tick_time_ms` — **histogram** of tick wall-clock duration (le 50…3200,+Inf, `_sum`/`_count`)
- `screeps_rooms_processed_total`, `screeps_users_processed_total` — counters
- `screeps_tick_game_time` — counter
- `screeps_process_memory_bytes{service,instance,type}` — gauge
- per-user `screeps_user_cpu_ms_total` / `screeps_user_cpu_bucket` / `screeps_user_cpu_limit` / `screeps_user_heap_*_bytes` (toggle with `PROM_GLOBAL_INCLUDE_PLAYERS`)

Optionally protected by a shared bearer token (`PROM_GLOBAL_TOKEN`):
`Authorization: Bearer <token>` or `?token=<token>`. Custom player metrics are **never** exposed here.

### `GET /api/metrics/player` — per-player
HTTP Basic Auth with the player's own screeps username + password (verified via screepsmod-auth).
Returns only the authenticated user's series, including their custom metrics:
```
curl -u <username>:<password> https://your-server/api/metrics/player
```

## Custom player metrics (from your code)

Inside your script you can publish numeric gauges:
```js
Game.metrics.set('energy_harvested', 1234);  // upsert a value
Game.metrics.set('gcl_progress', Game.gcl.progress);
Game.metrics.clear();                          // remove all your custom metrics
```
They appear on **your** `/api/metrics/player` as:
```
screeps_custom{username="you", key="energy_harvested"} 1234
```
Notes:
- Keys must match `[a-zA-Z0-9_]{1,64}`; values must be finite numbers; up to `PROM_CUSTOM_MAX_KEYS` keys.
- Values persist until overwritten or `clear()`ed, and expire after `PROM_CUSTOM_TTL`s if you stop updating.
- Each `set()` is a cheap synchronous host call (counts toward your CPU).

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PROM_GLOBAL_TOKEN` | _(empty)_ | If set, `/api/metrics` requires this bearer token |
| `PROM_GLOBAL_INCLUDE_PLAYERS` | `true` | Include per-user cpu/heap series on the global endpoint |
| `PROM_PLAYER_METRICS` | `true` | Enable `/api/metrics/player` |
| `PROM_CUSTOM_METRICS` | `true` | Enable the `Game.metrics` API |
| `PROM_CUSTOM_MAX_KEYS` | `32` | Max custom keys per player |
| `PROM_CUSTOM_TTL` | `90` | Seconds a custom metric survives without updates |
