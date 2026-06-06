'use strict';
const os = require('os');
const crypto = require('crypto');
const common = require('@screeps/common');
const storage = common.storage;

// ── Config (env vars, with defaults) ─────────────────────────────────────────
const ENV = process.env;
const bool = (v, d) => (v == null || v === '') ? d : /^(1|true|yes|on)$/i.test(v);
const GLOBAL_TOKEN = ENV.PROM_GLOBAL_TOKEN || '';            // bearer for /metrics; empty = no auth
const GLOBAL_INCLUDE_PLAYERS = bool(ENV.PROM_GLOBAL_INCLUDE_PLAYERS, true); // per-user cpu/heap on global
const PLAYER_ENABLED = bool(ENV.PROM_PLAYER_METRICS, true);  // /metrics/player endpoint
const CUSTOM_ENABLED = bool(ENV.PROM_CUSTOM_METRICS, true);  // Game.metrics API
const CUSTOM_MAX_KEYS = parseInt(ENV.PROM_CUSTOM_MAX_KEYS, 10) || 32;
const CUSTOM_TTL = parseInt(ENV.PROM_CUSTOM_TTL, 10) || 90;  // seconds; refreshed while the player keeps writing
const CT = 'text/plain; version=0.0.4; charset=utf-8';

// Tick wall-clock histogram bucket boundaries (le, milliseconds). +Inf implicit.
const TICK_LE = [50, 100, 150, 200, 250, 400, 800, 1600, 3200];
const HIST_KEY = 'metrics/tick_time_hist';
const ROOMS_KEY = 'metrics/rooms_processed_total';
const USERS_KEY = 'metrics/users_processed_total';
const GAMETIME_KEY = 'metrics/tick_game_time';
const CUSTOM_KEY = id => `metrics/custom:${id}`;
const KEY_RE = /^[a-zA-Z0-9_]{1,64}$/;
const STAGE_KEY = 'metrics/tick_stage';
const STAGE_ENABLED = bool(ENV.PROM_STAGE_METRICS, true);

function detectRole(config) {
    if (config.backend) return 'backend';
    const script = (process.argv[1] || '').replace(/\\/g, '/');
    if (script.endsWith('runner.js')) return 'engine_runner';
    if (script.endsWith('main.js'))   return 'engine_main';
    return 'engine';
}

// Escape a Prometheus label value.
function esc(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

module.exports = function(config) {
    const role = detectRole(config);
    const pid  = process.pid;
    const hostname = ENV.HOSTNAME || os.hostname();
    const processKey = `metrics/process:${role}:${hostname}:${pid}`;

    // ── Process memory reporter — runs in every process ───────────────────────
    const reportProcessMemory = async () => {
        try {
            const m = process.memoryUsage();
            await Promise.all([
                storage.env.setex(processKey, 30, JSON.stringify({
                    service: role, instance: `${hostname}:${pid}`, pid,
                    rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed, external: m.external,
                })),
                storage.env.sadd('metrics/active_processes', processKey),
            ]);
        } catch (_) {}
    };
    // Do NOT call storage._connect() here (see git history) — each process connects
    // on its own; these guarded calls no-op until then.
    reportProcessMemory();
    setInterval(reportProcessMemory, 10000);

    // ── Engine main: tick-rate-independent counters/histogram ─────────────────
    if (config.engine) {
        let tickStart = 0;
        let lastStage = null;
        let lastStageTime = 0;
        let stageAccum = null;
        config.engine.on('mainLoopStage', async (stage, data) => {
            try {
                const now = Date.now();
                if (stage === 'start') {
                    tickStart = now;
                    if (STAGE_ENABLED) { lastStage = 'start'; lastStageTime = now; stageAccum = {}; }
                } else {
                    if (STAGE_ENABLED && lastStage !== null) {
                        const a = stageAccum[lastStage] || (stageAccum[lastStage] = { sum: 0, count: 0 });
                        a.sum += now - lastStageTime;
                        a.count += 1;
                        lastStage = stage;
                        lastStageTime = now;
                    }
                    if (stage === 'addUsersToQueue' && Array.isArray(data)) {
                        await addToCounter(USERS_KEY, data.length);
                    } else if (stage === 'addRoomsToQueue' && Array.isArray(data)) {
                        await addToCounter(ROOMS_KEY, data.length);
                    } else if (stage === 'finish' && tickStart > 0) {
                        const elapsed = now - tickStart;
                        tickStart = 0;
                        await recordTick(elapsed);
                        const gameTime = await storage.env.get(storage.env.keys.GAMETIME);
                        await storage.env.set(GAMETIME_KEY, String(gameTime || 0));
                        if (STAGE_ENABLED && stageAccum && Object.keys(stageAccum).length > 0) {
                            await flushStageAccum(stageAccum);
                            stageAccum = null;
                        }
                    }
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
    async function flushStageAccum(accum) {
        const h = (await storage.env.hgetall(STAGE_KEY)) || {};
        const update = {};
        for (const [st, { sum, count }] of Object.entries(accum)) {
            update[`${st}|sum`]   = String((parseFloat(h[`${st}|sum`])   || 0) + sum);
            update[`${st}|count`] = String((parseFloat(h[`${st}|count`]) || 0) + count);
        }
        if (Object.keys(update).length) await storage.env.hmset(STAGE_KEY, update);
    }

    // ── Custom player metrics via Game.metrics (runner only) ──────────────────
    // Injected into the player sandbox; values flow to a host callback (Reference),
    // are buffered per-user in this process, and flushed to Redis. Persists until
    // overwritten/cleared, with a refreshed TTL so inactive players self-expire.
    if (CUSTOM_ENABLED && config.engine && role === 'engine_runner') {
        let ivm;
        const buf = Object.create(null);   // userId -> { key: number }
        const dirty = new Set();

        const handlePush = (userID, key, value) => {
            try {
                if (key === '' && value === null) { buf[userID] = Object.create(null); dirty.add(userID); return; }
                if (!KEY_RE.test(key)) return;
                if (typeof value !== 'number' || !isFinite(value)) return;
                let m = buf[userID];
                if (!m) m = buf[userID] = Object.create(null);
                if (!(key in m) && Object.keys(m).length >= CUSTOM_MAX_KEYS) return;
                m[key] = value;
                dirty.add(userID);
            } catch (_) {}
        };

        const refs = Object.create(null); // userId -> ivm.Reference (cached to avoid per-tick churn)
        config.engine.on('playerSandbox', (sandbox, userID) => {
            try {
                ivm = ivm || require('isolated-vm');
                const id = '' + userID;
                let ref = refs[id];
                if (!ref) ref = refs[id] = new ivm.Reference((k, v) => handlePush(id, k, v));
                // Game is rebuilt every tick, so (re)inject Game.metrics each tick. The host
                // Reference lives on the persistent context global; capture it into a closure
                // and remove the global binding so player code only sees Game.metrics.
                sandbox.getContext().global.setIgnored('__screepsMetricsPush', ref);
                sandbox.run(`(function(){
                    var __r = __screepsMetricsPush;
                    delete global.__screepsMetricsPush;
                    Game.metrics = Object.create(null, {
                        set:   { value: function(k, v){ __r.applySync(undefined, [''+k, v===null?null:+v]); }, enumerable: true },
                        clear: { value: function(){ __r.applySync(undefined, ['', null]); }, enumerable: true }
                    });
                })();`);
            } catch (_) {}
        });

        setInterval(async () => {
            const ids = [...dirty]; dirty.clear();
            for (const id of ids) {
                try {
                    const m = buf[id] || {};
                    if (Object.keys(m).length === 0) await storage.env.del(CUSTOM_KEY(id));
                    else await storage.env.setex(CUSTOM_KEY(id), CUSTOM_TTL, JSON.stringify(m));
                } catch (_) {}
            }
        }, 2000);
    }

    // ── Backend: metrics endpoints ────────────────────────────────────────────
    if (config.backend) {
        // Global endpoint (VM scrapes this). Optional shared-secret bearer auth.
        config.backend.router.get('/metrics', async (req, res) => {
            if (GLOBAL_TOKEN) {
                const auth = (req.headers.authorization || '');
                const tok = /^Bearer (.+)$/i.exec(auth);
                const provided = (tok && tok[1]) || (req.query && req.query.token);
                if (provided !== GLOBAL_TOKEN) {
                    return res.status(401).send('# unauthorized\n');
                }
            }
            try {
                res.set('Content-Type', CT);
                res.send(await buildGlobal());
            } catch (err) {
                console.error('[screepsmod-prometheus] global metrics error:', err);
                res.status(500).send('# error\n');
            }
        });

        // Per-player endpoint: Basic Auth with the player's own screeps credentials.
        if (PLAYER_ENABLED) {
            config.backend.router.get('/metrics/player', async (req, res) => {
                const unauth = (msg) => res.set('WWW-Authenticate', 'Basic realm="screeps metrics"').status(401).send(`# ${msg}\n`);
                const cred = parseBasic(req);
                if (!cred) return unauth('authentication required');
                let userId;
                try { userId = await authUser(config, cred); } catch (_) { userId = null; }
                if (!userId) return unauth('invalid credentials');
                try {
                    res.set('Content-Type', CT);
                    res.send(await buildPlayer(userId));
                } catch (err) {
                    console.error('[screepsmod-prometheus] player metrics error:', err);
                    res.status(500).send('# error\n');
                }
            });
        }
    }

    // ── Auth (per-player) ─────────────────────────────────────────────────────
    const authCache = new Map(); // sha256(user:pass) -> { userId, exp }
    function parseBasic(req) {
        const h = req.headers && (req.headers.authorization || '');
        if (!/^Basic /i.test(h)) return null;
        let raw;
        try { raw = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8'); } catch (_) { return null; }
        const i = raw.indexOf(':');
        if (i < 0) return null;
        return { raw, username: raw.slice(0, i), password: raw.slice(i + 1) };
    }
    async function authUser(config, cred) {
        const ckey = crypto.createHash('sha256').update(cred.raw).digest('hex');
        const now = Date.now();
        const hit = authCache.get(ckey);
        if (hit && hit.exp > now) return hit.userId;
        if (!config.auth || typeof config.auth.authUser !== 'function') return null; // screepsmod-auth required
        const user = await config.auth.authUser(cred.username, cred.password).catch(() => false);
        if (!user) return null;
        authCache.set(ckey, { userId: '' + user._id, exp: now + 60000 });
        return '' + user._id;
    }

    // ── Renderers ─────────────────────────────────────────────────────────────
    function writer() {
        let out = '';
        return {
            metric(name, type, help, rows) {
                out += `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n`;
                for (const { labels, value } of rows) {
                    if (value == null) continue;
                    out += labels ? `${name}{${labels}} ${value}\n` : `${name} ${value}\n`;
                }
                out += '\n';
            },
            raw(s) { out += s; },
            toString() { return out; },
        };
    }

    function emitPerUser(w, users) {
        const ran = users.filter(u => u.metricsCpuMsTotal != null);
        if (ran.length) w.metric('screeps_user_cpu_ms_total', 'counter',
            'Cumulative CPU milliseconds used by player script (driver usedTime, float)',
            ran.map(u => ({ labels: `username="${esc(u.username)}"`, value: u.metricsCpuMsTotal })));
        const cpu = users.filter(u => u.cpu);
        w.metric('screeps_user_cpu_bucket', 'gauge', 'Current CPU bucket balance for player',
            cpu.filter(u => u.cpuAvailable != null).map(u => ({ labels: `username="${esc(u.username)}"`, value: u.cpuAvailable })));
        w.metric('screeps_user_cpu_limit', 'gauge', 'Configured CPU limit per tick for player in milliseconds',
            cpu.map(u => ({ labels: `username="${esc(u.username)}"`, value: u.cpu })));
        const heap = users.filter(u => u.lastHeapUsed != null);
        if (heap.length) {
            w.metric('screeps_user_heap_used_bytes', 'gauge', 'VM isolate heap used bytes per player',
                heap.map(u => ({ labels: `username="${esc(u.username)}"`, value: u.lastHeapUsed })));
            w.metric('screeps_user_heap_total_bytes', 'gauge', 'VM isolate heap total allocated bytes per player',
                heap.map(u => ({ labels: `username="${esc(u.username)}"`, value: u.lastHeapTotal })));
        }
    }

    function emitHistogram(w, h) {
        h = h || {};
        const count = parseFloat(h.count) || 0;
        w.raw('# HELP screeps_tick_time_ms Game tick wall-clock duration distribution in milliseconds\n');
        w.raw('# TYPE screeps_tick_time_ms histogram\n');
        let cum = 0;
        for (const le of TICK_LE) { cum += parseFloat(h[String(le)]) || 0; w.raw(`screeps_tick_time_ms_bucket{le="${le}"} ${cum}\n`); }
        w.raw(`screeps_tick_time_ms_bucket{le="+Inf"} ${count}\n`);
        w.raw(`screeps_tick_time_ms_sum ${parseFloat(h.sum) || 0}\n`);
        w.raw(`screeps_tick_time_ms_count ${count}\n\n`);
    }

    async function emitProcessMemory(w) {
        const processKeys = (await storage.env.smembers('metrics/active_processes')) || [];
        const raw = await Promise.all(processKeys.map(k => storage.env.get(k)));
        const data = raw.map(s => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } }).filter(Boolean);
        if (!data.length) return;
        const rows = data.flatMap(p => [
            { labels: `service="${esc(p.service)}",instance="${esc(p.instance)}",type="rss"`,       value: p.rss },
            { labels: `service="${esc(p.service)}",instance="${esc(p.instance)}",type="heapTotal"`, value: p.heapTotal },
            { labels: `service="${esc(p.service)}",instance="${esc(p.instance)}",type="heapUsed"`,  value: p.heapUsed },
            { labels: `service="${esc(p.service)}",instance="${esc(p.instance)}",type="external"`,  value: p.external },
        ]);
        w.metric('screeps_process_memory_bytes', 'gauge', 'Node.js process memory in bytes', rows);
    }

    function emitStageMetrics(w, h) {
        const stages = {};
        for (const [field, val] of Object.entries(h)) {
            const sep = field.lastIndexOf('|');
            if (sep < 0) continue;
            const stage = field.slice(0, sep);
            const type  = field.slice(sep + 1);
            if (type !== 'sum' && type !== 'count') continue;
            if (!stages[stage]) stages[stage] = {};
            stages[stage][type] = parseFloat(val) || 0;
        }
        const entries = Object.entries(stages).filter(([, v]) => v.sum != null && v.count != null);
        if (!entries.length) return;
        w.raw('# HELP screeps_tick_stage_ms_sum Cumulative milliseconds in each main-loop stage\n');
        w.raw('# TYPE screeps_tick_stage_ms_sum counter\n');
        for (const [stage, { sum }] of entries) w.raw(`screeps_tick_stage_ms_sum{stage="${esc(stage)}"} ${sum}\n`);
        w.raw('\n# HELP screeps_tick_stage_ms_count Cumulative ticks measured per main-loop stage\n');
        w.raw('# TYPE screeps_tick_stage_ms_count counter\n');
        for (const [stage, { count }] of entries) w.raw(`screeps_tick_stage_ms_count{stage="${esc(stage)}"} ${count}\n`);
        w.raw('\n');
    }

    async function buildGlobal() {
        const w = writer();
        const [hist, roomsTotal, usersTotal, gameTime, stageHash] = await Promise.all([
            storage.env.hgetall(HIST_KEY), storage.env.get(ROOMS_KEY),
            storage.env.get(USERS_KEY), storage.env.get(GAMETIME_KEY),
            STAGE_ENABLED ? storage.env.hgetall(STAGE_KEY) : Promise.resolve(null),
        ]);
        emitHistogram(w, hist);
        if (gameTime != null) w.metric('screeps_tick_game_time', 'counter', 'Current game time (total tick count)', [{ value: gameTime }]);
        w.metric('screeps_rooms_processed_total', 'counter', 'Cumulative rooms queued for processing across all ticks', [{ value: parseFloat(roomsTotal) || 0 }]);
        w.metric('screeps_users_processed_total', 'counter', 'Cumulative user script runs queued across all ticks', [{ value: parseFloat(usersTotal) || 0 }]);
        if (STAGE_ENABLED && stageHash) emitStageMetrics(w, stageHash);
        if (GLOBAL_INCLUDE_PLAYERS) emitPerUser(w, await storage.db.users.find({}));
        await emitProcessMemory(w);
        return w.toString();
    }

    async function buildPlayer(userId) {
        const w = writer();
        const user = await storage.db.users.findOne({ _id: userId });
        if (user) {
            emitPerUser(w, [user]);
            // Custom metrics (only ever exposed on the authenticated per-player endpoint)
            let custom = null;
            try { const s = await storage.env.get(CUSTOM_KEY(userId)); custom = s ? JSON.parse(s) : null; } catch (_) {}
            if (custom && typeof custom === 'object') {
                const rows = Object.entries(custom)
                    .filter(([k, v]) => KEY_RE.test(k) && typeof v === 'number' && isFinite(v))
                    .map(([k, v]) => ({ labels: `username="${esc(user.username)}",key="${esc(k)}"`, value: v }));
                w.metric('screeps_custom', 'gauge', 'Custom player-defined metric (Game.metrics.set)', rows);
            }
        }
        return w.toString();
    }
};
