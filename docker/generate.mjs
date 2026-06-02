// Boot-time config generator for the containerized Screeps server.
//
// Reads the operator-supplied config.yml (same format as the screeps-launcher
// Go launcher uses) and emits everything the @screeps/launcher JS launcher needs
// into the data dir (the PVC):
//
//   package.json        - core packages (from baked .tgz) + mods (npm "latest")
//   .npmrc              - node-linker=hoisted + writable pnpm store/cache
//   .screepsrc          - launcher options + [mongo]/[redis] sections
//   mods.json           - absolute paths to each mod's entry point
//   .boot-fingerprint   - sha256 of the inputs; entrypoint installs only on change
//
// Core @screeps/* packages (including the locally-patched driver) ship as
// tarballs in CORE_DIR and are referenced via file: so the patched versions win
// over anything on npm. Mods are resolved from npm at "latest".

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

const DATA_DIR = process.env.SCREEPS_DATA_DIR || '/screeps';
const CORE_DIR = process.env.SCREEPS_CORE_DIR || '/opt/screeps-core';
const CONFIG_PATH = process.env.SCREEPS_CONFIG || path.join(DATA_DIR, 'config.yml');

// Core packages baked into the image as tarballs (name -> tarball filename).
// Order is irrelevant; pnpm resolves the graph.
const CORE_TARBALLS = {
  '@screeps/common': 'screeps-common.tgz',
  '@screeps/driver': 'screeps-driver.tgz',
  '@screeps/engine': 'screeps-engine.tgz',
  '@screeps/storage': 'screeps-storage.tgz',
  '@screeps/backend': 'screeps-backend.tgz',
  '@screeps/launcher': 'screeps-launcher.tgz',
};

// Local mods baked as tarballs (name -> tarball filename). These also get a
// mods.json entry, unlike the core packages above.
const LOCAL_MOD_TARBALLS = {
  'screepsmod-prometheus': 'screepsmod-prometheus.tgz',
};

function readConfig() {
  let raw = '';
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.warn(`[generate] ${CONFIG_PATH} not found, using defaults/env only`);
  }
  const cfg = (raw && yaml.load(raw)) || {};
  return { cfg, raw };
}

function tarballSpec(file) {
  return `file:${path.join(CORE_DIR, file)}`;
}

function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { cfg, raw } = readConfig();

  const serverConfig = cfg.serverConfig || {};
  // config.yml `mods:` is a plain list of npm mod package names.
  const npmMods = Array.isArray(cfg.mods) ? cfg.mods.slice() : [];
  const localMods = Object.keys(LOCAL_MOD_TARBALLS);

  // ---- package.json ---------------------------------------------------------
  const dependencies = {};
  for (const [name, file] of Object.entries(CORE_TARBALLS)) {
    dependencies[name] = tarballSpec(file);
  }
  for (const [name, file] of Object.entries(LOCAL_MOD_TARBALLS)) {
    dependencies[name] = tarballSpec(file);
  }
  for (const name of npmMods) {
    dependencies[name] = 'latest'; // floating, per operator choice
  }

  const packageJson = {
    name: 'screeps-runtime',
    private: true,
    dependencies,
    pnpm: {
      // Allow native deps to run their build/install scripts during install:
      //   @screeps/driver - node-gyp rebuild of native.node
      //   isolated-vm     - V8 isolate addon
      //   sqlite3         - required by screepsmod-history (no node-v137 prebuilt)
      onlyBuiltDependencies: ['@screeps/driver', 'isolated-vm', 'sqlite3'],
    },
  };
  const packageJsonStr = `${JSON.stringify(packageJson, null, 2)}\n`;
  writeFileAtomic(path.join(DATA_DIR, 'package.json'), packageJsonStr);

  // ---- .npmrc (hoisted flat tree + writable store/cache on the PVC) ---------
  const npmrc = [
    'node-linker=hoisted',
    `store-dir=${path.join(DATA_DIR, '.pnpm-store')}`,
    `cache-dir=${path.join(DATA_DIR, '.pnpm-cache')}`,
    'prefer-offline=false',
    '',
  ].join('\n');
  writeFileAtomic(path.join(DATA_DIR, '.npmrc'), npmrc);

  // ---- .screepsrc -----------------------------------------------------------
  const mongo = cfg.mongo || {};
  const redis = cfg.redis || {};
  const lines = [
    `steam_api_key = ${process.env.STEAM_KEY || serverConfig.steam_api_key || ''}`,
    `port = ${serverConfig.port || 21025}`,
    `host = ${serverConfig.host || '0.0.0.0'}`,
    `cli_port = ${serverConfig.cli_port || 21026}`,
    `cli_host = ${serverConfig.cli_host || '0.0.0.0'}`,
    `runners_cnt = ${serverConfig.runners_cnt || 1}`,
    `runner_threads = ${serverConfig.runner_threads || 4}`,
    `processors_cnt = ${serverConfig.processors_cnt || 2}`,
    `assetdir = ${path.join(DATA_DIR, 'assets')}`,
    `logdir = ${path.join(DATA_DIR, 'logs')}`,
    `db = ${path.join(DATA_DIR, 'db.json')}`,
    `modfile = ${path.join(DATA_DIR, 'mods.json')}`,
    // Keep the built-in storage process running (screepsmod-mongo replaces its
    // backend with Mongo+Redis but the process must still start). It needs a
    // valid seed db.json (see entrypoint) so upgradeDb does not crash.
    'storage_disabled = false',
    'log_console = true',
    `restart_interval = ${serverConfig.restart_interval || 3600}`,
    '',
    '[mongo]',
    `host = ${mongo.host || process.env.MONGO_HOST || 'localhost'}`,
    `port = ${mongo.port || process.env.MONGO_PORT || 27017}`,
    `database = ${mongo.database || process.env.MONGO_DATABASE || 'screeps'}`,
  ];
  if (mongo.uri || process.env.MONGO_CONN) {
    lines.push(`uri = ${mongo.uri || process.env.MONGO_CONN}`);
  }
  lines.push(
    '',
    '[redis]',
    `host = ${redis.host || process.env.REDIS_HOST || 'localhost'}`,
    `port = ${redis.port || process.env.REDIS_PORT || 6379}`,
    '',
  );
  writeFileAtomic(path.join(DATA_DIR, '.screepsrc'), lines.join('\n'));

  // ---- mods.json (absolute paths so every spawned process resolves them) ----
  // screepsmod-mongo must load; keep operator order, then append local mods.
  const allMods = [...npmMods, ...localMods];
  const modsJson = {
    mods: allMods.map((m) => path.join(DATA_DIR, 'node_modules', m, 'index.js')),
    bots: {},
  };
  writeFileAtomic(path.join(DATA_DIR, 'mods.json'), `${JSON.stringify(modsJson, null, 2)}\n`);

  // ---- fingerprint ----------------------------------------------------------
  // Reinstall only when the dependency set or the core tarballs change.
  const hash = crypto.createHash('sha256');
  hash.update(packageJsonStr);
  hash.update(raw);
  for (const file of [...Object.values(CORE_TARBALLS), ...Object.values(LOCAL_MOD_TARBALLS)]) {
    const p = path.join(CORE_DIR, file);
    try {
      hash.update(fs.readFileSync(p));
    } catch (e) {
      console.warn(`[generate] missing core tarball ${p}: ${e.message}`);
    }
  }
  writeFileAtomic(path.join(DATA_DIR, '.boot-fingerprint'), `${hash.digest('hex')}\n`);

  console.log(`[generate] wrote runtime config to ${DATA_DIR} (${allMods.length} mods)`);
}

main();
