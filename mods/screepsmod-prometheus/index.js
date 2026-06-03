'use strict';
const os = require('os');
const common = require('@screeps/common');
const storage = common.storage;

// Tick wall-clock histogram bucket boundaries (le, milliseconds). +Inf implicit.
const TICK_LE = [50, 100, 150, 200, 250, 400, 800, 1600, 3200];

// Redis keys (accumulated by engine_main, the single writer of these keys).
const HIST_KEY = 'metrics/tick_time_hist';        // hash: <le>|inf|sum|count
const ROOMS_KEY = 'metrics/rooms_processed_total'; // cumulative counter
const USERS_KEY = 'metrics/users_processed_total'; // cumulative counter
const GAMETIME_KEY = 'metrics/tick_game_time';

// Determine which server role this process is running as.
// Engine main and runner share config.engine, so we distinguish them by argv.
function detectRole(config) {
    if (config.backend) return 'backend';
    const script = (process.argv[1] || '').replace(/\\/g, '/');
    if (script.endsWith('runner.js')) return 'engine_runner';
    if (script.endsWith('main.js'))   return 'engine_main';
    return 'engine';
}

module.exports = function(config) {
    const role = detectRole(config);
    const pid  = process.pid;
    const hostname = process.env.HOSTNAME || os.hostname();
    const processKey = `metrics/process:${role}:${hostname}:${pid}`;

    // ── Process memory reporter — runs in every process ───────────────────────
    // Keys are written with a 30s TTL; expired entries are filtered out at read time.
    const reportProcessMemory = async () => {
        try {
            const m = process.memoryUsage();
            await Promise.all([
                storage.env.setex(processKey, 30, JSON.stringify({
                    service: role, instance: `${hostname}:${pid}`, pid,
                    rss: m.rss, heapTotal: m.heapTotal,
                    heapUsed: m.heapUsed, external: m.external,
                })),
                storage.env.sadd('metrics/active_processes', processKey),
            ]);
        } catch (_) {}
    };

    // We deliberately do NOT call storage._connect() here (see git history): with
    // screepsmod-mongo that flips _connected before the async collection wrapping
    // completes and crash-loops the engine. Each process connects on its own; the
    // guarded calls below simply no-op until then.
    reportProcessMemory();
    setInterval(reportProcessMemory, 10000);

    // ── Engine main: accumulate tick-rate-independent counters/histogram ───────
    // The game ticks faster than Prometheus scrapes, so per-tick gauges alias.
    // engine_main is the only writer of these keys, so plain read-modify-write is
    // race-free, and the values persist across restarts (true cumulative counters).
    if (config.engine) {
        let tickStart = 0;

        config.engine.on('mainLoopStage', async (stage, data) => {
            try {
                if (stage === 'start') {
                    tickStart = Date.now();
                } else if (stage === 'addUsersToQueue' && Array.isArray(data)) {
                    await addToCounter(USERS_KEY, data.length);
                } else if (stage === 'addRoomsToQueue' && Array.isArray(data)) {
                    await addToCounter(ROOMS_KEY, data.length);
                } else if (stage === 'finish' && tickStart > 0) {
                    const elapsed = Date.now() - tickStart;
                    tickStart = 0;
                    await recordTick(elapsed);
                    const gameTime = await storage.env.get(storage.env.keys.GAMETIME);
                    await storage.env.set(GAMETIME_KEY, String(gameTime || 0));
                }
            } catch (_) {}
        });
    }

    async function addToCounter(key, delta) {
        const cur = parseFloat(await storage.env.get(key)) || 0;
        await storage.env.set(key, String(cur + delta));
    }

    async function recordTick(elapsed) {
        const h = (await storage.env.hgetall(HIST_KEY)) || {};
        let field = 'inf';
        for (const le of TICK_LE) { if (elapsed <= le) { field = String(le); break; } }
        const update = {};
        update[field] = String((parseFloat(h[field]) || 0) + 1);
        update.sum = String((parseFloat(h.sum) || 0) + elapsed);
        update.count = String((parseFloat(h.count) || 0) + 1);
        await storage.env.hmset(HIST_KEY, update);
    }

    // ── Backend: /metrics endpoint (served at /api/metrics) ────────────────────
    if (config.backend) {
        config.backend.router.get('/metrics', async (req, res) => {
            try {
                res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
                res.send(await buildMetricsOutput());
            } catch (err) {
                console.error('[screepsmod-prometheus] Error generating metrics:', err);
                res.status(500).send('# Error generating metrics\n');
            }
        });
    }

    // ── Metrics text builder ──────────────────────────────────────────────────
    async function buildMetricsOutput() {
        const [hist, roomsTotal, usersTotal, gameTime] = await Promise.all([
            storage.env.hgetall(HIST_KEY),
            storage.env.get(ROOMS_KEY),
            storage.env.get(USERS_KEY),
            storage.env.get(GAMETIME_KEY),
        ]);
        const h = hist || {};

        // Per-user metrics come from the users DB collection rather than runner hooks,
        // because the runner executes users concurrently which makes event-based
        // per-user correlation unreliable. The driver writes lastUsedCpu / heap and a
        // cumulative metricsCpuMsTotal to the collection after each execution.
        const users = await storage.db.users.find({});

        const processKeys = (await storage.env.smembers('metrics/active_processes')) || [];
        const processDataRaw = await Promise.all(processKeys.map(k => storage.env.get(k)));
        const processData = processDataRaw
            .map(s => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } })
            .filter(Boolean);

        let out = '';

        function write(name, type, help, rows) {
            out += `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n`;
            for (const { labels, value } of rows) {
                if (value == null) continue;
                out += labels ? `${name}{${labels}} ${value}\n` : `${name} ${value}\n`;
            }
            out += '\n';
        }

        // ── Tick wall-clock duration histogram ────────────────────────────────
        // Captures every tick regardless of scrape interval. Use
        // histogram_quantile(0.95, rate(screeps_tick_time_ms_bucket[5m])) etc.
        const count = parseFloat(h.count) || 0;
        out += '# HELP screeps_tick_time_ms Game tick wall-clock duration distribution in milliseconds\n';
        out += '# TYPE screeps_tick_time_ms histogram\n';
        let cum = 0;
        for (const le of TICK_LE) {
            cum += parseFloat(h[String(le)]) || 0;
            out += `screeps_tick_time_ms_bucket{le="${le}"} ${cum}\n`;
        }
        out += `screeps_tick_time_ms_bucket{le="+Inf"} ${count}\n`;
        out += `screeps_tick_time_ms_sum ${parseFloat(h.sum) || 0}\n`;
        out += `screeps_tick_time_ms_count ${count}\n\n`;

        // ── Tick-rate-independent counters ────────────────────────────────────
        if (gameTime != null)
            write('screeps_tick_game_time', 'counter', 'Current game time (total tick count)',
                [{ value: gameTime }]);
        write('screeps_rooms_processed_total', 'counter',
            'Cumulative rooms queued for processing across all ticks',
            [{ value: parseFloat(roomsTotal) || 0 }]);
        write('screeps_users_processed_total', 'counter',
            'Cumulative user script runs queued across all ticks',
            [{ value: parseFloat(usersTotal) || 0 }]);

        // ── Per-user CPU ──────────────────────────────────────────────────────
        // Cumulative counter (float ms), captured per execution via driver $inc.
        // Total CPU/sec = sum(rate(screeps_user_cpu_ms_total[1m])).
        const ranUsers = users.filter(u => u.metricsCpuMsTotal != null);
        if (ranUsers.length > 0) {
            write('screeps_user_cpu_ms_total', 'counter',
                'Cumulative CPU milliseconds used by player script (driver usedTime, float)',
                ranUsers.map(u => ({ labels: `username="${u.username}"`, value: u.metricsCpuMsTotal })));
        }

        // Slow-moving per-user gauges (fine to sample).
        const cpuUsers = users.filter(u => u.cpu);
        write('screeps_user_cpu_bucket', 'gauge', 'Current CPU bucket balance for player',
            cpuUsers.filter(u => u.cpuAvailable != null)
                .map(u => ({ labels: `username="${u.username}"`, value: u.cpuAvailable })));
        write('screeps_user_cpu_limit', 'gauge', 'Configured CPU limit per tick for player in milliseconds',
            cpuUsers.map(u => ({ labels: `username="${u.username}"`, value: u.cpu })));

        // ── Per-user IVM heap (requires patched packages/driver/lib/runtime/make.js) ──
        const withHeap = users.filter(u => u.lastHeapUsed != null);
        if (withHeap.length > 0) {
            write('screeps_user_heap_used_bytes', 'gauge',
                'VM isolate heap used bytes per player (requires patched driver)',
                withHeap.map(u => ({ labels: `username="${u.username}"`, value: u.lastHeapUsed })));
            write('screeps_user_heap_total_bytes', 'gauge',
                'VM isolate heap total allocated bytes per player (requires patched driver)',
                withHeap.map(u => ({ labels: `username="${u.username}"`, value: u.lastHeapTotal })));
        }

        // ── Process memory (all server processes report here every 10s, 30s TTL) ──
        if (processData.length > 0) {
            const rows = processData.flatMap(p => [
                { labels: `service="${p.service}",instance="${p.instance}",type="rss"`,       value: p.rss },
                { labels: `service="${p.service}",instance="${p.instance}",type="heapTotal"`, value: p.heapTotal },
                { labels: `service="${p.service}",instance="${p.instance}",type="heapUsed"`,  value: p.heapUsed },
                { labels: `service="${p.service}",instance="${p.instance}",type="external"`,  value: p.external },
            ]);
            write('screeps_process_memory_bytes', 'gauge', 'Node.js process memory in bytes', rows);
        }

        return out;
    }
};
