import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { ERROR_CODES, EVENTS, PROTOCOL_VERSION } from '../server/protocol.js';
import { connectTestClient, emitAck, onceEvent } from './helpers/socket-client.js';

const p = (extra = {}) => ({ protocolVersion: PROTOCOL_VERSION, ...extra });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function join(socket, roomCode, displayName, characterId) {
  const result = await emitAck(socket, EVENTS.PLAYER_JOIN, p({ roomCode, displayName, characterId }));
  assert.equal(result.ok, true, `${displayName} should join`);
  return result;
}

async function ready(socket, roomCode, playerToken) {
  const result = await emitAck(socket, EVENTS.PLAYER_SET_READY, p({ roomCode, playerToken, ready: true }));
  assert.equal(result.ok, true);
  return result;
}

test('real multiplayer room preserves secrecy, idempotency, reconnect, late-join rules, and round reuse', async (t) => {
  const app = createApp({ configOverrides: { countdownMs: 10, revealMs: 10, decisionMs: 200, stageCount: 2, startingLives: 3 } });
  const port = await app.start(0);
  t.after(async () => app.stop());

  const host = await connectTestClient(port);
  const tv = await connectTestClient(port);
  const p1 = await connectTestClient(port);
  const p2 = await connectTestClient(port);
  const p3 = await connectTestClient(port);
  const sockets = [host, tv, p1, p2, p3];
  t.after(() => sockets.forEach((socket) => socket.close()));

  const room = await emitAck(host, EVENTS.HOST_CREATE_ROOM, p());
  assert.equal(room.ok, true);
  assert.match(room.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);

  const tvWatch = await emitAck(tv, EVENTS.TV_WATCH, p({ roomCode: room.roomCode }));
  assert.equal(tvWatch.ok, true);

  const a = await join(p1, room.roomCode, 'Nadir', 'nadir');
  const b = await join(p2, room.roomCode, 'Dana', 'dana');
  const c = await join(p3, room.roomCode, 'Sami', 'sami');
  await ready(p1, room.roomCode, a.playerToken);
  await ready(p2, room.roomCode, b.playerToken);
  await ready(p3, room.roomCode, c.playerToken);

  const preRevealPublic = [];
  for (const socket of [host, tv]) {
    socket.onAny((event, data) => {
      if (event !== EVENTS.STAGE_REVEAL) preRevealPublic.push({ event, data });
    });
  }

  const stageOpen = onceEvent(tv, EVENTS.STAGE_OPEN);
  const start = await emitAck(host, EVENTS.HOST_START_ROUND, p({ roomCode: room.roomCode, hostToken: room.hostToken }));
  assert.equal(start.ok, true);
  const stage = await stageOpen;
  assert.equal(stage.stageIndex, 0);
  assert.equal(JSON.stringify(stage).includes('safeSide'), false);

  const firstMove = await emitAck(p1, EVENTS.PLAYER_MOVE, p({
    roomCode: room.roomCode,
    playerToken: a.playerToken,
    roundId: stage.roundId,
    stageIndex: stage.stageIndex,
    inputSeq: 10,
    side: 'L',
  }));
  assert.equal(firstMove.ok, true);

  const replay = await emitAck(p1, EVENTS.PLAYER_MOVE, p({
    roomCode: room.roomCode,
    playerToken: a.playerToken,
    roundId: stage.roundId,
    stageIndex: stage.stageIndex,
    inputSeq: 10,
    side: 'R',
  }));
  assert.equal(replay.code, ERROR_CODES.INPUT_REPLAYED);

  const duplicate = await emitAck(p1, EVENTS.PLAYER_MOVE, p({
    roomCode: room.roomCode,
    playerToken: a.playerToken,
    roundId: stage.roundId,
    stageIndex: stage.stageIndex,
    inputSeq: 11,
    side: 'R',
  }));
  assert.equal(duplicate.code, ERROR_CODES.MOVE_ALREADY_SUBMITTED);

  const stale = await emitAck(p3, EVENTS.PLAYER_MOVE, p({
    roomCode: room.roomCode,
    playerToken: c.playerToken,
    roundId: stage.roundId,
    stageIndex: stage.stageIndex + 1,
    inputSeq: 20,
    side: 'L',
  }));
  assert.equal(stale.code, ERROR_CODES.STAGE_STALE);

  const revealOnTv = onceEvent(tv, EVENTS.STAGE_REVEAL);
  const revealOnHost = onceEvent(host, EVENTS.STAGE_REVEAL);
  assert.equal((await emitAck(p2, EVENTS.PLAYER_MOVE, p({ roomCode: room.roomCode, playerToken: b.playerToken, roundId: stage.roundId, stageIndex: 0, inputSeq: 30, side: 'R' }))).ok, true);
  assert.equal((await emitAck(p3, EVENTS.PLAYER_MOVE, p({ roomCode: room.roomCode, playerToken: c.playerToken, roundId: stage.roundId, stageIndex: 0, inputSeq: 21, side: 'L' }))).ok, true);

  const [tvReveal, hostReveal] = await Promise.all([revealOnTv, revealOnHost]);
  assert.deepEqual(hostReveal, tvReveal);
  assert.ok(['L', 'R'].includes(tvReveal.safeSide));
  assert.equal(JSON.stringify(preRevealPublic).includes('safeSide'), false);
  assert.equal(JSON.stringify(preRevealPublic).includes('"side":"L"'), false);
  assert.equal(JSON.stringify(preRevealPublic).includes('"side":"R"'), false);

  // Restore Dana onto a fresh transport and prove the same player identity/state returns.
  p2.close();
  await wait(15);
  const p2Restored = await connectTestClient(port);
  sockets.push(p2Restored);
  const restored = await emitAck(p2Restored, EVENTS.PLAYER_RESTORE, p({ roomCode: room.roomCode, playerToken: b.playerToken }));
  assert.equal(restored.ok, true);
  assert.equal(restored.playerId, b.playerId);
  assert.equal(restored.privateState.characterId, 'dana');
  assert.equal(restored.privateState.playerId, b.playerId);

  // Join during active play: the new player is a spectator until the next lobby.
  const lateSocket = await connectTestClient(port);
  sockets.push(lateSocket);
  const late = await join(lateSocket, room.roomCode, 'Late Rebel', 'zayd');
  assert.equal(late.privateState.roundEligible, false);

  const secondStage = await onceEvent(tv, EVENTS.STAGE_OPEN);
  assert.equal(secondStage.stageIndex, 1);
  const lateMove = await emitAck(lateSocket, EVENTS.PLAYER_MOVE, p({
    roomCode: room.roomCode,
    playerToken: late.playerToken,
    roundId: secondStage.roundId,
    stageIndex: secondStage.stageIndex,
    inputSeq: 1,
    side: 'L',
  }));
  assert.equal(lateMove.code, ERROR_CODES.PLAYER_AUTH_FAILED);

  const finished = onceEvent(tv, EVENTS.ROUND_FINISHED, 3000);
  const stage2Reveal = onceEvent(tv, EVENTS.STAGE_REVEAL, 3000);
  assert.equal((await emitAck(p1, EVENTS.PLAYER_MOVE, p({ roomCode: room.roomCode, playerToken: a.playerToken, roundId: secondStage.roundId, stageIndex: 1, inputSeq: 12, side: 'L' }))).ok, true);
  assert.equal((await emitAck(p2Restored, EVENTS.PLAYER_MOVE, p({ roomCode: room.roomCode, playerToken: b.playerToken, roundId: secondStage.roundId, stageIndex: 1, inputSeq: 31, side: 'R' }))).ok, true);
  assert.equal((await emitAck(p3, EVENTS.PLAYER_MOVE, p({ roomCode: room.roomCode, playerToken: c.playerToken, roundId: secondStage.roundId, stageIndex: 1, inputSeq: 22, side: 'L' }))).ok, true);
  await stage2Reveal;
  const final = await finished;
  assert.equal(final.ranking.length, 3);
  assert.deepEqual([...final.ranking].map((r) => r.place), [1, 2, 3]);
  assert.equal(new Set(final.ranking.map((r) => r.playerId)).size, 3);

  // Gateway returns the room to lobby after the final reveal/finish transition.
  await wait(25);
  const lobby = app.roomManager.roomSnapshot(room.roomCode);
  assert.equal(lobby.status, 'lobby');
  assert.equal(lobby.players.length, 4);
  assert.equal(lobby.players.every((player) => player.ready === false), true);
  assert.equal(lobby.players.find((player) => player.playerId === late.playerId).roundEligible, true);

  // Same room can run again without creating new credentials.
  const secondRoundStage = onceEvent(host, EVENTS.STAGE_OPEN, 3000);
  const restart = await emitAck(host, EVENTS.HOST_START_ROUND, p({ roomCode: room.roomCode, hostToken: room.hostToken }));
  assert.equal(restart.ok, true);
  const reopened = await secondRoundStage;
  assert.equal(reopened.stageIndex, 0);
  assert.notEqual(reopened.roundId, stage.roundId);

  await emitAck(host, EVENTS.HOST_END_ROUND, p({ roomCode: room.roomCode, hostToken: room.hostToken, reason: 'integration-complete' }));
});
