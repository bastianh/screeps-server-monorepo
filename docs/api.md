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

Since the backend already uses Passport, you can register new strategies in `expressPreConfig`. This is useful if you want to support alternative authentication methods like API Keys or external OAuth providers.

```javascript
const passport = require('passport');
const CustomStrategy = require('passport-custom').Strategy;

module.exports = function(config) {
    if (config.backend) {
        config.backend.on('expressPreConfig', (app) => {
            passport.use('my-custom-auth', new CustomStrategy(
                function(req, callback) {
                    // Your custom logic to identify the user
                    const apiKey = req.headers['x-api-key'];
                    if (apiKey === 'secret') {
                         common.storage.db.users.findOne({ username: 'admin' })
                            .then(user => callback(null, user))
                            .catch(err => callback(err));
                    } else {
                        callback(null, false);
                    }
                }
            ));
        });
    }
};
```

## Fine-grained Permissions (Scopes)

The standard Screeps authentication only identifies the user (`request.user`). To implement specific permissions (e.g., read-only tokens or restricted endpoints), you can extend the token data.

### 1. Generating Scoped Tokens

The default `authlib.genToken` only stores the user ID. You can create a custom token generator that stores a JSON object instead.

```javascript
const crypto = require('crypto');
const storage = require('@screeps/common').storage;

async function genScopedToken(userId, scopes) {
    const token = crypto.randomBytes(16).toString('hex');
    const data = JSON.stringify({ userId, scopes });
    // Store in storage.env with expiration (e.g., 1 hour)
    await storage.env.setex(`auth_${token}`, 3600, data);
    return token;
}
```

### 2. Validating Scoped Tokens

You need a custom Passport strategy to retrieve and parse the scoped data.

```javascript
const passport = require('passport');
const TokenStrategy = require('passport-token').Strategy;

config.backend.on('expressPreConfig', (app) => {
    passport.use('scoped-token', new TokenStrategy(async (email, token, done) => {
        try {
            const dataRaw = await storage.env.get(`auth_${token}`);
            if (!dataRaw) return done(null, false);

            const data = JSON.parse(dataRaw);
            const user = await storage.db.users.findOne({ _id: data.userId });
            
            if (user) {
                // Attach scopes to the user object for the request lifecycle
                user.scopes = data.scopes;
                return done(null, user);
            }
            done(null, false);
        } catch (e) {
            done(e);
        }
    }));
});
```

### 3. Permission Middleware

Create a middleware that checks if the current `request.user` has the required scope.

```javascript
function requireScope(requiredScope) {
    return (req, res, next) => {
        if (req.user && req.user.scopes && req.user.scopes.includes(requiredScope)) {
            return next();
        }
        res.status(403).json({ error: 'forbidden', reason: `Missing scope: ${requiredScope}` });
    };
}

// Usage in a route:
config.backend.router.get('/my-mod/private-data', 
    passport.authenticate('scoped-token', { session: false }),
    requireScope('read:data'),
    (req, res) => {
        res.json({ data: "..." });
    }
);
```

Using this pattern, you can create tokens that are restricted to specific mods or actions (e.g., `room:visuals`, `market:read`) without giving full account access.

