# Screeps Server Mods Monorepo

A specialized monorepo for developing and managing Screeps private server mods. This project integrates the core Screeps server components as local workspace packages, allowing for deep integration, easy cross-referencing, and robust mod development.

## Project Structure

This is a **pnpm monorepo** with the following directory layout:

- **`mods/`**: Contains custom server mods.
- **`packages/`**: Contains the core Screeps server modules, integrated via `git subtree`.
    - `common`: Shared constants, config manager, and storage client.
    - `engine`: The game engine core logic.
    - `driver`: Bridge between engine and storage/database.
    - `storage`: In-memory database (LokiJS) and Pub/Sub server.
    - `backend-local`: Web server and API for the standalone server.
    - `launcher`: Coordination and process management.
- **`docs/`**: Project-specific documentation for internal APIs.
- **`reference/`**: Original Screeps server source for additional reference.

## Tech Stack

- **Node.js**: Pinned to **v24** (required for native modules compatibility, e.g., `@screeps/driver`).
- **Package Manager**: `pnpm` with Workspaces.
- **Environment Management**: `mise` (for Node.js versioning).

## Development Guide

### Core Workflows

1.  **Adding a New Mod**:
    - Create a directory in `mods/`.
    - Initialize with `pnpm init`.
    - Add internal dependencies: `pnpm add @screeps/common --workspace`.
2.  **Mod Entry Point**:
    - Every mod must export a function: `module.exports = function(config) { ... }`.
    - This function is called during server initialization with the global `config` object.
3.  **Local Linking**:
    - All core packages in `packages/` use `workspace:*` dependencies. 
    - Changes to core modules are immediately reflected across the workspace without needing to publish.

### Key Commands

- **Initialize Workspace**: `pnpm install`
- **Update Screeps Subtrees**:
    - Update all: `pnpm subtree:update:all`
    - Update specific (e.g., engine): `pnpm subtree:update:engine`

## Core Concepts

### Storage API
The server uses a centralized storage process. Mods should interact with it via `common.storage`.
- `storage.db`: Access to LokiJS collections.
- `storage.env`: Shared key-value state.
- `storage.pubsub`: Inter-process communication.
*See `docs/storage.md` for details.*

### Backend API
Custom HTTP endpoints can be added by hooking into `config.backend.router` or listening to `expressPreConfig`/`expressPostConfig` events.
*See `docs/api.md` for details.*

## Conventions

- **Node Version**: Always execute with Node 24 (use `mise exec -- ...` or ensure `mise` is active).
- **Subtree Management**: Do not modify files in `packages/` directly if they are meant to be updated from upstream. Use the `subtree:update` scripts.
- **Workspace Dependencies**: Always use the `workspace:*` protocol for internal `@screeps/` package references.
