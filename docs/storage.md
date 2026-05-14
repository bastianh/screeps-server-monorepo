# @screeps/storage Documentation

The `@screeps/storage` module is the central data hub of a Screeps private server. It manages the database (LokiJS), shared environment variables (state), task queues, and inter-process communication via Pub/Sub.

## Architecture

The storage system consists of two parts:
1.  **Storage Server**: A standalone process (implemented in `@screeps/storage`) that holds the data in memory and listens for RPC connections.
2.  **Storage Client**: A client implemented in `@screeps/common/lib/storage.js` that other modules (engine, backend, mods) use to communicate with the server.

In your mods, you should always use the storage client provided by `@screeps/common`.

## Getting Started

To use storage in your mod, you first need to connect to it.

```javascript
const common = require('@screeps/common');
const storage = common.storage;

// Connect to the storage server
storage._connect().then(() => {
    console.log('Connected to storage!');
    
    // Now you can use storage.db, storage.env, storage.pubsub, storage.queue
});
```

## Database API (`storage.db`)

The database is organized into collections. Each collection provides methods similar to MongoDB or LokiJS.

### Available Collections

Standard collections include:
- `users`: User profiles and settings.
- `rooms`: Room state and metadata.
- `rooms.objects`: All objects in rooms (creeps, structures, etc.).
- `rooms.terrain`: Terrain data.
- `market.orders`: Active market orders.
- ... and more (see `@screeps/common/lib/storage.js` for the full list).

### Common Methods

Each collection (e.g., `storage.db.users`) has the following methods:

- `find(query)`: Returns an array of matching documents.
- `findOne(query)`: Returns a single matching document.
- `update(query, update, [params])`: Updates documents. `params.upsert` can be used to insert if not found.
- `insert(data)`: Inserts a new document.
- `count(query)`: Returns the number of matching documents.
- `removeWhere(query)`: Removes matching documents.
- `bulk(operations)`: Performs multiple operations in one request.
- `findEx(query, opts)`: Advanced find with `sort`, `limit`, and `offset`.

#### Example: Finding a User

```javascript
storage.db.users.findOne({ username: 'Screeps' }).then(user => {
    console.log('Found user:', user._id);
});
```

#### Example: Updating Room Objects

```javascript
storage.db['rooms.objects'].update(
    { type: 'creep', user: 'userId' },
    { $set: { hits: 100 } }
).then(result => {
    console.log('Updated', result.modified, 'creeps');
});
```

## Environment API (`storage.env`)

`storage.env` is used for storing shared server state and configuration that needs to be accessible across different processes.

### Keys

Common keys are available in `storage.env.keys`:
- `GAMETIME`: Current game tick.
- `MAIN_LOOP_PAUSED`: Whether the server is paused.
- `MEMORY`: User memory storage.

### Methods

- `get(key)`: Gets a value.
- `set(key, value)`: Sets a value.
- `setex(key, seconds, value)`: Sets a value with an expiration time.
- `del(key)`: Deletes a key.
- `ttl(key)`: Gets the remaining time-to-live for a key.
- `hget(key, field)` / `hset(key, field, value)`: Hash map operations.
- `sadd(key, value)` / `smembers(key)`: Set operations.

#### Example: Getting Game Time

```javascript
storage.env.get(storage.env.keys.GAMETIME).then(time => {
    console.log('Current game time:', time);
});
```

## Pub/Sub API (`storage.pubsub`)

Used for real-time messaging between processes.

- `publish(channel, data)`: Sends a message.
- `subscribe(channel, callback)`: Listens for messages on a channel.

### Common Channels

Available in `storage.pubsub.keys`:
- `TICK_STARTED`: Fired when a new tick begins.
- `RUNTIME_RESTART`: Request to restart the game engine.

#### Example: Subscribing to Tick Events

```javascript
storage.pubsub.subscribe(storage.pubsub.keys.TICK_STARTED, (gameTime) => {
    console.log('A new tick has started:', gameTime);
});
```

## Queue API (`storage.queue`)

Manages task queues for the engine and other background workers.

- `fetch(queueName)`: Gets the next item from the queue.
- `add(queueName, id)`: Adds an item to the queue.
- `markDone(queueName, id)`: Marks an item as processed.
- `whenAllDone(queueName)`: Returns a promise that resolves when the queue is empty.

Standard queues: `usersLegacy`, `usersIvm`, `rooms`.
