import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { ERROR_CODES, EVENTS, PROTOCOL_VERSION } from '../server/protocol.js';
import { connectTestClient, emitAck, onceEvent } from './helpers/socket-client.js';

const payload = (extra = {}) => ({ protocolVersion: PROTOCOL_VERSION, ...extra });

async function withServer(t, overrides = {}) {
  const app = createApp({ configOverrides: { countdownMs: 15, revealMs: 20, decisionMs: 300, ...overrides } });
  const port = await app.start(0);
  t.after(async () => app.stop());
  return { app, port };
}

test('health and ready answer 200', async (t) => {
  const { port } = await withServer(t);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).protocolVersion, PROTOCOL_VERSION);
});

test('unsupported protocol version fails before mutation', async (t) => {
  const { port, app } = await withServer(t);
  const socket = await connectTestClient(port);
  t.after(() => socket.close());
  const result = await emitAck(socket, EVENTS.HOST_CREATE_ROOM, { protocolVersion: 999 });
  assert.deepEqual(result, { ok: false, code: ERROR_CODES.PROTOCOL_VERSION_UNSUPPORTED });
  assert.equal(app.roomManager.getRoom('ABCDE'), null);
});

test('host and player mutations require their own credentials', async (t) => {
  const { port } = await withServer(t);
  const host = await connectTestClient(port);
  const player = await connectTestClient(port);
  t.after(() => host.close());
  t.after(() => player.close());

  const room = await emitAck(host, EVENTS.HOST_CREATE_ROOM, payload());
  assert.equal(room.ok, true);
  const joined = await emitAck(player, EVENTS.PLAYER_JOIN, payload({ roomCode: room.roomCode, displayName: 'Dana', characterId: 'dana' }));
  assert.equal(joined.ok, true);

  const badHost = await emitAck(host, EVENTS.HOST_UPDATE_SETTINGS, payload({ roomCode: room.roomCode, hostToken: 'wrong', settings: { decisionMs: 5000 } }));
  assert.equal(badHost.code, ERROR_CODES.HOST_AUTH_FAILED);

  const badPlayer = await emitAck(player, EVENTS.PLAYER_SET_READY, payload({ roomCode: room.roomCode, playerToken: 'wrong', ready: true }));
  assert.equal(badPlayer.code, ERROR_CODES.PLAYER_AUTH_FAILED);
});

test('stale moves are rejected and public events do not leak choice before reveal', async (t) => {
  const { port } = await withServer(t);
  const host = await connectTestClient(port);
  const player = await connectTestClient(port);
  t.after(() => host.close());
  t.after(() => player.close());

  const publicPayloads = [];
  host.onAny((event, data) => {
    if (event !== EVENTS.STAGE_REVEAL) publicPayloads.push({ event, data });
  });

  const room = await emitAck(host, EVENTS.HOST_CREATE_ROOM, payload());
  const joined = await emitAck(player, EVENTS.PLAYER_JOIN, payload({ roomCode: room.roomCode, displayName: 'Dana', characterId: 'dana' }));
  const stagePromise = onceEvent(host, EVENTS.STAGE_OPEN);
  const start = await emitAck(host, EVENTS.HOST_START_ROUND, payload({ roomCode: room.roomCode, hostToken: room.hostToken }));
  assert.equal(start.ok, true);
  const stage = await stagePromise;

  const stale = await emitAck(player, EVENTS.PLAYER_MOVE, payload({
    roomCode: room.roomCode,
    playerToken: joined.playerToken,
    roundId: stage.roundId,
    stageIndex: stage.stageIndex + 1,
    inputSeq: 1,
    side: 'L',
  }));
  assert.equal(stale.code, ERROR_CODES.STAGE_STALE);

  const revealPromise = onceEvent(host, EVENTS.STAGE_REVEAL);
  const move = await emitAck(player, EVENTS.PLAYER_MOVE, payload({
    roomCode: room.roomCode,
    playerToken: joined.playerToken,
    roundId: stage.roundId,
    stageIndex: stage.stageIndex,
    inputSeq: 2,
    side: 'L',
  }));
  assert.equal(move.ok, true);
  const reveal = await revealPromise;
  assert.ok(['L', 'R'].includes(reveal.safeSide));

  const serialized = JSON.stringify(publicPayloads);
  assert.equal(serialized.includes('safeSide'), false);
  assert.equal(serialized.includes('"side":"L"'), false);
  assert.equal(serialized.includes('"side":"R"'), false);
});
