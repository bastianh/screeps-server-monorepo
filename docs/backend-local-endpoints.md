# `packages/backend-local/lib` Endpunkt-Doku

Diese Doku basiert auf den in `packages/backend-local/lib/game/server.js`, `packages/backend-local/lib/game/api/*.js` und `packages/backend-local/lib/game/socket/*.js` registrierten Endpunkten.

## Grundlagen

- HTTP-Basis:
  - `GET /`
  - `GET /api/...`
  - `GET /room-history`
  - `GET /assets/*`
- Socket-Basis:
  - SockJS unter `/socket`
- Auth:
  - Authentifizierte HTTP-Endpunkte verwenden `auth.tokenAuth`.
  - Nach erfolgreicher Auth liefert der Server einen erneuerten Token im Response-Header `X-Token`.
  - Socket-Authentifizierung erfolgt über die Nachricht `auth <token>`.
  - Tokens werden serverseitig in `env` unter `auth_<token>` mit `TTL=60s` gespeichert.
- Optional:
  - Wenn `SERVER_PASSWORD` gesetzt ist, muss zusätzlich der Header `X-Server-Password` mitgeschickt werden.

## Token-Lebensdauer

- Token-Erzeugung:
  - `authlib.genToken(...)` legt den Token mit `env.setex(..., 60, ...)` an.
- HTTP:
  - Jeder erfolgreiche Request auf einem geschützten Endpoint erzeugt in `tokenAuth(...)` einen neuen Token und sendet ihn in `X-Token` zurück.
  - Der Client muss diesen neuen Token weiterverwenden, sonst läuft der alte nach spätestens 60 Sekunden ab.
- Socket:
  - `auth <token>` validiert den Token und antwortet mit `auth ok <token>`; dabei wird ebenfalls direkt ein neuer Token erzeugt.
- Wichtig zum aktuellen Verhalten:
  - In `checkToken(...)` gibt es zwar einen Versuch, die TTL per `expire(..., 60)` zu verlängern.
  - Die Bedingung dafür ist `ttl > 100`, während Tokens initial nur `60` Sekunden TTL bekommen.
  - Dadurch greift diese Verlängerung im aktuellen Code praktisch nie.
  - Effektiv ist das Verhalten daher: ein Token lebt bis zu 60 Sekunden, erfolgreiche Authentifizierung gibt aber jeweils einen frisch erzeugten Folgetoken zurück.

## Nicht unter `/api`

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/` | Einfache HTML-Statusseite des Servers. |
| `GET` | `/assets/*` | Statische Assets aus `ASSET_DIR`. |
| `GET` | `/room-history?room=<room>&time=<time>` | Liefert Room-History via `config.backend.onGetRoomHistory(...)`. Standardmäßig nicht implementiert. |
| `GET` | `/socket` | SockJS-Endpunkt für Realtime-Subscriptions. |

## Allgemeine API-Endpunkte

| Methode | Pfad | Auth | Beschreibung |
| --- | --- | --- | --- |
| `GET` | `/api/version` | nein | Protokollversion, Auth-Modus, User-Anzahl und `serverData`. |

## Auth

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `GET` | `/api/auth/me` | ja | - | Aktuellen Benutzer zurückgeben. |
| `POST` | `/api/auth/steam-ticket` | nein | Body: `ticket`, optional `useNativeAuth` | Steam-Login, legt Nutzer bei Bedarf an und liefert `{ token, steamid }`. |

## Registrierung

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `GET` | `/api/register/check-email` | nein | Query: `email` | Prüft, ob E-Mail frei ist. |
| `GET` | `/api/register/check-username` | nein | Query: `username` | Prüft, ob Username frei ist. |
| `POST` | `/api/register/set-username` | ja | Body: `username`, optional `email` | Setzt initialen Usernamen und optional E-Mail. |

## User

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `GET` | `/api/user/world-start-room` | ja | - | Liefert bevorzugten Start-Raum. |
| `GET` | `/api/user/world-status` | ja | - | Liefert `empty`, `lost` oder `normal`. |
| `GET` | `/api/user/branches` | ja | - | Listet Code-Branches des Users. |
| `POST` | `/api/user/code` | ja | Body: `modules`, optional `branch`, optional `_hash` | Speichert Code in einem Branch. |
| `GET` | `/api/user/code` | ja | Query: optional `branch` | Lädt Code eines Branches. |
| `POST` | `/api/user/badge` | ja | Body: `badge` | Aktualisiert das Badge. |
| `GET` | `/api/user/respawn-prohibited-rooms` | ja | - | Liefert aktuell immer `{ rooms: [] }`. |
| `POST` | `/api/user/respawn` | ja | - | Respawn des aktuellen Users. |
| `POST` | `/api/user/set-active-branch` | ja | Body: `activeName`, `branch` | Setzt `activeWorld` oder `activeSim`. |
| `POST` | `/api/user/clone-branch` | ja | Body: `newName`, optional `branch`, optional `defaultModules` | Klont oder erstellt einen Branch. |
| `POST` | `/api/user/delete-branch` | ja | Body: `branch` | Löscht einen nicht aktiven Branch. |
| `GET` | `/api/user/memory` | ja | Query: optional `path` | Liest Memory oder einen Teilpfad, meist gzip/base64 kodiert als `gz:...`. |
| `POST` | `/api/user/memory` | ja | Body: optional `path`, `value` | Schreibt oder löscht Memory per Console-Expression. |
| `GET` | `/api/user/memory-segment` | ja | Query: `segment` | Liest Memory-Segment `0..99`. |
| `POST` | `/api/user/memory-segment` | ja | Body: `segment`, `data` | Schreibt Memory-Segment `0..99`. |
| `POST` | `/api/user/console` | ja | Body: `expression` | Stellt einen Console-Befehl ein. |
| `GET` | `/api/user/find` | nein | Query: `username` oder `id` | Sucht einen User. |
| `GET` | `/api/user/stats` | nein | Query: `interval` (`8`, `180`, `1440`) | Platzhalter, liefert aktuell `{ stats: {} }`. |
| `GET` | `/api/user/rooms` | nein | Query: `id` | Listet Räume eines Users. |
| `POST` | `/api/user/notify-prefs` | ja | Body: `disabled`, `disabledOnMessages`, `sendOnline`, `interval`, `errorsInterval` | Aktualisiert Notification-Preferences. |
| `GET` | `/api/user/overview` | ja | Query: optional `interval`, optional `statName` | Übersicht über User-Räume; Statistik ist aktuell weitgehend Platzhalter. |
| `POST` | `/api/user/tutorial-done` | ja | - | Vorhanden, aktuell ohne Logik. |
| `POST` | `/api/user/email` | ja | Body: `email` | Setzt oder ändert E-Mail. |
| `GET` | `/api/user/money-history` | ja | Query: optional `page` | Paginierte Money-History. |
| `GET` | `/api/user/badge-svg` | nein | Query: `username`, optional `border=1` | Rendert Badge als SVG. |
| `POST` | `/api/user/set-steam-visible` | ja | Body: `visible` | Schaltet Sichtbarkeit der Steam-Profillink-Daten. |

## User Messages

Alle folgenden Endpunkte hängen unter `/api/user/messages`.

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `POST` | `/api/user/messages/send` | ja | Body: `respondent`, `text` | Sendet Nachricht an anderen User. |
| `GET` | `/api/user/messages/list` | ja | Query: `respondent` | Verlauf mit einem User, max. 100 Nachrichten. |
| `GET` | `/api/user/messages/index` | ja | - | Konversationsübersicht. |
| `POST` | `/api/user/messages/mark-read` | ja | Body: `id` | Markiert eingehende Nachricht als gelesen. |
| `GET` | `/api/user/messages/unread-count` | ja | - | Anzahl ungelesener Nachrichten. |

## Game

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `POST` | `/api/game/map-stats` | ja | Body: `rooms[]`, `statName` | Karten-/Ownership-Daten für mehrere Räume. |
| `GET` | `/api/game/time` | nein | - | Aktuelle Game-Time. |
| `GET` | `/api/game/room-terrain` | nein | Query: `room`, optional `encoded` | Terrain eines Raums. |
| `GET` | `/api/game/room-status` | ja | Query: `room` | Statusdaten eines Raums. |
| `POST` | `/api/game/gen-unique-object-name` | ja | Body: `type` | Generiert eindeutigen Objekt-Namen, aktuell für `spawn`. |
| `POST` | `/api/game/check-unique-object-name` | ja | Body: `type`, `name` | Prüft Objekt-Namen, aktuell für `spawn`. |
| `POST` | `/api/game/place-spawn` | ja | Body: `room`, `x`, `y`, optional `name` | Setzt initialen Spawn in die Welt. |
| `POST` | `/api/game/rooms` | nein | Body: `rooms[]` | Terrain-Datensätze für mehrere Räume. |
| `POST` | `/api/game/create-flag` | ja | Body: `room`, `x`, `y`, `name`, `color`, `secondaryColor` | Erstellt oder ersetzt Flag. |
| `POST` | `/api/game/gen-unique-flag-name` | ja | - | Generiert eindeutigen Flag-Namen. |
| `POST` | `/api/game/check-unique-flag-name` | ja | Body: `name` | Prüft, ob Flag-Name frei ist. |
| `POST` | `/api/game/change-flag-color` | ja | Body: `room`, `name`, `color`, `secondaryColor` | Ändert Flag-Farben. |
| `POST` | `/api/game/remove-flag` | ja | Body: `room`, `name` | Entfernt Flag. |
| `POST` | `/api/game/add-object-intent` | ja | Body: `_id`, `room`, `name`, `intent` | Stellt User-Intent für ein Raumobjekt ein. |
| `POST` | `/api/game/create-construction` | ja | Body: `room`, `x`, `y`, `structureType`, optional `name` | Erstellt eine Construction Site. |
| `GET` | `/api/game/room-overview` | ja | Query: `room` | Owner- und Placeholder-Stats für einen Raum. |
| `POST` | `/api/game/set-notify-when-attacked` | ja | Body: `_id`, `enabled` | Setzt `notifyWhenAttacked` für ein Objekt. |
| `POST` | `/api/game/create-invader` | ja | Body: `room`, `x`, `y`, `size`, `type`, optional `boosted` | Spawnt Test-Invader. |
| `POST` | `/api/game/remove-invader` | ja | Body: `_id` | Entfernt einen vom User erzeugten Invader. |
| `GET` | `/api/game/world-size` | nein | - | Weltgröße als `{ width, height }`. |
| `POST` | `/api/game/add-global-intent` | ja | Body: `name`, `intent` | Schreibt globale User-Intents. |
| `GET` | `/api/game/tick` | nein | - | Geschätzte Tickdauer auf Basis der letzten Ticks. |

Hinweis: `GET /api/game/time` ist in `game.js` zweimal registriert, aber mit identischem Verhalten.

## Market

Alle folgenden Endpunkte hängen unter `/api/game/market`.

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `GET` | `/api/game/market/orders-index` | ja | - | Aggregation aktiver Orders pro Resource-Typ. |
| `GET` | `/api/game/market/orders` | ja | Query: `resourceType` | Aktive Orders für einen Resource-Typ. |
| `GET` | `/api/game/market/my-orders` | ja | - | Eigene Orders. |
| `GET` | `/api/game/market/stats` | ja | Query: `resourceType` | Historische Market-Stats. |

## Power Creeps

Alle folgenden Endpunkte hängen unter `/api/game/power-creeps`.

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `GET` | `/api/game/power-creeps/list` | ja | - | Listet Power Creeps des Users. |
| `POST` | `/api/game/power-creeps/create` | ja | Body: `name`, `className` | Erstellt einen Power Creep. |
| `POST` | `/api/game/power-creeps/delete` | ja | Body: `id` | Löscht oder scheduled Löschen eines Power Creeps. |
| `POST` | `/api/game/power-creeps/cancel-delete` | ja | Body: `id` | Hebt Löschung auf. |
| `POST` | `/api/game/power-creeps/upgrade` | ja | Body: `id`, `powers` | Aktualisiert Power-Level/Powerset. |
| `POST` | `/api/game/power-creeps/rename` | ja | Body: `id`, `name` | Benennt Power Creep um. |
| `POST` | `/api/game/power-creeps/experimentation` | ja | - | Startet 24h Power-Experimentation-Fenster. |

## Leaderboard

| Methode | Pfad | Auth | Wichtige Parameter | Beschreibung |
| --- | --- | --- | --- | --- |
| `GET` | `/api/leaderboard/list` | nein | - | Aktuell Platzhalter `{ list: [], count: 0, users: {} }`. |
| `GET` | `/api/leaderboard/find` | nein | Query: optional `season` | Ohne `season` leere Liste, mit `season` Fehler `result not found`. |
| `GET` | `/api/leaderboard/seasons` | nein | - | Zwei Placeholder-Seasons. |

## Socket-Kanäle

Verbindung über SockJS `/socket`. Relevante Client-Nachrichten:

- `auth <token>`: authentifiziert die Verbindung.
- `subscribe <channel>`: Channel abonnieren.
- `unsubscribe <channel>`: Channel abbestellen.
- `gzip on|off`: Komprimierung umschalten.

### Öffentliche oder allgemein verfügbare Kanäle

| Channel | Auth | Beschreibung |
| --- | --- | --- |
| `server-message` | nein | Broadcast von `serverMessage`. |

### Raumbezogene Kanäle

| Channel | Auth | Beschreibung |
| --- | --- | --- |
| `room:<roomName>` | ja | Live-Diffs für Raumobjekte, User-Metadaten, Flags und `info`. |
| `err@room:<roomName>` | ja | Fehlerkanal für `room:<roomName>`, z. B. Subscribe-Limit. |
| `roomMap2:<roomName>` | ja | Kartenansicht eines Raums aus `MAP_VIEW`. |

### User-bezogene Kanäle

Nur für den jeweils authentifizierten User abonnierbar.

| Channel | Beschreibung |
| --- | --- |
| `user:<userId>/code` | Push bei Code-Änderungen. |
| `user:<userId>/console` | Console-Ausgaben. |
| `user:<userId>/cpu` | CPU-/Memory-Update. |
| `user:<userId>/set-active-branch` | Änderung des aktiven Branches. |
| `user:<userId>/message:<otherUserId>` | Nachrichten-Updates pro Konversation. |
| `user:<userId>/newMessage` | Signal für neue eingehende Nachricht. |
| `user:<userId>/memory/<path>` | Live-Wert eines Memory-Pfads. |
| `user:<userId>/resources` | Ressourcen- und Credits-Updates. |
| `mapVisual:<userId>` | Map-Visual des Users. |

## Quellen

- [packages/backend-local/lib/game/server.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/server.js)
- [packages/backend-local/lib/game/api/auth.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/auth.js)
- [packages/backend-local/lib/game/api/register.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/register.js)
- [packages/backend-local/lib/game/api/user.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/user.js)
- [packages/backend-local/lib/game/api/user-messages.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/user-messages.js)
- [packages/backend-local/lib/game/api/game.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/game.js)
- [packages/backend-local/lib/game/api/market.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/market.js)
- [packages/backend-local/lib/game/api/power-creeps.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/power-creeps.js)
- [packages/backend-local/lib/game/api/leaderboard.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/api/leaderboard.js)
- [packages/backend-local/lib/game/socket/server.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/socket/server.js)
- [packages/backend-local/lib/game/socket/system.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/socket/system.js)
- [packages/backend-local/lib/game/socket/rooms.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/socket/rooms.js)
- [packages/backend-local/lib/game/socket/map.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/socket/map.js)
- [packages/backend-local/lib/game/socket/user.js](/Users/bastianh/Development/screeps-server-monorepo/packages/backend-local/lib/game/socket/user.js)
