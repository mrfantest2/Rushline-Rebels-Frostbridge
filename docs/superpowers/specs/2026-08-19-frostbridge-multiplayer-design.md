# Rushline Rebels: Frostbridge — Multiplayer Production Design

Date: 2026-08-19
Branch: `production/multiplayer-foundation`
Status: Approved architecture, implementation not yet started

## 1. Purpose

Convert the existing standalone Frostbridge browser prototype into a real-time party game with three coordinated surfaces:

- `/host` — room creation and match control
- `/tv` — shared spectator/game display
- `/play` — player phone join and controller

The server is authoritative for all hidden bridge state, timing, lives, round progression, and outcomes. Clients render state and submit intent; they never decide truth.

## 2. Initial Production Scope

The first production milestone supports:

- one Node.js 22 server process
- Express for HTTP/static delivery
- Socket.IO for real-time communication
- 5-character room codes
- up to 6 players per room
- 6 existing Rebel identities: Nadir, Zayd, Jolyne, Dana, Sami, Rami
- 10 bridge stages per round
- 3 lives per player by default
- 8-second simultaneous decision window per stage
- server-generated hidden safe-side pattern
- host-controlled room and round lifecycle
- player reconnect with session restoration
- spectator TV synchronization
- automated server, protocol, multi-client, and preflight CI coverage
- in-memory room storage with expiry

The first milestone does not include accounts, a database, cloud matchmaking, persistent progression, monetization, analytics dashboards, voice chat, native mobile apps, or cross-server room migration.

## 3. Architecture Choice

Use Node.js 22 + Express + Socket.IO.

Reasons:

- browser phone controllers require no installation
- Socket.IO provides WebSocket transport, reconnect behavior, acknowledgements, rooms, and fallback transport
- Express can serve the existing static game assets and new host/TV/player surfaces from the same process
- the same service can run locally, on a VM/container, or behind Cloudflare without changing the game protocol
- host-authoritative state remains centralized and testable

A hosted realtime database and WebRTC peer-to-peer were rejected for the first milestone because both add complexity without improving the core party-game requirement. A database can be added later when persistent accounts or match history become requirements.

## 4. Server Components

### 4.1 HTTP application

Responsibilities:

- serve `/`, `/host`, `/tv`, `/play`
- serve shared static assets
- expose `GET /healthz`
- expose `GET /readyz`
- provide a small version/build metadata payload to clients

### 4.2 Room manager

Responsibilities:

- create unique room codes
- store active room instances in memory
- look up rooms by normalized code
- expire inactive rooms
- prevent room-code collisions

Room codes use an unambiguous uppercase alphabet excluding visually confusing characters such as `0/O` and `1/I`.

### 4.3 Authoritative game engine

Responsibilities:

- own round IDs and stage indices
- generate the hidden bridge pattern with cryptographically secure randomness
- enforce stage deadlines
- accept at most one effective choice per player per stage
- resolve all alive players simultaneously
- deduct lives
- eliminate players at zero lives
- calculate winner/finish state
- emit public state snapshots

The hidden safe side for an unresolved stage never appears in any client payload.

### 4.4 Session manager

Responsibilities:

- issue a random host token when a room is created
- issue a random player session token when a player joins
- bind tokens to room/player identities
- hash tokens before storing them in server memory
- restore disconnected player slots when a valid token reconnects
- reject impersonation attempts

Room code is a locator, not an authorization secret.

## 5. Room and Player Model

A room contains:

- `roomCode`
- `createdAt`
- `lastActivityAt`
- `status`: `lobby | countdown | stage-open | stage-reveal | finished | closed`
- host token digest
- host connection state
- TV spectator connection count
- settings
- players map
- current round state or null

Default settings:

- `maxPlayers = 6`
- `stageCount = 10`
- `startingLives = 3`
- `decisionMs = 8000`
- `revealMs = 1800`
- `countdownMs = 3000`

A player contains:

- stable server-generated `playerId`
- display name
- selected `characterId`
- session token digest
- connection state
- reconnect deadline when disconnected
- lives
- eliminated flag
- current-stage submission metadata

Character IDs are canonical lowercase identifiers: `nadir`, `zayd`, `jolyne`, `dana`, `sami`, `rami`.

Duplicate character selection is allowed in the first milestone so room capacity is not blocked by roster contention.

## 6. Round State Machine

### Lobby

Players join, reconnect, choose character, and mark ready. Host can change settings while no round is active.

### Countdown

Host starts the round. Server freezes the participant list, creates a new `roundId`, initializes lives, generates the full hidden bridge path, and emits a 3-second countdown.

### Stage open

Server publishes:

- `roundId`
- `stageIndex`
- stage deadline timestamp
- alive player list
- submitted-player count

Each alive player may submit exactly one LEFT or RIGHT choice for that stage.

### Early close

If every alive connected player has submitted, the server may close the decision window before the 8-second deadline.

A disconnected player remains eligible until the stage deadline and may reconnect and submit during that window.

### Deadline behavior

A player who has not submitted by the deadline receives a failed-stage outcome and loses one life. No default side is selected on the player's behalf.

### Reveal

The server reveals the safe side only after the stage is closed. It resolves every alive player in one authoritative operation and emits outcomes to all host/TV/player clients.

Outcome values are:

- `safe`
- `broken`
- `timeout`
- `eliminated`

Reveal remains visible for 1.8 seconds by default.

### Next stage

If at least one player remains alive and more bridge stages remain, the server increments `stageIndex` and opens the next decision window.

### Finish

The round finishes when:

- stage 10 resolves, or
- all players are eliminated

Ranking is deterministic:

1. players who survive all stages
2. then greater furthest-stage progress
3. then more remaining lives
4. then earlier final successful submission timestamp
5. stable `playerId` ordering as final tie-break

## 7. Input Validation and Idempotency

Every player move includes:

- room code
- player session token
- `roundId`
- `stageIndex`
- monotonically increasing client `inputSeq`
- side: `L` or `R`

The server rejects:

- unknown room
- invalid/expired player session
- eliminated player
- wrong round ID
- stale or future stage index
- input after stage close
- malformed side
- replayed/lower `inputSeq`
- second effective submission for the same player/stage

Socket acknowledgement returns either accepted metadata or a stable error code. Rejected inputs never mutate game state.

## 8. Reconnect Contract

Player reconnect grace is 90 seconds.

On disconnect:

- the slot is retained
- the player is marked disconnected
- a reconnect deadline is recorded
- gameplay does not pause

On reconnect with a valid room code + session token:

- the same `playerId`, character, lives, elimination state, and current-stage submission are restored
- the server emits a full private state snapshot

After 90 seconds disconnected, the session becomes expired. If a round is active, the player slot remains in the round for deterministic ranking but cannot submit future moves. In the lobby, the expired slot is removed.

Host reconnect has no short grace expiry during the room lifetime. The host token can restore host control from another browser session.

## 9. Host Surface

`/host` provides:

- Create room
- prominent room code
- copy player join URL
- connected player list
- character/ready/connection state
- settings before round start
- Start Round
- End Round
- Close Room
- current stage/deadline/submission count
- player lives and elimination state

Host controls are authenticated by the host token. The token is never broadcast to TV/player clients and is stored only in host browser storage plus hashed server memory.

Mid-stage pause is intentionally excluded from the first milestone because it complicates deadline and reconnect semantics. Host may end the round immediately.

## 10. TV Surface

`/tv?room=ABCDE` is read-only.

It displays:

- room code while in lobby
- roster and readiness
- countdown
- all player characters on the bridge
- current stage and timer
- locked/submitted indicators without exposing submitted side
- simultaneous reveal animation
- lives/eliminations
- final ranking/winner screen

TV clients never receive host or player session tokens.

## 11. Player Phone Surface

`/play` supports:

1. room-code entry
2. display-name entry
3. character selection
4. ready state
5. active LEFT/RIGHT controller
6. accepted/locked state after submission
7. reveal outcome
8. lives/elimination state
9. reconnect restoration
10. final placement

After joining, the session token is stored in browser local storage scoped by room code. Reloading the page attempts session restoration before offering a new join.

The phone must not display another player's submitted side before reveal.

## 12. Socket Protocol

Client → server events:

- `host:create-room`
- `host:restore`
- `host:update-settings`
- `host:start-round`
- `host:end-round`
- `host:close-room`
- `tv:watch`
- `player:join`
- `player:restore`
- `player:set-character`
- `player:set-ready`
- `player:move`

Server → client events:

- `room:snapshot`
- `room:closed`
- `player:private-state`
- `round:countdown`
- `stage:open`
- `stage:submission-count`
- `stage:reveal`
- `round:finished`
- `server:error`

Payload schemas are centralized in shared modules and covered by tests. Events carry a `protocolVersion` field so incompatible clients can fail clearly.

## 13. Error Handling

Stable protocol errors include:

- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `ROOM_CLOSED`
- `HOST_AUTH_FAILED`
- `PLAYER_AUTH_FAILED`
- `PLAYER_NAME_INVALID`
- `CHARACTER_INVALID`
- `ROUND_NOT_ACTIVE`
- `ROUND_ID_STALE`
- `STAGE_STALE`
- `STAGE_CLOSED`
- `PLAYER_ELIMINATED`
- `MOVE_ALREADY_SUBMITTED`
- `INPUT_REPLAYED`
- `PROTOCOL_VERSION_UNSUPPORTED`

Expected client/protocol errors are returned through acknowledgements and do not crash the process. Unexpected server exceptions are logged with room/round context but never include raw tokens.

## 14. Room Expiry and Resource Limits

Initial in-memory limits:

- maximum 6 players per room
- maximum 100 concurrent rooms per process by default, configurable by environment variable
- lobby/finished room expires after 30 minutes with no socket activity
- active room hard lifetime: 4 hours
- reconnect grace: 90 seconds

Expired rooms are removed by a periodic sweeper and all remaining sockets receive `room:closed`.

## 15. Repository Layout

Planned structure:

```text
server/
  app.js
  config.js
  room-manager.js
  game-engine.js
  session-manager.js
  protocol.js
  validators.js
  logger.js
public/
  index.html
  host/
    index.html
    host.js
  tv/
    index.html
    tv.js
  play/
    index.html
    play.js
  shared/
    socket.js
    protocol.js
assets/
  characters/
  mockups/
tests/
  game-engine.test.js
  room-manager.test.js
  session-manager.test.js
  protocol.test.js
  multiplayer.integration.test.js
scripts/
  preflight.py
```

The existing root demo may be moved into `public/` while preserving `/` behavior.

## 16. Testing Strategy

### Unit tests

Cover:

- secure bridge generation shape
- stage transition rules
- correct/incorrect/timeout outcomes
- lives and elimination
- deterministic ranking
- room-code collision retry
- room expiry
- token validation
- reconnect grace
- stale/duplicate input rejection

### Multi-client integration test

Start the real server on an ephemeral port and use Socket.IO clients to:

1. create a room as host
2. join at least 3 players
3. attach a TV spectator
4. ready players
5. start a round
6. verify unresolved safe side is absent from public payloads
7. submit simultaneous moves
8. verify duplicate/stale moves are rejected
9. verify reveal is synchronized
10. disconnect and restore a player session
11. complete/end the round
12. verify final ranking and room cleanup behavior

### Existing preflight

The current static preflight remains and is extended to validate the server/public structure rather than removed.

## 17. CI Gate

GitHub Actions must block multiplayer PRs unless all of the following pass:

- Node dependency install from lockfile
- unit tests
- multi-client integration test
- existing static/preflight validation
- JavaScript syntax/static checks
- package build/artifact creation

No merge to `main` is considered production-ready if the multiplayer gate is red.

## 18. Deployment Contract

The first production server must run with:

- Node.js 22
- one writable process only for in-memory room state
- environment-configured `PORT`
- reverse-proxy/WebSocket support
- no sticky-session requirement while only one server process exists

A future horizontal-scaling phase must introduce shared state/pub-sub before more than one server process serves the same room namespace.

## 19. Security Boundary

The first milestone guarantees:

- unrevealed safe sides remain server-only
- host actions require host token
- player actions require player session token
- tokens are random, never logged, and stored hashed server-side
- client sequence/round/stage validation prevents replay and stale mutations
- room code alone cannot control host/player state
- inputs are length/type constrained

This is a party-game security model, not a financial/authentication platform. No personally sensitive data is required or persisted.

## 20. Acceptance Criteria

The multiplayer foundation is complete when:

1. a host can create a room and receive a 5-character code
2. six browser clients can join the room
3. a TV client can spectate the same authoritative state
4. the host can start a 10-stage round
5. each alive player can submit one private LEFT/RIGHT choice per stage
6. safe side is not leaked before server reveal
7. all choices resolve simultaneously
8. lives/elimination/ranking are server authoritative
9. stale, duplicate, replayed, or unauthenticated inputs are rejected
10. a disconnected player can restore the same session within 90 seconds
11. the full integration test passes under GitHub Actions
12. existing Frostbridge static preflight remains green
13. a successful CI run produces a deployable package artifact

## 21. Explicit Follow-on Phases

Not part of this implementation plan:

- persistent match history/database
- accounts and cloud identity
- character-specific abilities
- alternate game modes
- matchmaking
- analytics/telemetry dashboard
- native Android/iOS clients
- multi-process or multi-region scaling
- production CDN/domain configuration

Those phases may build on the protocol without weakening host authority.
