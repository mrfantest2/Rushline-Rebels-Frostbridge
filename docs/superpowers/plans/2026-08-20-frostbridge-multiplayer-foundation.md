# Frostbridge Multiplayer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production multiplayer Frostbridge milestone: one host-authoritative Node.js server, room-code joining, synchronized TV/player/host surfaces, reconnect restoration, simultaneous hidden LEFT/RIGHT decisions, and a CI gate that proves the full flow.

**Architecture:** A single Node.js 22 process runs Express and Socket.IO. The server owns rooms, hidden bridge patterns, round/stage timers, player lives, ranking, authentication tokens, and all state transitions; browser clients only render state and submit intent. The first milestone keeps room state in memory and is intentionally single-process so no shared datastore or sticky-session layer is required.

**Tech Stack:** Node.js 22, ECMAScript modules, Express, Socket.IO, Socket.IO Client, Node built-in `node:test`, Python 3.12 preflight, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-frostbridge-multiplayer-design.md`

## Global Constraints

- Runtime floor is Node.js 22.
- One server process owns all in-memory room state.
- Room codes are 5 uppercase unambiguous characters.
- Maximum players per room is 6.
- Canonical character IDs are `nadir`, `zayd`, `jolyne`, `dana`, `sami`, `rami`.
- Default round is 10 stages, 3 starting lives, 8-second decision window, 1.8-second reveal, 3-second countdown.
- Hidden safe sides never appear in client payloads before reveal.
- Player reconnect grace is 90 seconds.
- Host actions require a host token; player actions require a player session token; raw tokens are never logged and are stored hashed server-side.
- Room code alone never authorizes host or player mutation.
- Duplicate/stale/replayed inputs never mutate state.
- Players who join during an active round enter as spectators and become eligible only after the room returns to lobby.
- A disconnected alive player prevents early stage close until either they submit after reconnect or the stage deadline expires.
- Passing CI is required before the multiplayer foundation can merge to `main`.

---

## Planned File Structure

```text
package.json
package-lock.json
server/
  app.js                # HTTP + Socket.IO composition and process entrypoint
  config.js             # environment/default configuration
  protocol.js           # event names, protocol version, stable error codes
  validators.js         # payload/name/code/character/settings validation
  session-manager.js    # token issue/hash/verify and restore helpers
  game-engine.js        # authoritative round/stage state machine
  room-manager.js       # room lifecycle, joins, readiness, expiry, snapshots
  socket-gateway.js     # Socket.IO handlers and authorization boundary
  logger.js             # structured safe logging without tokens
public/
  index.html             # existing standalone landing/demo moved under static root
  host/index.html
  host/host.js
  tv/index.html
  tv/tv.js
  play/index.html
  play/play.js
  shared/socket.js
  shared/ui.css
assets/
  characters/            # existing assets stay canonical here
  mockups/
tests/
  helpers/test-clock.js
  helpers/socket-client.js
  validators.test.js
  session-manager.test.js
  game-engine.test.js
  room-manager.test.js
  multiplayer.integration.test.js
scripts/preflight.py
.github/workflows/main.yml
README.md
PRE-FLIGHT.md
```

---

### Task 1: Node Runtime, Protocol Constants, Validation, and Test Harness

**Files:**
- Create: `package.json`
- Create: `server/config.js`
- Create: `server/protocol.js`
- Create: `server/validators.js`
- Create: `tests/validators.test.js`
- Create after install: `package-lock.json`

**Interfaces:**
- Produces: `PROTOCOL_VERSION`, `EVENTS`, `ERROR_CODES`, `CHARACTER_IDS`, `DEFAULT_SETTINGS`.
- Produces: `validateRoomCode(value)`, `validateDisplayName(value)`, `validateCharacterId(value)`, `validateMovePayload(value)`, `validateSettingsPatch(value)` returning `{ ok: true, value }` or `{ ok: false, code }`.
- Later tasks consume those exact exports.

- [ ] **Step 1: Write the failing validator tests**

```js
// tests/validators.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDisplayName,
  validateCharacterId,
  validateMovePayload,
} from '../server/validators.js';

 test('display name is trimmed and length constrained', () => {
  assert.deepEqual(validateDisplayName('  Dana  '), { ok: true, value: 'Dana' });
  assert.equal(validateDisplayName('').ok, false);
  assert.equal(validateDisplayName('x'.repeat(33)).ok, false);
});

test('character id accepts only canonical rebels', () => {
  assert.deepEqual(validateCharacterId('dana'), { ok: true, value: 'dana' });
  assert.equal(validateCharacterId('layla').ok, false);
});

test('move payload constrains round stage sequence and side', () => {
  const good = validateMovePayload({ roundId: 'r1', stageIndex: 2, inputSeq: 7, side: 'L' });
  assert.equal(good.ok, true);
  assert.equal(validateMovePayload({ roundId: 'r1', stageIndex: 2, inputSeq: 7, side: 'X' }).ok, false);
  assert.equal(validateMovePayload({ roundId: 'r1', stageIndex: -1, inputSeq: 7, side: 'L' }).ok, false);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- tests/validators.test.js`

Expected: FAIL because `server/validators.js` and protocol/config exports do not exist.

- [ ] **Step 3: Add runtime manifest and minimal protocol/config implementation**

```json
{
  "name": "rushline-rebels-frostbridge",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node server/app.js",
    "test": "node --test --test-concurrency=1",
    "preflight": "python scripts/preflight.py"
  },
  "dependencies": {
    "express": "^5.1.0",
    "socket.io": "^4.8.1"
  },
  "devDependencies": {
    "socket.io-client": "^4.8.1"
  }
}
```

```js
// server/protocol.js
export const PROTOCOL_VERSION = 1;
export const CHARACTER_IDS = Object.freeze(['nadir','zayd','jolyne','dana','sami','rami']);
export const ERROR_CODES = Object.freeze({
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND', ROOM_FULL: 'ROOM_FULL', ROOM_CLOSED: 'ROOM_CLOSED',
  HOST_AUTH_FAILED: 'HOST_AUTH_FAILED', PLAYER_AUTH_FAILED: 'PLAYER_AUTH_FAILED',
  PLAYER_NAME_INVALID: 'PLAYER_NAME_INVALID', CHARACTER_INVALID: 'CHARACTER_INVALID',
  ROUND_NOT_ACTIVE: 'ROUND_NOT_ACTIVE', ROUND_ID_STALE: 'ROUND_ID_STALE',
  STAGE_STALE: 'STAGE_STALE', STAGE_CLOSED: 'STAGE_CLOSED', PLAYER_ELIMINATED: 'PLAYER_ELIMINATED',
  MOVE_ALREADY_SUBMITTED: 'MOVE_ALREADY_SUBMITTED', INPUT_REPLAYED: 'INPUT_REPLAYED',
  PROTOCOL_VERSION_UNSUPPORTED: 'PROTOCOL_VERSION_UNSUPPORTED', SETTINGS_INVALID: 'SETTINGS_INVALID'
});
export const EVENTS = Object.freeze({
  HOST_CREATE_ROOM:'host:create-room', HOST_RESTORE:'host:restore', HOST_UPDATE_SETTINGS:'host:update-settings',
  HOST_START_ROUND:'host:start-round', HOST_END_ROUND:'host:end-round', HOST_CLOSE_ROOM:'host:close-room',
  TV_WATCH:'tv:watch', PLAYER_JOIN:'player:join', PLAYER_RESTORE:'player:restore',
  PLAYER_SET_CHARACTER:'player:set-character', PLAYER_SET_READY:'player:set-ready', PLAYER_MOVE:'player:move',
  ROOM_SNAPSHOT:'room:snapshot', ROOM_CLOSED:'room:closed', PLAYER_PRIVATE_STATE:'player:private-state',
  ROUND_COUNTDOWN:'round:countdown', STAGE_OPEN:'stage:open', STAGE_SUBMISSION_COUNT:'stage:submission-count',
  STAGE_REVEAL:'stage:reveal', ROUND_FINISHED:'round:finished', SERVER_ERROR:'server:error'
});
```

```js
// server/config.js
export const DEFAULT_SETTINGS = Object.freeze({ maxPlayers:6, stageCount:10, startingLives:3, decisionMs:8000, revealMs:1800, countdownMs:3000 });
export const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 3000),
  maxRooms: Number(process.env.MAX_ROOMS || 100),
  reconnectGraceMs: 90_000,
  inactiveExpiryMs: 30 * 60_000,
  hardRoomLifetimeMs: 4 * 60 * 60_000,
});
```

- [ ] **Step 4: Implement validators with stable error results**

```js
// server/validators.js
import { CHARACTER_IDS, ERROR_CODES } from './protocol.js';
import { DEFAULT_SETTINGS } from './config.js';
const ok = value => ({ ok:true, value });
const bad = code => ({ ok:false, code });
export function validateDisplayName(value){
  if(typeof value !== 'string') return bad(ERROR_CODES.PLAYER_NAME_INVALID);
  const name=value.trim();
  return name.length >= 1 && name.length <= 32 ? ok(name) : bad(ERROR_CODES.PLAYER_NAME_INVALID);
}
export function validateCharacterId(value){ return CHARACTER_IDS.includes(value) ? ok(value) : bad(ERROR_CODES.CHARACTER_INVALID); }
export function validateRoomCode(value){
  const code=String(value||'').trim().toUpperCase();
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code) ? ok(code) : bad(ERROR_CODES.ROOM_NOT_FOUND);
}
export function validateMovePayload(v){
  if(!v || typeof v.roundId!=='string' || !Number.isInteger(v.stageIndex) || v.stageIndex<0 || !Number.isSafeInteger(v.inputSeq) || v.inputSeq<0 || !['L','R'].includes(v.side)) return bad(ERROR_CODES.STAGE_STALE);
  return ok({ roundId:v.roundId, stageIndex:v.stageIndex, inputSeq:v.inputSeq, side:v.side });
}
export function validateSettingsPatch(v){
  if(!v || typeof v!=='object') return bad(ERROR_CODES.SETTINGS_INVALID);
  const next={...DEFAULT_SETTINGS,...v};
  const valid=Number.isInteger(next.stageCount)&&next.stageCount>=1&&next.stageCount<=30&&Number.isInteger(next.startingLives)&&next.startingLives>=1&&next.startingLives<=9&&Number.isInteger(next.decisionMs)&&next.decisionMs>=2000&&next.decisionMs<=30000;
  return valid ? ok(next) : bad(ERROR_CODES.SETTINGS_INVALID);
}
```

- [ ] **Step 5: Install dependencies and run the validator tests**

Run: `npm install && npm test -- tests/validators.test.js`

Expected: PASS and `package-lock.json` is generated.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/config.js server/protocol.js server/validators.js tests/validators.test.js
git commit -m "feat: establish Frostbridge multiplayer protocol"
```

---

### Task 2: Session Tokens and Safe Authentication State

**Files:**
- Create: `server/session-manager.js`
- Create: `tests/session-manager.test.js`

**Interfaces:**
- Produces: `issueToken()` → raw token string.
- Produces: `hashToken(rawToken)` → SHA-256 hex digest.
- Produces: `verifyToken(rawToken, expectedDigest)` → boolean using constant-time comparison.
- Produces: `createCredential()` → `{ token, digest }`.

- [ ] **Step 1: Write failing session tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredential, verifyToken } from '../server/session-manager.js';

test('issued token verifies only against its own digest', () => {
  const a=createCredential();
  const b=createCredential();
  assert.notEqual(a.token,b.token);
  assert.equal(verifyToken(a.token,a.digest),true);
  assert.equal(verifyToken(b.token,a.digest),false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/session-manager.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement token issue/hash/verify**

```js
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const issueToken=()=>randomBytes(32).toString('base64url');
export const hashToken=t=>createHash('sha256').update(t).digest('hex');
export function verifyToken(raw,digest){
  if(typeof raw!=='string'||typeof digest!=='string') return false;
  const a=Buffer.from(hashToken(raw),'hex'), b=Buffer.from(digest,'hex');
  return a.length===b.length && timingSafeEqual(a,b);
}
export function createCredential(){ const token=issueToken(); return { token, digest:hashToken(token) }; }
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/session-manager.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/session-manager.js tests/session-manager.test.js
git commit -m "feat: add multiplayer session credentials"
```

---

### Task 3: Authoritative Game Engine

**Files:**
- Create: `server/game-engine.js`
- Create: `tests/helpers/test-clock.js`
- Create: `tests/game-engine.test.js`

**Interfaces:**
- Produces class `GameEngine`.
- Constructor: `new GameEngine({ settings, randomSide, now })`.
- Methods: `startRound(players)`, `openStage()`, `submitMove({ playerId, roundId, stageIndex, inputSeq, side })`, `resolveStage(reason)`, `endRound(reason)`.
- Produces public methods: `publicRoundState()`, `privatePlayerState(playerId)`.
- Emits no network events itself; room manager/gateway call it and publish returned transition objects.

- [ ] **Step 1: Write failing tests for hidden pattern and simultaneous resolution**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/game-engine.js';
const settings={stageCount:2,startingLives:2,decisionMs:8000,revealMs:10,countdownMs:0};

test('public state never exposes unresolved safe side',()=>{
  const engine=new GameEngine({settings,randomSide:()=> 'L',now:()=>1000});
  engine.startRound([{playerId:'p1'}]);
  engine.openStage();
  assert.equal(JSON.stringify(engine.publicRoundState()).includes('"safeSide"'),false);
});

test('stage resolves all submitted players together',()=>{
  const engine=new GameEngine({settings,randomSide:()=> 'L',now:()=>1000});
  engine.startRound([{playerId:'p1'},{playerId:'p2'}]); engine.openStage();
  const id=engine.publicRoundState().roundId;
  assert.equal(engine.submitMove({playerId:'p1',roundId:id,stageIndex:0,inputSeq:1,side:'L'}).ok,true);
  assert.equal(engine.submitMove({playerId:'p2',roundId:id,stageIndex:0,inputSeq:1,side:'R'}).ok,true);
  const reveal=engine.resolveStage('all-submitted');
  assert.equal(reveal.safeSide,'L');
  assert.equal(reveal.outcomes.p1,'safe');
  assert.equal(reveal.outcomes.p2,'broken');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/game-engine.test.js`

Expected: FAIL because `GameEngine` is missing.

- [ ] **Step 3: Implement the state machine minimally**

Implementation must store hidden pattern in a private field, create `roundId` with `crypto.randomUUID()`, track player lives/elimination/submission/inputSeq, reject wrong round/stage/replay/second submission, apply timeout loss for missing submissions, and return reveal payload only from `resolveStage()`.

Core submission shape:

```js
submitMove(input){
  if(!this.#round || this.#round.status!=='stage-open') return {ok:false,code:ERROR_CODES.ROUND_NOT_ACTIVE};
  if(input.roundId!==this.#round.roundId) return {ok:false,code:ERROR_CODES.ROUND_ID_STALE};
  if(input.stageIndex!==this.#round.stageIndex) return {ok:false,code:ERROR_CODES.STAGE_STALE};
  const p=this.#round.players.get(input.playerId);
  if(!p || p.eliminated) return {ok:false,code:ERROR_CODES.PLAYER_ELIMINATED};
  if(input.inputSeq<=p.lastInputSeq) return {ok:false,code:ERROR_CODES.INPUT_REPLAYED};
  if(p.submission) return {ok:false,code:ERROR_CODES.MOVE_ALREADY_SUBMITTED};
  p.lastInputSeq=input.inputSeq;
  p.submission={side:input.side,submittedAt:this.#now()};
  return {ok:true,stageIndex:this.#round.stageIndex};
}
```

- [ ] **Step 4: Add tests for timeout, elimination, ranking, stale input, duplicate input**

Add concrete assertions that a timeout loses one life, zero lives eliminates, stale round/stage fails without changing lives, duplicate effective submission fails, and ranking follows survivor/progress/lives/submission/playerId order.

- [ ] **Step 5: Run engine tests**

Run: `npm test -- tests/game-engine.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/game-engine.js tests/helpers/test-clock.js tests/game-engine.test.js
git commit -m "feat: add authoritative Frostbridge game engine"
```

---

### Task 4: Room Manager, Lobby Rules, Reconnect, and Expiry

**Files:**
- Create: `server/room-manager.js`
- Create: `tests/room-manager.test.js`

**Interfaces:**
- Produces class `RoomManager({ config, now, codeGenerator })`.
- Methods: `createRoom()`, `getRoom(code)`, `joinPlayer(input)`, `restorePlayer(input)`, `setCharacter(input)`, `setReady(input)`, `updateSettings(input)`, `startRound(input)`, `endRound(input)`, `closeRoom(input)`, `markDisconnected(socketId)`, `sweepExpired()`.
- `createRoom()` returns `{ roomCode, hostToken, room }`.
- `joinPlayer()` returns `{ playerId, playerToken, roomSnapshot, privateState }`.
- Public snapshots exclude all token digests and hidden bridge pattern.

- [ ] **Step 1: Write failing room lifecycle tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/room-manager.js';

test('room code is unique and host token restores control',()=>{
  const mgr=new RoomManager({codeGenerator:(()=>{const q=['ABCDE','ABCDE','FGHJK'];return()=>q.shift();})(),now:()=>1000});
  const a=mgr.createRoom(), b=mgr.createRoom();
  assert.equal(a.roomCode,'ABCDE'); assert.equal(b.roomCode,'FGHJK');
  assert.equal(mgr.restoreHost({roomCode:a.roomCode,hostToken:a.hostToken}).ok,true);
});

test('active-round join becomes next-round spectator',()=>{
  const mgr=new RoomManager({now:()=>1000});
  const host=mgr.createRoom();
  const p1=mgr.joinPlayer({roomCode:host.roomCode,name:'Dana',characterId:'dana'});
  mgr.setReady({roomCode:host.roomCode,playerToken:p1.playerToken,ready:true});
  mgr.startRound({roomCode:host.roomCode,hostToken:host.hostToken});
  const late=mgr.joinPlayer({roomCode:host.roomCode,name:'Rami',characterId:'rami'});
  assert.equal(late.privateState.roundEligible,false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/room-manager.test.js`

Expected: FAIL because room manager is missing.

- [ ] **Step 3: Implement room creation/join/restore/lobby mutation**

Use `createCredential()` for host/player credentials. Store only digests. Normalize codes through validators. Enforce `maxPlayers=6`. During active round, new players get `roundEligible:false`; when round returns to lobby, all non-expired players become eligible and ready resets to false.

- [ ] **Step 4: Implement disconnect/reconnect and expiry semantics**

A disconnected active player retains slot and remains part of `aliveParticipantIds`, so early close checks `submittedCount === aliveParticipantCount`, not merely connected count. `sweepExpired()` removes expired lobby players and closes rooms at inactivity/hard-lifetime limits.

- [ ] **Step 5: Add tests for full room, 90-second restore, expired restore, early-close fairness, and room expiry**

Use a mutable `now` variable so tests advance time deterministically without sleeping.

- [ ] **Step 6: Run room tests**

Run: `npm test -- tests/room-manager.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/room-manager.js tests/room-manager.test.js
git commit -m "feat: add Frostbridge room lifecycle"
```

---

### Task 5: Express App and Socket.IO Gateway

**Files:**
- Create: `server/logger.js`
- Create: `server/socket-gateway.js`
- Create: `server/app.js`
- Create: `tests/helpers/socket-client.js`
- Create: `tests/protocol.test.js`

**Interfaces:**
- `createApp({ roomManager, config })` returns `{ httpServer, io, start(port), stop() }`.
- Socket acknowledgements use `{ ok:true, ...data }` or `{ ok:false, code }`.
- `room:snapshot` is public; `player:private-state` only goes to that player's socket; host private data only returns through authenticated acknowledgements.

- [ ] **Step 1: Write failing HTTP/protocol tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('health and readiness endpoints answer 200', async t => {
  const app=createApp(); const port=await app.start(0); t.after(()=>app.stop());
  const h=await fetch(`http://127.0.0.1:${port}/healthz`);
  const r=await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(h.status,200); assert.equal(r.status,200);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/protocol.test.js`

Expected: FAIL because app/gateway do not exist.

- [ ] **Step 3: Implement Express composition and health routes**

`server/app.js` must create an HTTP server, attach Socket.IO, serve `public/` at `/`, serve `/assets` from existing `assets/`, and start a room sweeper interval. `start(0)` returns the actual ephemeral port.

- [ ] **Step 4: Implement every socket event from the spec**

For each event, validate `protocolVersion`, delegate mutation/authentication to `RoomManager`, acknowledge with stable result, and publish only approved public/private events. `player:move` must never broadcast the submitted side; before reveal it only broadcasts `stage:submission-count`.

Representative handler:

```js
socket.on(EVENTS.PLAYER_MOVE,(payload,ack)=>{
  const result=roomManager.submitMove(payload);
  ack(result);
  if(!result.ok) return;
  io.to(`room:${result.roomCode}`).emit(EVENTS.STAGE_SUBMISSION_COUNT,{protocolVersion:PROTOCOL_VERSION,stageIndex:result.stageIndex,submittedCount:result.submittedCount,aliveCount:result.aliveCount});
});
```

- [ ] **Step 5: Add protocol tests for unsupported version, host auth failure, player auth failure, and no side leakage**

Tests must inspect emitted JSON and assert unresolved payloads contain neither `safeSide` nor any player's chosen `side`.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/protocol.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/logger.js server/socket-gateway.js server/app.js tests/helpers/socket-client.js tests/protocol.test.js
git commit -m "feat: expose Frostbridge realtime server"
```

---

### Task 6: Host, TV, and Player Browser Surfaces

**Files:**
- Move/Copy: root `index.html` → `public/index.html`
- Create: `public/shared/socket.js`
- Create: `public/shared/ui.css`
- Create: `public/host/index.html`
- Create: `public/host/host.js`
- Create: `public/tv/index.html`
- Create: `public/tv/tv.js`
- Create: `public/play/index.html`
- Create: `public/play/play.js`
- Modify: `README.md`

**Interfaces:**
- `public/shared/socket.js` exports `connectSocket()`, `emitAck(event,payload)`, `getProtocolVersion()`.
- Host stores host token under `localStorage['frostbridge:host:<room>']`.
- Player stores token under `localStorage['frostbridge:player:<room>']`.
- TV stores no token.

- [ ] **Step 1: Preserve the current landing/demo under `public/index.html`**

Update asset paths only as required by the new static root. Confirm `/` still opens the standalone visual demo.

- [ ] **Step 2: Build shared browser socket helper**

```js
export const PROTOCOL_VERSION=1;
export const socket=io({autoConnect:true});
export function emitAck(event,payload={}){
  return new Promise(resolve=>socket.emit(event,{protocolVersion:PROTOCOL_VERSION,...payload},resolve));
}
```

- [ ] **Step 3: Build `/host`**

Host page must create/restore room, display room code and join URL, show roster/readiness/connection/lives, expose pre-round settings, start/end/close controls, and render current stage/submission counts. Disable controls when unauthenticated or invalid for current room state.

- [ ] **Step 4: Build `/tv`**

TV page reads `room` from query string, calls `tv:watch`, renders lobby roster, countdown, bridge stage, submitted-lock indicators, reveal outcomes, lives/eliminations, and final ranking. It must never expose an input control or token storage.

- [ ] **Step 5: Build `/play`**

Player page supports room/name/character join, ready toggle, automatic token restore, large LEFT/RIGHT controls while stage is open, locked state after acknowledgement, reveal outcome, lives/elimination, and final placement. Buttons must be disabled after accepted submission and on stale/closed stages.

- [ ] **Step 6: Manually smoke static routes through the server**

Run: `npm start`

Verify HTTP 200 for `/`, `/host/`, `/tv/?room=ABCDE`, `/play/`, and `/assets/characters/dana.svg`.

- [ ] **Step 7: Commit**

```bash
git add public README.md
git commit -m "feat: add Frostbridge host tv and phone surfaces"
```

---

### Task 7: Real Multi-Client Integration Test

**Files:**
- Create: `tests/multiplayer.integration.test.js`

**Interfaces:**
- Uses real `createApp()` and real `socket.io-client` clients.
- No mocked Socket.IO transport.
- Test controls settings with short countdown/reveal/decision durations to keep CI fast while preserving state order.

- [ ] **Step 1: Write the failing end-to-end test skeleton**

The test must:

```js
const app=createApp({ testConfig:{ countdownMs:10,revealMs:10,decisionMs:200 } });
const port=await app.start(0);
const host=await connectTestClient(port);
const tv=await connectTestClient(port);
const p1=await connectTestClient(port);
const p2=await connectTestClient(port);
const p3=await connectTestClient(port);
```

Then create room, join three players, attach TV, ready players, start round, submit moves, and await reveal.

- [ ] **Step 2: Run and verify at least one missing-flow failure before completing helper behavior**

Run: `npm test -- tests/multiplayer.integration.test.js`

Expected: FAIL until all required event sequencing and helper waits are implemented.

- [ ] **Step 3: Assert secrecy and idempotency**

Before reveal, serialize every host/TV/player public event and assert it contains neither `safeSide` nor submitted `side`. Submit a duplicate move and a stale `stageIndex` and assert `MOVE_ALREADY_SUBMITTED` / `STAGE_STALE` without state mutation.

- [ ] **Step 4: Assert reconnect restoration**

Disconnect p2 after one resolved stage, reconnect a fresh Socket.IO client, call `player:restore` with its room/token, and assert the same `playerId`, lives, character, elimination state, and round position are restored.

- [ ] **Step 5: Assert active-round late join is spectator-only**

Join p4 while round is active, assert `roundEligible:false`, and assert `player:move` is rejected for the current round.

- [ ] **Step 6: Complete/end round and verify ranking**

Drive remaining stages or use authenticated host end-round path, then assert `round:finished` ranking is deterministic and the room returns to a reusable post-round/lobby state with readiness reset.

- [ ] **Step 7: Run full Node test suite**

Run: `npm test`

Expected: all unit/protocol/integration tests PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/multiplayer.integration.test.js
git commit -m "test: verify Frostbridge multiplayer end to end"
```

---

### Task 8: Extend Preflight, CI, Packaging, and Production Documentation

**Files:**
- Modify: `scripts/preflight.py`
- Modify: `.github/workflows/main.yml`
- Modify: `PRE-FLIGHT.md`
- Modify: `README.md`
- Create: `.gitignore`

**Interfaces:**
- `npm test` is the authoritative multiplayer test command.
- `python scripts/preflight.py` remains the static/repository gate.
- CI artifact contains production server, public surfaces, assets, lockfile, README, and excludes tests/node_modules.

- [ ] **Step 1: Extend Python preflight required-file validation**

Add `package.json`, `package-lock.json`, server modules, public host/tv/play/shared files, and integration test to `REQUIRED_FILES`. Keep existing SVG validation and private-monorepo dependency rejection.

- [ ] **Step 2: Extend preflight HTTP smoke to launch the Node server**

Instead of only `python -m http.server`, launch `node server/app.js` with `PORT` assigned from a free local port and verify `/healthz`, `/readyz`, `/`, `/host/`, `/tv/`, `/play/` all return expected content.

- [ ] **Step 3: Update GitHub Actions to install from lockfile and run all gates**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
- run: npm ci
- run: npm test
- run: python scripts/preflight.py
```

Keep Python 3.12 setup. Package only after both test and preflight steps succeed.

- [ ] **Step 4: Build deployable artifact**

Artifact staging must include:

```text
package.json
package-lock.json
server/
public/
assets/
README.md
PRE-FLIGHT.md
```

Do not include `.git`, `node_modules`, tests, private tokens, or local environment files.

- [ ] **Step 5: Update documentation**

README must document:

```bash
npm ci
npm start
# Host: http://localhost:3000/host/
# TV:   http://localhost:3000/tv/?room=ABCDE
# Play: http://localhost:3000/play/
```

Document `PORT`, `MAX_ROOMS`, single-process limitation, WebSocket reverse-proxy requirement, and that horizontal scale requires shared state/pub-sub first.

- [ ] **Step 6: Run complete local gate**

Run: `npm ci && npm test && python scripts/preflight.py`

Expected: PASS.

- [ ] **Step 7: Push branch and open production PR**

PR body must list architecture, security boundary, test coverage, deployment boundary, and explicit deferred features.

- [ ] **Step 8: Verify GitHub Actions and artifact before merge**

Do not merge until the PR run shows unit tests, multi-client integration, preflight, package creation, and artifact upload all successful.

- [ ] **Step 9: Commit**

```bash
git add .github/workflows/main.yml scripts/preflight.py PRE-FLIGHT.md README.md .gitignore
git commit -m "ci: gate Frostbridge multiplayer production build"
```

---

## Plan Self-Review Results

- **Spec coverage:** room lifecycle, host/player authentication, hidden pattern, simultaneous decisions, timeout behavior, late joins, reconnect, deterministic ranking, room expiry, three browser surfaces, health/readiness, protocol errors, CI, artifact packaging, and single-process deployment are all mapped to tasks above.
- **Deferred scope preserved:** accounts, database, matchmaking, analytics, character abilities, native clients, alternate modes, and horizontal scaling remain outside this plan.
- **Type/interface consistency:** `RoomManager`, `GameEngine`, protocol constants, acknowledgement shape, session helpers, and browser protocol version are named consistently across dependent tasks.
- **Placeholder scan:** no TBD/TODO/"implement later" steps remain; each task includes concrete files, interfaces, test commands, and acceptance behavior.
