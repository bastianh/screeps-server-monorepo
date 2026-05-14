# Screeps API & Authentication Documentation

The Screeps backend (implemented in `@screeps/backend-local`) is an Express-based web server that provides the HTTP API used by the game client and CLI.

## Endpoint Structure

Most API endpoints are grouped by functionality and prefixed with `/api`. The main entry point for routing is `packages/backend-local/lib/game/server.js`.

### How Endpoints are Defined

Endpoints are organized using Express Routers located in `packages/backend-local/lib/game/api/`.

Example: `/api/game/room-status`
1.  In `server.js`: `config.backend.router.use('/game', require('./api/game'));`
2.  In `api/game.js`:
    ```javascript
    router.get('/room-status', auth.tokenAuth, jsonResponse((request) => {
        return db.rooms.findOne({_id: request.query.room})
        .then((data) => ({room: _.pick(data, ['status','novice','respawnArea','openTime'])}));
    }));
    ```

Note: `jsonResponse` is a helper (from `q-json-response`) that wraps a function returning a Promise and sends the result as a JSON response.

## Adding Custom Endpoints in Mods

There are two primary ways to add custom HTTP endpoints via mods.

### 1. Using `config.backend.router`

The backend configuration object exposes an Express router that is mounted at `/api`. You can add your own routes to this router.

```javascript
// In your mod's index.js
module.exports = function(config) {
    if (config.backend) {
        config.backend.router.get('/my-mod/status', (req, res) => {
            res.json({ ok: true, message: "Mod is active" });
        });
    }
};
```

### 2. Direct Express App Manipulation

The backend emits `expressPreConfig` and `expressPostConfig` events when the Express app is being initialized. You can listen to these events to add middleware or routes directly to the `app` instance.

```javascript
// In your mod's index.js
module.exports = function(config) {
    if (config.backend) {
        config.backend.on('expressPreConfig', (app) => {
            // This runs before standard routes are added
            app.use((req, res, next) => {
                console.log(`Request received: ${req.url}`);
                next();
            });
        });

        config.backend.on('expressPostConfig', (app) => {
            // This runs after all standard routes and middleware are added
            app.get('/custom-direct-route', (req, res) => {
                res.send('Hello from mod!');
            });
        });
    }
};
```

## Authentication System

The server uses [Passport](http://www.passportjs.org/) for authentication.

### Token Authentication

The standard authentication method uses a custom `TokenStrategy`. 
- Middleware: `auth.tokenAuth` (found in `packages/backend-local/lib/game/api/auth.js`).
- Logic: It checks for a token (usually passed in `X-Token` header or `token` query param), validates it via `authlib.checkToken`, and attaches the user object to `request.user`.

### Adding Custom Authentication

To add a custom authentication method (e.g., a new Passport strategy or custom token logic), you can hook into `expressPreConfig`.

#### Example: Custom Token Logic

```javascript
module.exports = function(config) {
    if (config.backend) {
        config.backend.on('expressPreConfig', (app) => {
            app.use('/api/my-secure-route', (req, res, next) => {
                const customSecret = req.headers['x-custom-auth'];
                if (customSecret === 'my-secret-key') {
                    // Manually find user and attach to request
                    common.storage.db.users.findOne({ username: 'admin' })
                        .then(user => {
                            req.user = user;
                            next();
                        });
                } else {
                    res.status(401).json({ error: 'Unauthorized mod access' });
                }
            });
        });
    }
};
```

#### Example: Adding a Passport Strategy

Since the backend already uses Passport, you can register new strategies in `expressPreConfig`:

```javascript
const passport = require('passport');
const CustomStrategy = require('passport-custom').Strategy;

module.exports = function(config) {
    if (config.backend) {
        config.backend.on('expressPreConfig', (app) => {
            passport.use('my-strategy', new CustomStrategy(
                function(req, callback) {
                    // Your custom logic to identify the user
                    // ...
                    callback(null, user);
                }
            ));
        });
    }
};
```
