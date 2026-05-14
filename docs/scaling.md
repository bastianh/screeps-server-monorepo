# Scaling the Screeps Server (Runners & Processors)

To handle more players or more complex game logic, you can scale the Screeps server by increasing the number of **Runner** and **Processor** processes.

## Understanding the Roles

1.  **Runner (`runners_cnt`)**: Executes player scripts (your AI code).
    - If your CPU usage is high because of player scripts, increase this number.
    - Each runner can also be configured to use multiple worker threads.
2.  **Processor (`processors_cnt`)**: Handles game logic, room updates, and intent processing.
    - If ticks are taking too long to process despite low script execution time, increase this number.

---

## Configuration via `.screepsrc`

The most permanent way to configure scaling is through the `.screepsrc` file in your project root.

```ini
; Number of runner processes to launch
; Recommended: 1 (unless you have a very high player count)
runners_cnt = 1

; Number of worker threads per runner process
; Recommended: Number of physical CPU cores
runner_threads = 4

; Number of room processor processes to launch
; Recommended: Number of physical CPU cores (or half if shared with runners)
processors_cnt = 2
```

## Configuration via Command Line

If you are starting the server via the launcher script, you can override these values using command-line arguments:

```bash
# Start with 2 runners and 4 processors
node packages/launcher/bin/screeps.js start --runners_cnt 2 --processors_cnt 4
```

## Recommended Setup for Development

For a local development environment on a modern machine (e.g., Apple Silicon or 8-core Ryzen/Intel):

- `runners_cnt = 1`: Multi-runner setups can lead to complex global environment behaviors and are usually not needed for a single player.
- `runner_threads = 4`: To speed up script execution.
- `processors_cnt = 4`: To ensure room updates are processed in parallel across available cores.

---

## How it works (Technical Detail)

The launcher (`packages/launcher/lib/start.js`) reads these options and executes a loop to spawn the processes:

```javascript
const runners_cnt = opts.runners_cnt || 1;
for(var i=1; i<=runners_cnt; i++) {
    await _startProcess('engine_runner'+i, ...);
}

for(var i=1; i<=opts.processors_cnt; i++) {
    await _startProcess('engine_processor'+i, ...);
}
```

Each process connects to the centralized `storage` to receive tasks and update the game state.
