import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { EVENTS, PROTOCOL_VERSION } from '../server/protocol.js';
import { connectTestClient, emitAck } from './helpers/socket-client.js';

const p = (extra = {}) => ({ protocolVersion: PROTOCOL_VERSION, ...extra });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('diagnostic: three ready players reach stage-open on watched TV room', async (t) => {
  const app = createApp({ configOverrides: { countdownMs: 10, revealMs: 10, decisionMs: 200, stageCount: 2, startingLives: 3 } });
  const port = await app.start(0);
  t.after(async () => app.stop());
  const host = await connectTestClient(port);
  const tv = await connectTestClient(port);
  const players = await Promise.all([connectTestClient(port), connectTestClient(port), connectTestClient(port)]);
  t.after(() => [host, tv, ...players].forEach((s) => s.close()));

  const seen = [];
  tv.onAny((event, payload) => seen.push({ event, payload }));
  const room = await emitAck(host, EVENTS.HOST_CREATE_ROOM, p());
  assert.equal(room.ok, true);
  assert.deepEqual(room.roomSnapshot.settings, { maxPlayers: 6, stageCount: 2, startingLives: 3, decisionMs: 200, revealMs: 10, countdownMs: 10 });
  assert.equal((await emitAck(tv, EVENTS.TV_WATCH, p({ roomCode: room.roomCode }))).ok, true);

  const joined = [];
  for (let i = 0; i < players.length; i += 1) {
    const j = await emitAck(players[i], EVENTS.PLAYER_JOIN, p({ roomCode: room.roomCode, displayName: `P${i}`, characterId: 'dana' }));
    assert.equal(j.ok, true);
    joined.push(j);
    assert.equal((await emitAck(players[i], EVENTS.PLAYER_SET_READY, p({ roomCode: room.roomCode, playerToken: j.playerToken, ready: true }))).ok, true);
  }

  const start = await emitAck(host, EVENTS.HOST_START_ROUND, p({ roomCode: room.roomCode, hostToken: room.hostToken }));
  assert.equal(start.ok, true);
  assert.equal(start.roomSnapshot.settings.countdownMs, 10);
  await sleep(80);

  const snapshot = app.roomManager.roomSnapshot(room.roomCode);
  const events = seen.map((item) => item.event);
  assert.equal(snapshot.status, 'stage-open', `status=${snapshot.status}; settings=${JSON.stringify(snapshot.settings)}; events=${JSON.stringify(events)}`);
  assert.ok(events.includes(EVENTS.ROUND_COUNTDOWN), `missing countdown; events=${JSON.stringify(events)}`);
  assert.ok(events.includes(EVENTS.STAGE_OPEN), `missing stage-open; status=${snapshot.status}; events=${JSON.stringify(events)}`);
});
