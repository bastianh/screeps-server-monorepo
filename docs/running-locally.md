# Running the Screeps Server Locally

This guide explains how to set up and run the Screeps private server directly from this monorepo.

## Prerequisites

- **Node.js v24**: Required for compatibility with native modules.
- **mise**: Highly recommended for managing the Node version.
- **pnpm**: The workspace package manager.
- **Python 3 & Build Tools**: Needed for compiling native C++ extensions.

## Setup Steps

### 1. Environment Preparation
Ensure you are using Node 24. If you use `mise`, it's already configured via `mise.toml`.
```bash
mise install
```

### 2. Install Dependencies
Install all packages and link the workspaces.
```bash
pnpm install
```

### 3. Build Core Modules
The engine needs to be compiled from source.
```bash
cd packages/engine
pnpm exec gulp
cd ../..
```

If you encounter issues with native modules (like `isolated-vm`), you might need to force a rebuild:
```bash
pnpm rebuild -r
```

### 4. Initialize Server Data
Copy the default configuration files to the root directory.
```bash
cp packages/launcher/init_dist/db.json .
cp packages/launcher/init_dist/mods.json .
cp packages/launcher/init_dist/.screepsrc .
mkdir -p assets logs
```

### 5. Configure Authentication
Open `.screepsrc` and enter your Steam Web API Key:
```ini
steam_api_key = YOUR_STEAM_API_KEY_HERE
```
*Note: You can get a key at [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey).*

## Starting the Server

You can use the local launcher to start all processes at once.

### In Foreground (with Logs)
```bash
node packages/launcher/bin/screeps.js start --log_console
```

### In Background
```bash
node packages/launcher/bin/screeps.js start
```

## Controlling the Server

### Command Line Interface (CLI)
While the server is running, you can connect to the administrative CLI:
```bash
npx screeps cli
```

### Mod Management
To enable a mod, add its path to `mods.json`:
```json
{
  "mods": [
    "mods/example-mod/index.js"
  ]
}
```

## Troubleshooting

- **Native Build Errors**: Ensure `node -v` shows v24. Delete `node_modules` and run `pnpm install` again if switching versions.
- **Missing `dist/` files**: Ensure you ran `gulp` in the `packages/engine` directory.
- **Steam Auth Issues**: Ensure your Steam API Key is valid and the server has internet access.
