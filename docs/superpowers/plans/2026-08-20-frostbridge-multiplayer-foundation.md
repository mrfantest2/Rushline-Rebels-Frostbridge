# Frostbridge Multiplayer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production multiplayer Frostbridge milestone: one host-authoritative Node.js server, room-code joining, synchronized TV/player/host surfaces, reconnect restoration, simultaneous hidden LEFT/RIGHT decisions, and a CI gate that proves the full flow.

**Architecture:** A single Node.js 22 process runs Express and Socket.IO. The server owns rooms, hidden bridge patterns, round/stage timers, player lives, ranking, authentication tokens, and all state transitions; browser clients only render state and submit intent. Room state remains in memory and the milestone is intentionally single-process.

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
- Duplicate, stale, replayed, or unauthenticated inputs never mutate state.
- Players joining during an active round are spectator-only until the room returns to lobby.
- A disconnected alive player prevents early stage close until that player submits after reconnect or the deadline expires.
- Passing CI is required before merge to `main`.

---

## Planned File Structure

```text
package.json
package-lock.json
server/
  app.js
  config.js
  protocol.js
  validators.js
  session-manager.js
  game-engine.js
  room-manager.js
  socket-gateway.js
  logger.js
public/
  index.html
  host/index.html
  host/host.js
  tv/index.html
  tv/tv.js
  play/index.html
  play/play.js
  shared/socket.js
  shared/ui.css
assets/
  characters/
  mockups/
tests/
  helpers/test-clock.js
  helpers/socket-client.js
  validators.test.js
  session-manager.test.js
  game-engine.test.js
  room-manager.test.js
  protocol.test.js
  multiplayer.integration.test.js
scripts/preflight.py
.github/workflows/main.yml
README.md
PRE-FLIGHT.md
.gitignore
```

---

### Task 1: Runtime, Protocol Constants, Validation, and Test Harness

**Files:**
- Create: `package.json`
- Create: `server/config.js`
- Create: `server/protocol.js`
- Create: `server/validators.js`
- Create: `tests/validators.test.js`
- Create after install: `package-lock.json`

**Interfaces:**
- Produces `PROTOCOL_VERSION`, `EVENTS`, `ERROR_CODES`, `CHARACTER_IDS`, `DEFAULT_SETTINGS`.
- Produces `validateRoomCode(value)`, `validateDisplayName(value)`, `validateCharacterId(value)`, `validateMovePayload(value)`, `validateSettingsPatch(value)` returning `{ ok:true, value }` or `{ ok:false, code }`.

- [ ] **Step 1: Write failing validator tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDisplayName, validateCharacterId, validateMovePayload } from '../server/validators.js';

test('display name is trimmed and constrained', () => {
  assert.deepEqual(validateDisplayName('  Dana  '), { ok:true, value:'Dana' });
  assert.equal(validateDisplayName('').ok, false);
  assert.equal(validateDisplayName('x'.repeat(33)).ok, false);
});

test('character id accepts only canonical rebels', () => {
  assert.deepEqual(validateCharacterId('dana'), { ok:true, value:'dana' });
  assert.equal(validateCharacterId('layla').ok, false);
});

test('move payload constrains round, stage, sequence, and side', () => {
  assert.equal(validateMovePayload({roundId:'r1',stageIndex:2,inputSeq:7,side:'L'}).ok, true);
  assert.equal(validateMovePayload({roundId:'r1',stageIndex:2,inputSeq:7,side:'X'}).ok, false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/validators.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Add the Node manifest and protocol/config exports**

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
export const PROTOCOL_VERSION=1;
export const CHARACTER_IDS=Object.freeze(['nadir','zayd','jolyne','dana','sami','rami']);
export const ERROR_CODES=Object.freeze({
  ROOM_NOT_FOUND:'ROOM_NOT_FOUND',ROOM_FULL:'ROOM_FULL',ROOM_CLOSED:'ROOM_CLOSED',
  HOST_AUTH_FAILED:'HOST_AUTH_FAILED',PLAYER_AUTH_FAILED:'PLAYER_AUTH_FAILED',
  PLAYER_NAME_INVALID:'PLAYER_NAME_INVALID',CHARACTER_INVALID:'CHARACTER_INVALID',
  ROUND_NOT_ACTIVE:'ROUND_NOT_ACTIVE',ROUND_ID_STALE:'ROUND_ID_STALE',STAGE_STALE:'STAGE_STALE',
  STAGE_CLOSED:'STAGE_CLOSED',PLAYER_ELIMINATED:'PLAYER_ELIMINATED',
  MOVE_ALREADY_SUBMITTED:'MOVE_ALREADY_SUBMITTED',INPUT_REPLAYED:'INPUT_REPLAYED',
  PROTOCOL_VERSION_UNSUPPORTED:'PROTOCOL_VERSION_UNSUPPORTED',SETTINGS_INVALID:'SETTINGS_INVALID'
});
export const EVENTS=Object.freeze({
  HOST_CREATE_ROOM:'host:create-room',HOST_RESTORE:'host:restore',HOST_UPDATE_SETTINGS:'host:update-settings',
  HOST_START_ROUND:'host:start-round',HOST_END_ROUND:'host:end-round',HOST_CLOSE_ROOM:'host:close-room',
  TV_WATCH:'tv:watch',PLAYER_JOIN:'player:join',PLAYER_RESTORE:'player:restore',
  PLAYER_SET_CHARACTER:'player:set-character',PLAYER_SET_READY:'player:set-ready',PLAYER_MOVE:'player:move',
  ROOM_SNAPSHOT:'room:snapshot',ROOM_CLOSED:'room:closed',PLAYER_PRIVATE_STATE:'player:private-state',
  ROUND_COUNTDOWN:'round:countdown',STAGE_OPEN:'stage:open',STAGE_SUBMISSION_COUNT:'stage:submission-count',
  STAGE_REVEAL:'stage:reveal',ROUND_FINISHED:'round:finished',SERVER_ERROR:'server:error'
});
```

```js
// server/config.js
export const DEFAULT_SETTINGS=Object.freeze({maxPlayers:6,stageCount:10,startingLives:3,decisionMs:8000,revealMs:1800,countdownMs:3000});
export const CONFIG=Object.freeze({
  port:Number(process.env.PORT||3000),maxRooms:Number(process.env.MAX_ROOMS||100),
  reconnectGraceMs:90_000,inactiveExpiryMs:30*60_000,hardRoomLifetimeMs:4*60*60_000
});
```

- [ ] **Step 4: Implement validators**

```js
import { CHARACTER_IDS, ERROR_CODES } from './protocol.js';
import { DEFAULT_SETTINGS } from './config.js';
const ok=value=>({ok:true,value});
const bad=code=>({ok:false,code});
export function validateDisplayName(v){if(typeof v!=='string')return bad(ERROR_CODES.PLAYER_NAME_INVALID);const x=v.trim();return x.length>=1&&x.length<=32?ok(x):bad(ERROR_CODES.PLAYER_NAME_INVALID);}
export function validateCharacterId(v){return CHARACTER_IDS.includes(v)?ok(v):bad(ERROR_CODES.CHARACTER_INVALID);}
export function validateRoomCode(v){const x=String(v||'').trim().toUpperCase();return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(x)?ok(x):bad(ERROR_CODES.ROOM_NOT_FOUND);}
export function validateMovePayload(v){if(!v||typeof v.roundId!=='string'||!Number.isInteger(v.stageIndex)||v.stageIndex<0||!Number.isSafeInteger(v.inputSeq)||v.inputSeq<0||!['L','R'].includes(v.side))return bad(ERROR_CODES.STAGE_STALE);return ok({roundId:v.roundId,stageIndex:v.stageIndex,inputSeq:v.inputSeq,side:v.side});}
export function validateSettingsPatch(v){
  if(!v||typeof v!=='object')return bad(ERROR_CODES.SETTINGS_INVALID);
  const x={...DEFAULT_SETTINGS,...v};
  const valid=Number.isInteger(x.maxPlayers)&&x.maxPlayers>=1&&x.maxPlayers<=6&&Number.isInteger(x.stageCount)&&x.stageCount>=1&&x.stageCount<=30&&Number.isInteger(x.startingLives)&&x.startingLives>=1&&x.startingLives<=9&&Number.isInteger(x.decisionMs)&&x.decisionMs>=2000&&x.decisionMs<=30000&&Number.isInteger(x.revealMs)&&x.revealMs>=250&&x.revealMs<=10000&&Number.isInteger(x.countdownMs)&&x.countdownMs>=0&&x.countdownMs<=10000;
  return valid?ok(x):bad(ERROR_CODES.SETTINGS_INVALID);
}
```

- [ ] **Step 5: Install and run tests**

Run: `npm install && npm test -- tests/validators.test.js`

Expected: PASS and lockfile generated.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/config.js server/protocol.js server/validators.js tests/validators.test.js
git commit -m "feat: establish Frostbridge multiplayer protocol"
```

---

### Task 2: Session Credentials

**Files:**
- Create: `server/session-manager.js`
- Create: `tests/session-manager.test.js`

**Interfaces:**
- `issueToken()` → raw string.
- `hashToken(rawToken)` → SHA-256 hex.
- `verifyToken(rawToken, expectedDigest)` → boolean.
- `createCredential()` → `{ token, digest }`.

- [ ] **Step 1: Write failing credential tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredential, verifyToken } from '../server/session-manager.js';
test('credential verifies only its own token',()=>{const a=createCredential(),b=createCredential();assert.notEqual(a.token,b.token);assert.equal(verifyToken(a.token,a.digest),true);assert.equal(verifyToken(b.token,a.digest),false);});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/session-manager.test.js`

Expected: FAIL because module is absent.

- [ ] **Step 3: Implement secure token helpers**

```js
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const issueToken=()=>randomBytes(32).toString('base64url');
export const hashToken=t=>createHash('sha256').update(t).digest('hex');
export function verifyToken(raw,digest){if(typeof raw!=='string'||typeof digest!=='string')return false;const a=Buffer.from(hashToken(raw),'hex'),b=Buffer.from(digest,'hex');return a.length===b.length&&timingSafeEqual(a,b);}
export function createCredential(){const token=issueToken();return {token,digest:hashToken(token)};}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/session-manager.test.js`

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
- Class `GameEngine`.
- Constructor: `new GameEngine({ settings, randomSide, now })`.
- Methods: `startRound(players)`, `openStage()`, `submitMove(input)`, `resolveStage(reason)`, `endRound(reason)`, `publicRoundState()`, `privatePlayerState(playerId)`.
- Engine never emits network events and never exposes unresolved hidden pattern.

- [ ] **Step 1: Write failing secrecy and resolution tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/game-engine.js';
const settings={stageCount:2,startingLives:2,decisionMs:8000,revealMs:10,countdownMs:0};
test('public state hides unresolved safe side',()=>{const e=new GameEngine({settings,randomSide:()=> 'L',now:()=>1000});e.startRound([{playerId:'p1'}]);e.openStage();assert.equal(JSON.stringify(e.publicRoundState()).includes('safeSide'),false);});
test('resolution applies all submitted choices together',()=>{const e=new GameEngine({settings,randomSide:()=> 'L',now:()=>1000});e.startRound([{playerId:'p1'},{playerId:'p2'}]);e.openStage();const id=e.publicRoundState().roundId;e.submitMove({playerId:'p1',roundId:id,stageIndex:0,inputSeq:1,side:'L'});e.submitMove({playerId:'p2',roundId:id,stageIndex:0,inputSeq:1,side:'R'});const x=e.resolveStage('all-submitted');assert.equal(x.safeSide,'L');assert.equal(x.outcomes.p1,'safe');assert.equal(x.outcomes.p2,'broken');});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/game-engine.test.js`

- [ ] **Step 3: Implement state machine and input guards**

`submitMove()` must use this rejection order: inactive round → stale round → stale stage → missing/eliminated player → replayed sequence → already-submitted move. A successful move stores only server-private choice state.

```js
submitMove(input){
  if(!this.#round||this.#round.status!=='stage-open')return {ok:false,code:ERROR_CODES.ROUND_NOT_ACTIVE};
  if(input.roundId!==this.#round.roundId)return {ok:false,code:ERROR_CODES.ROUND_ID_STALE};
  if(input.stageIndex!==this.#round.stageIndex)return {ok:false,code:ERROR_CODES.STAGE_STALE};
  const p=this.#round.players.get(input.playerId);
  if(!p||p.eliminated)return {ok:false,code:ERROR_CODES.PLAYER_ELIMINATED};
  if(input.inputSeq<=p.lastInputSeq)return {ok:false,code:ERROR_CODES.INPUT_REPLAYED};
  if(p.submission)return {ok:false,code:ERROR_CODES.MOVE_ALREADY_SUBMITTED};
  p.lastInputSeq=input.inputSeq;p.submission={side:input.side,submittedAt:this.#now()};
  return {ok:true,stageIndex:this.#round.stageIndex};
}
```

- [ ] **Step 4: Add timeout, elimination, ranking, stale-input, duplicate-input tests**

Assertions must prove timeout loses one life, zero lives eliminates, rejected inputs do not mutate lives/progress, and ranking follows survivor → progress → lives → final-success timestamp → stable playerId.

- [ ] **Step 5: Run and commit**

Run: `npm test -- tests/game-engine.test.js`

```bash
git add server/game-engine.js tests/helpers/test-clock.js tests/game-engine.test.js
git commit -m "feat: add authoritative Frostbridge game engine"
```

---

### Task 4: Room Manager, Lobby, Reconnect, and Expiry

**Files:**
- Create: `server/room-manager.js`
- Create: `tests/room-manager.test.js`

**Interfaces:**
- Class `RoomManager({ config, now, codeGenerator, randomSide })`.
- Methods: `createRoom()`, `getRoom(code)`, `restoreHost(input)`, `joinPlayer(input)`, `restorePlayer(input)`, `setCharacter(input)`, `setReady(input)`, `updateSettings(input)`, `startRound(input)`, `submitMove(input)`, `endRound(input)`, `closeRoom(input)`, `markDisconnected(socketId)`, `sweepExpired()`.
- `createRoom()` → `{ roomCode, hostToken, roomSnapshot }`.
- `joinPlayer()` → `{ playerId, playerToken, roomSnapshot, privateState }`.
- Public snapshots exclude token digests, raw tokens, private submissions, and hidden pattern.

- [ ] **Step 1: Write failing room lifecycle tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/room-manager.js';
test('code collision retries and host token restores',()=>{const q=['ABCDE','ABCDE','FGHJK'];const m=new RoomManager({codeGenerator:()=>q.shift(),now:()=>1000});const a=m.createRoom(),b=m.createRoom();assert.equal(a.roomCode,'ABCDE');assert.equal(b.roomCode,'FGHJK');assert.equal(m.restoreHost({roomCode:a.roomCode,hostToken:a.hostToken}).ok,true);});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/room-manager.test.js`

- [ ] **Step 3: Implement creation, join, auth, readiness, settings, and active-round spectator rule**

Use `createCredential()` and store only digests. Enforce 6-player capacity. Joining while status is not lobby sets `roundEligible:false`; eligibility resets after return to lobby.

- [ ] **Step 4: Implement `submitMove()` delegation and early-close accounting**

`RoomManager.submitMove()` authenticates the player token, validates payload, calls `GameEngine.submitMove()`, and returns `{ok,roomCode,stageIndex,submittedCount,aliveCount,shouldResolve}`. `aliveCount` includes disconnected alive participants, so their absence cannot trigger early reveal.

- [ ] **Step 5: Implement disconnect/restore and expiry**

Retain disconnected active players for 90 seconds; lobby-expired slots are removed. Active expired players remain deterministic round participants but cannot submit future moves. Sweep inactive rooms at 30 minutes and hard-close at 4 hours.

- [ ] **Step 6: Add full-room, reconnect, expired restore, late join, early-close fairness, and room-expiry tests**

Use a mutable injected clock rather than real sleeping.

- [ ] **Step 7: Run and commit**

Run: `npm test -- tests/room-manager.test.js`

```bash
git add server/room-manager.js tests/room-manager.test.js
git commit -m "feat: add Frostbridge room lifecycle"
```

---

### Task 5: Express Application and Socket Gateway

**Files:**
- Create: `server/logger.js`
- Create: `server/socket-gateway.js`
- Create: `server/app.js`
- Create: `tests/helpers/socket-client.js`
- Create: `tests/protocol.test.js`

**Interfaces:**
- `createApp({ roomManager, configOverrides } = {})` → `{ httpServer, io, start(port), stop() }`.
- `start(0)` resolves to actual ephemeral port.
- Ack shape is `{ok:true,...}` or `{ok:false,code}`.
- Public `room:snapshot` contains no secrets; `player:private-state` is sent only to that player's socket.

- [ ] **Step 1: Write failing HTTP/protocol test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
test('health and ready answer 200',async t=>{const app=createApp();const port=await app.start(0);t.after(()=>app.stop());assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status,200);assert.equal((await fetch(`http://127.0.0.1:${port}/readyz`)).status,200);});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/protocol.test.js`

- [ ] **Step 3: Implement HTTP composition**

Serve `public/` at `/`, `assets/` at `/assets`, attach Socket.IO, expose `/healthz` and `/readyz`, and run the room sweeper interval. Logger must redact keys matching `/token|secret|authorization/i`.

- [ ] **Step 4: Implement every protocol event**

Each event validates `protocolVersion`, delegates auth/mutation to RoomManager, acknowledges with the stable result, and emits only approved state. `player:move` broadcasts only counts until reveal.

```js
socket.on(EVENTS.PLAYER_MOVE,(payload,ack)=>{
  const result=roomManager.submitMove(payload);
  ack(result);
  if(!result.ok)return;
  io.to(`room:${result.roomCode}`).emit(EVENTS.STAGE_SUBMISSION_COUNT,{protocolVersion:PROTOCOL_VERSION,stageIndex:result.stageIndex,submittedCount:result.submittedCount,aliveCount:result.aliveCount});
});
```

- [ ] **Step 5: Add tests for unsupported version, host/player auth failure, stale move, and no pre-reveal leakage**

Serialize emitted payloads and assert neither `safeSide` nor a player's submitted `side` appears before `stage:reveal`.

- [ ] **Step 6: Run and commit**

Run: `npm test -- tests/protocol.test.js`

```bash
git add server/logger.js server/socket-gateway.js server/app.js tests/helpers/socket-client.js tests/protocol.test.js
git commit -m "feat: expose Frostbridge realtime server"
```

---

### Task 6: Host, TV, and Player Browser Surfaces

**Files:**
- Copy root `index.html` to: `public/index.html`
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
- `public/shared/socket.js`: `PROTOCOL_VERSION`, `socket`, `emitAck(event,payload)`.
- Host token storage key: `frostbridge:host:<room>`.
- Player token storage key: `frostbridge:player:<room>`.
- TV stores no credential.

- [ ] **Step 1: Preserve current demo under `public/index.html`**

Adjust asset paths so `/` remains functional when served by Express.

- [ ] **Step 2: Build shared socket helper**

```js
export const PROTOCOL_VERSION=1;
export const socket=io({autoConnect:true});
export function emitAck(event,payload={}){return new Promise(resolve=>socket.emit(event,{protocolVersion:PROTOCOL_VERSION,...payload},resolve));}
```

- [ ] **Step 3: Build `/host`**

Implement create/restore, room code/join URL, roster/readiness/connection/lives, pre-round settings, start/end/close, stage/deadline/submission count. Disable controls when unauthorized or invalid for current state.

- [ ] **Step 4: Build `/tv`**

Read `room` query parameter, call `tv:watch`, render lobby, countdown, bridge, submitted-lock indicators, reveal outcomes, lives/eliminations, ranking. Do not store or request host/player tokens.

- [ ] **Step 5: Build `/play`**

Implement code/name/character join, ready, automatic restore, LEFT/RIGHT controller, locked state after accepted move, reveal outcome, lives/elimination, final placement. Disable both choice buttons immediately after accepted ack.

- [ ] **Step 6: Smoke routes**

Run `npm start`; verify HTTP 200 for `/`, `/host/`, `/tv/?room=ABCDE`, `/play/`, `/assets/characters/dana.svg`.

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
- Uses real `createApp({ configOverrides })` and real `socket.io-client` connections.
- No mocked transport.

- [ ] **Step 1: Write failing integration skeleton**

```js
const app=createApp({configOverrides:{countdownMs:10,revealMs:10,decisionMs:200}});
const port=await app.start(0);
const host=await connectTestClient(port),tv=await connectTestClient(port),p1=await connectTestClient(port),p2=await connectTestClient(port),p3=await connectTestClient(port);
```

Then create room, join players, watch TV, ready, start, submit, and await reveal.

- [ ] **Step 2: Run and verify missing-flow failure**

Run: `npm test -- tests/multiplayer.integration.test.js`

- [ ] **Step 3: Assert secrecy and idempotency**

Before reveal, every public event must omit `safeSide` and submitted side. Duplicate and stale moves must return `MOVE_ALREADY_SUBMITTED` and `STAGE_STALE` with no mutation.

- [ ] **Step 4: Assert reconnect**

Disconnect p2, connect a fresh client, call `player:restore`, and assert same `playerId`, character, lives, elimination state, and current round position.

- [ ] **Step 5: Assert active-round late join**

Join p4 during active play, assert `roundEligible:false`, and assert current-round move is rejected.

- [ ] **Step 6: Finish/end and verify deterministic ranking plus readiness reset**

Assert `round:finished`, deterministic order, post-round room reuse, and all existing players reset to not-ready.

- [ ] **Step 7: Run full suite and commit**

Run: `npm test`

```bash
git add tests/multiplayer.integration.test.js
git commit -m "test: verify Frostbridge multiplayer end to end"
```

---

### Task 8: Preflight, CI, Packaging, and Documentation

**Files:**
- Modify: `scripts/preflight.py`
- Modify: `.github/workflows/main.yml`
- Modify: `PRE-FLIGHT.md`
- Modify: `README.md`
- Create: `.gitignore`

**Interfaces:**
- `npm test` is the multiplayer test gate.
- `python scripts/preflight.py` remains static/repository/runtime smoke gate.
- CI artifact contains only deployable runtime/docs/assets.

- [ ] **Step 1: Extend required-file validation**

Require package/lockfile, all server modules, all public surfaces/shared files, and the multi-client integration test while preserving SVG validation and private-monorepo dependency rejection.

- [ ] **Step 2: Change runtime smoke to the real Node server**

Launch `node server/app.js` on a free port and verify `/healthz`, `/readyz`, `/`, `/host/`, `/tv/`, `/play/`.

- [ ] **Step 3: Update GitHub Actions**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
- run: npm ci
- run: npm test
- run: python scripts/preflight.py
```

Keep Python 3.12. Package only after both gates pass.

- [ ] **Step 4: Build deployable artifact**

Include `package.json`, `package-lock.json`, `server/`, `public/`, `assets/`, `README.md`, `PRE-FLIGHT.md`. Exclude `.git`, `node_modules`, tests, environment files, and credentials.

- [ ] **Step 5: Update documentation**

```bash
npm ci
npm start
# Host: http://localhost:3000/host/
# TV:   http://localhost:3000/tv/?room=ABCDE
# Play: http://localhost:3000/play/
```

Document `PORT`, `MAX_ROOMS`, single-process limitation, reverse-proxy WebSocket requirement, and shared-state/pub-sub requirement before horizontal scaling.

- [ ] **Step 6: Run complete gate**

Run: `npm ci && npm test && python scripts/preflight.py`

Expected: PASS.

- [ ] **Step 7: Open production PR**

PR body lists architecture, security boundary, test coverage, deployment boundary, and deferred features.

- [ ] **Step 8: Verify Actions and artifact before merge**

Do not merge until unit tests, multi-client integration, preflight, package creation, and artifact upload all succeed.

- [ ] **Step 9: Commit**

```bash
git add .github/workflows/main.yml scripts/preflight.py PRE-FLIGHT.md README.md .gitignore
git commit -m "ci: gate Frostbridge multiplayer production build"
```

---

## Plan Self-Review Results

- **Spec coverage:** room lifecycle, authentication, hidden pattern, simultaneous decisions, timeouts, late joins, reconnect, ranking, expiry, three browser surfaces, health/readiness, protocol errors, CI, packaging, and single-process deployment are mapped to concrete tasks.
- **Deferred scope preserved:** accounts, database, matchmaking, analytics, character abilities, native clients, alternate modes, and horizontal scaling remain outside this plan.
- **Interface consistency:** `RoomManager.restoreHost()`, `RoomManager.submitMove()`, `GameEngine`, `createApp({ configOverrides })`, protocol constants, acknowledgement shape, session helpers, and browser protocol version are declared before use and named consistently.
- **Placeholder scan:** clean; every task contains concrete files, interfaces, commands, and acceptance behavior.
