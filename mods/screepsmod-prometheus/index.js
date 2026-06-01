'use strict';
const os = require('os');
const common = require('@screeps/common');
const storage = common.storage;

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

    storage._connect()
        .then(() => { reportProcessMemory(); setInterval(reportProcessMemory, 10000); })
        .catch(() => {});

    // ── Engine main: tick timing and queue counts ─────────────────────────────
    if (config.engine) {
        let tickStart = 0;

        config.engine.on('mainLoopStage', async (stage, data) => {
            try {
                if (stage === 'start') {
                    tickStart = Date.now();
                } else if (stage === 'addUsersToQueue' && Array.isArray(data)) {
                    await storage.env.set('metrics/tick_active_users', String(data.length));
                } else if (stage === 'addRoomsToQueue' && Array.isArray(data)) {
                    await storage.env.set('metrics/tick_active_rooms', String(data.length));
                } else if (stage === 'finish' && tickStart > 0) {
                    const elapsed = Date.now() - tickStart;
                    tickStart = 0;
                    const gameTime = await storage.env.get(storage.env.keys.GAMETIME);
                    await Promise.all([
                        storage.env.set('metrics/tick_time_ms', String(elapsed)),
                        storage.env.set('metrics/tick_game_time', String(gameTime || 0)),
                    ]);
                }
            } catch (_) {}
        });
    }

    // ── Backend: /metrics endpoint ────────────────────────────────────────────
    // Accessible at /api/metrics while the server is running.
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
        const [tickTimeMs, tickGameTime, tickActiveUsers, tickActiveRooms] = await Promise.all([
            storage.env.get('metrics/tick_time_ms'),
            storage.env.get('metrics/tick_game_time'),
            storage.env.get('metrics/tick_active_users'),
            storage.env.get('metrics/tick_active_rooms'),
        ]);

        // Per-user metrics come from the users DB collection rather than runner hooks,
        // because the runner executes users concurrently (runner_threads > 1) which
        // makes event-based per-user correlation unreliable. The driver already writes
        // lastUsedCpu to the collection after each execution.
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

        // Tick-level metrics
        if (tickTimeMs != null)
            write('screeps_tick_time_ms', 'gauge', 'Last game tick wall-clock duration in milliseconds',
                [{ value: tickTimeMs }]);

        if (tickGameTime != null)
            write('screeps_tick_game_time', 'counter', 'Current game time (total tick count)',
                [{ value: tickGameTime }]);

        if (tickActiveUsers != null)
            write('screeps_tick_active_users', 'gauge', 'Number of users scheduled in runner queue last tick',
                [{ value: tickActiveUsers }]);

        if (tickActiveRooms != null)
            write('screeps_tick_active_rooms', 'gauge', 'Number of rooms scheduled in processor queue last tick',
                [{ value: tickActiveRooms }]);

        // Per-user metrics
        // Only include users that have run at least once (lastUsedCpu is set by the driver).
        const ranUsers = users.filter(u => u.lastUsedCpu != null);
        if (ranUsers.length > 0) {
            write('screeps_user_cpu_last_ms', 'gauge',
                'CPU time used by player script last tick in milliseconds (driver usedTime, includes intents overhead)',
                ranUsers.map(u => ({ labels: `username="${u.username}"`, value: u.lastUsedCpu })));

            write('screeps_user_cpu_bucket', 'gauge', 'Current CPU bucket balance for player',
                ranUsers.map(u => ({ labels: `username="${u.username}"`, value: u.cpuAvailable })));

            write('screeps_user_cpu_limit', 'gauge', 'Configured CPU limit per tick for player in milliseconds',
                ranUsers.map(u => ({ labels: `username="${u.username}"`, value: u.cpu })));

            // Optional IVM heap stats: only present if packages/driver/lib/runtime/make.js is patched
            // to write lastHeapUsed / lastHeapTotal into the $set update after execution.
            const withHeap = ranUsers.filter(u => u.lastHeapUsed != null);
            if (withHeap.length > 0) {
                write('screeps_user_heap_used_bytes', 'gauge',
                    'VM isolate heap used bytes per player (requires patched driver)',
                    withHeap.map(u => ({ labels: `username="${u.username}"`, value: u.lastHeapUsed })));

                write('screeps_user_heap_total_bytes', 'gauge',
                    'VM isolate heap total allocated bytes per player (requires patched driver)',
                    withHeap.map(u => ({ labels: `username="${u.username}"`, value: u.lastHeapTotal })));
            }
        }

        // Process memory (all server processes report here every 10s with 30s TTL)
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
