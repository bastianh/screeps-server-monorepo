# Debugging Screeps Server in IntelliJ IDEA

This guide explains how to set up IntelliJ IDEA to run and debug the Screeps server, enabling you to set breakpoints in your custom mods and the core server modules.

## Prerequisites

- **IntelliJ IDEA** (Ultimate recommended, but Community works for basic JS debugging).
- **Node.js v24** (configured in IntelliJ).
- **Completed Local Setup**: Ensure you have followed the [Running Locally](running-locally.md) guide and `pnpm install` as well as `gulp` in `packages/engine` have been executed.

## Why Debugging is Special here

The Screeps server is a **multi-process application**. When you run the launcher, it spawns several child processes:
- `storage`
- `backend`
- `engine_main`
- `engine_runner` (where your player code and some mod logic runs)
- `engine_processor` (where game logic and room updates run)

To hit breakpoints in your mods, you usually need to debug the specific process that executes your mod logic (often `backend` for API mods or `engine_*` for game logic mods).

---

## Option 1: Debugging via Attach (Recommended)

Since the launcher manages the processes, the easiest way to debug is to start the server normally and then **attach** the IntelliJ debugger to the child process you are interested in.

### 1. Start the Server with Debug Ports
The Screeps launcher doesn't automatically assign debug ports to children. To enable this, you can pass Node.js arguments via the command line or environment variables.

However, the cleanest way in this monorepo is to use the **Attach to Node.js/Chrome** configuration in IntelliJ.

### 2. Manual Attach
1.  Start the server from your terminal:
    ```bash
    mise exec -- node packages/launcher/bin/screeps.js start --log_console
    ```
2.  In IntelliJ, go to **Run > Attach to Process...**
3.  Select the node process you want to debug (e.g., the one running `backend/bin/start.js` or `engine/src/main.js`).

---

## Option 2: Dedicated Run Configurations (Advanced)

For a better experience, you can create a "Node.js" Run Configuration for the launcher.

### 1. Launcher Configuration
1.  Go to **Run > Edit Configurations...**
2.  Click **+** and select **Node.js**.
3.  **Name**: `Screeps Launcher`
4.  **Node interpreter**: Select your Node 24 path (often managed by `mise`).
5.  **JavaScript file**: `packages/launcher/bin/screeps.js`
6.  **Application parameters**: `start --log_console`
7.  **Working directory**: Your project root.

**Note**: If you debug the *launcher*, you will only hit breakpoints inside the launcher code itself, not in your mods (as they run in child processes).

### 2. Debugging Child Processes automatically
To hit breakpoints in child processes automatically, you need to tell Node.js to enable the inspector for all spawned processes.

1.  Edit your `Screeps Launcher` configuration.
2.  In **Environment variables**, add:
    `NODE_OPTIONS=--inspect=0` (0 uses a random free port for each process).
3.  In IntelliJ, ensure **"Automatically attach to child processes"** is enabled in **Settings > Build, Execution, Deployment > Debugger > Stepping**.

---

## Breakpoints in Mods

1.  Open your mod file (e.g., `mods/example-mod/index.js`).
2.  Click in the gutter to set a breakpoint inside your exported function or an event listener.
3.  Start the **Screeps Launcher** configuration in **Debug mode**.
4.  IntelliJ will detect the child processes being spawned and attach the debugger to them.
5.  When a process loads your mod, the breakpoint will be hit.

## Troubleshooting

- **Breakpoints not hitting**: Ensure you are debugging the correct process. API changes are in `backend`, game logic changes in `engine_processor`.
- **Source Maps**: If you are debugging the engine and notice the code doesn't match the execution, ensure the `gulp` build in `packages/engine` was successful and generated valid source maps.
- **Mise Integration**: If IntelliJ doesn't find the correct Node version, point the "Node interpreter" manually to `~/.local/share/mise/installs/node/24.../bin/node`.
