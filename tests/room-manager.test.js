import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/room-manager.js';
import { ERROR_CODES } from '../server/protocol.js';
import { createTestClock } from './helpers/test-clock.js';

function manager(options = {}) {
  const clock = options.clock || createTestClock(1000);
  return {
    clock,
    manager: new RoomManager({
      now: clock.now,
      randomSide: () => 'L',
      ...options,
      clock: undefined,
    }),
  };
}

test('code collision retries and host token restores', () => {
  const codes = ['ABCDE', 'ABCDE', 'FGHJK'];
  const { manager: rooms } = manager({ codeGenerator: () => codes.shift() });
  const a = rooms.createRoom({ socketId: 'host-a' });
  const b = rooms.createRoom({ socketId: 'host-b' });
  assert.equal(a.roomCode, 'ABCDE');
  assert.equal(b.roomCode, 'FGHJK');
  assert.equal(rooms.restoreHost({ roomCode: a.roomCode, hostToken: a.hostToken, socketId: 'host-a2' }).ok, true);
  assert.equal(rooms.restoreHost({ roomCode: a.roomCode, hostToken: b.hostToken }).code, ERROR_CODES.HOST_AUTH_FAILED);
});

test('room enforces six-player capacity', () => {
  const { manager: rooms } = manager({ codeGenerator: () => 'ABCDE' });
  const room = rooms.createRoom();
  for (let index = 0; index < 6; index += 1) {
    assert.equal(rooms.joinPlayer({ roomCode: room.roomCode, displayName: `P${index}`, characterId: 'dana' }).ok, true);
  }
  assert.equal(rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'Overflow', characterId: 'nadir' }).code, ERROR_CODES.ROOM_FULL);
});

test('player reconnect restores same identity within grace', () => {
  const { manager: rooms, clock } = manager({ codeGenerator: () => 'ABCDE' });
  const room = rooms.createRoom();
  const join = rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'Dana', characterId: 'dana', socketId: 'p1-socket' });
  rooms.markDisconnected('p1-socket');
  clock.advance(89_000);
  const restored = rooms.restorePlayer({ roomCode: room.roomCode, playerToken: join.playerToken, socketId: 'p1-new' });
  assert.equal(restored.ok, true);
  assert.equal(restored.playerId, join.playerId);
  assert.equal(restored.privateState.characterId, 'dana');
});

test('expired active player remains ranked participant but cannot restore', () => {
  const clock = createTestClock(1000);
  const rooms = new RoomManager({
    now: clock.now,
    codeGenerator: () => 'ABCDE',
    randomSide: () => 'L',
    config: { reconnectGraceMs: 1000, inactiveExpiryMs: 60_000, hardRoomLifetimeMs: 60_000 },
  });
  const room = rooms.createRoom({ socketId: 'host' });
  const join = rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'Dana', socketId: 'player' });
  assert.equal(rooms.startRound({ roomCode: room.roomCode, hostToken: room.hostToken }).ok, true);
  rooms.openStage({ roomCode: room.roomCode });
  rooms.markDisconnected('player');
  clock.advance(1001);
  rooms.sweepExpired();
  assert.equal(rooms.restorePlayer({ roomCode: room.roomCode, playerToken: join.playerToken, socketId: 'late' }).code, ERROR_CODES.PLAYER_AUTH_FAILED);
  assert.equal(rooms.roomSnapshot(room.roomCode).players.some((p) => p.playerId === join.playerId), true);
});

test('player joining active round is spectator until room returns to lobby', () => {
  const { manager: rooms } = manager({ codeGenerator: () => 'ABCDE' });
  const room = rooms.createRoom();
  rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'First', characterId: 'nadir' });
  assert.equal(rooms.startRound({ roomCode: room.roomCode, hostToken: room.hostToken }).ok, true);
  const late = rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'Late', characterId: 'zayd' });
  assert.equal(late.ok, true);
  assert.equal(late.privateState.roundEligible, false);
  rooms.returnToLobby({ roomCode: room.roomCode });
  const snapshot = rooms.roomSnapshot(room.roomCode);
  assert.equal(snapshot.players.find((p) => p.playerId === late.playerId).roundEligible, true);
});

test('disconnected alive player prevents early stage close', () => {
  const { manager: rooms } = manager({ codeGenerator: () => 'ABCDE' });
  const room = rooms.createRoom({ socketId: 'host' });
  const a = rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'A', socketId: 'a' });
  const b = rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'B', socketId: 'b' });
  rooms.startRound({ roomCode: room.roomCode, hostToken: room.hostToken });
  const stage = rooms.openStage({ roomCode: room.roomCode });
  rooms.markDisconnected('b');
  const move = rooms.submitMove({ roomCode: room.roomCode, playerToken: a.playerToken, roundId: stage.roundId, stageIndex: stage.stageIndex, inputSeq: 1, side: 'L' });
  assert.equal(move.ok, true);
  assert.equal(move.submittedCount, 1);
  assert.equal(move.aliveCount, 2);
  assert.equal(move.shouldResolve, false);
  assert.ok(b.playerToken);
});

test('inactive lobby rooms expire and snapshots never expose credentials', () => {
  const clock = createTestClock(1000);
  const rooms = new RoomManager({
    now: clock.now,
    codeGenerator: () => 'ABCDE',
    config: { inactiveExpiryMs: 1000, hardRoomLifetimeMs: 5000 },
  });
  const room = rooms.createRoom();
  const player = rooms.joinPlayer({ roomCode: room.roomCode, displayName: 'Dana' });
  const serialized = JSON.stringify(rooms.roomSnapshot(room.roomCode));
  assert.equal(serialized.includes(room.hostToken), false);
  assert.equal(serialized.includes(player.playerToken), false);
  assert.equal(serialized.includes('Digest'), false);
  assert.equal(serialized.includes('token'), false);
  clock.advance(1001);
  assert.deepEqual(rooms.sweepExpired(), [room.roomCode]);
  assert.equal(rooms.getRoom(room.roomCode), null);
});
