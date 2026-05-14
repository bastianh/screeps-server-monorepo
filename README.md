# Screeps Server Mods Monorepo

This repository is a specialized development environment for creating and managing mods for the [Screeps private server](https://github.com/screeps/screeps). It uses a monorepo structure with **pnpm workspaces** to allow seamless integration between custom mods and the core server components.

## Features

- **Deep Integration**: Core Screeps server modules (`engine`, `common`, `storage`, etc.) are included as local packages via Git Subtrees.
- **Local Linking**: Use `workspace:*` dependencies to reference core modules, enabling full IntelliSense and immediate testing of changes.
- **Version Management**: Automated subtree update scripts to keep core modules in sync with official repositories.
- **Compatibility**: Pre-configured environment (Node 24) to ensure native modules like `@screeps/driver` compile and run correctly.

## Prerequisites

- **Node.js**: Version **24** is required. We recommend using [mise](https://mise.jdx.dev/) or `nvm`.
- **pnpm**: Fast, disk space efficient package manager.
- **Git**: Required for subtree management.

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd screeps-server-monorepo
   ```

2. **Setup Node.js (via mise)**:
   ```bash
   mise install
   ```

3. **Install Dependencies**:
   ```bash
   pnpm install
   ```

## Project Structure

- `mods/`: Your custom mods live here.
- `packages/`: Official Screeps server core modules (managed via subtrees).
- `docs/`: Technical documentation for server APIs (Storage, API, etc.).
- `reference/`: Full standalone server reference build.

## Original Repositories

The core components integrated into this monorepo are maintained by the official Screeps team:

- **Main Server**: [screeps/screeps](https://github.com/screeps/screeps)
- **Game Engine**: [screeps/engine](https://github.com/screeps/engine)
- **Common Logic**: [screeps/common](https://github.com/screeps/common)
- **Driver**: [screeps/driver](https://github.com/screeps/driver)
- **Storage**: [screeps/storage](https://github.com/screeps/storage)
- **Backend**: [screeps/backend-local](https://github.com/screeps/backend-local)
- **Launcher**: [screeps/launcher](https://github.com/screeps/launcher)

## Key NPM Scripts

Available in the root `package.json`:

- `pnpm install`: Install all dependencies and link workspace packages.
- `pnpm subtree:update:all`: Pull latest changes for all core Screeps modules from GitHub.
- `pnpm subtree:update:<module>`: Update a specific module (e.g., `engine`, `common`, `backend`).

## Developing Mods

To create a new mod:

1. Create a folder in `mods/my-new-mod`.
2. Run `pnpm init` inside that folder.
3. Add internal dependencies:
   ```bash
   pnpm add @screeps/common --workspace
   ```
4. Implement your mod as a function export:
   ```javascript
   // index.js
   module.exports = function(config) {
       // Your mod logic here
   };
   ```

## Documentation

For more detailed technical information, check the `docs/` folder:
- [Running Locally](docs/running-locally.md)
- [Storage API](docs/storage.md)
- [Backend & HTTP API](docs/api.md)

## License

The monorepo structure is provided under the ISC license. Included Screeps core modules remain under their respective licenses (mostly ISC).
