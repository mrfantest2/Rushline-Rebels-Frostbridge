import { randomInt, randomUUID } from 'node:crypto';
import { CONFIG, DEFAULT_SETTINGS } from './config.js';
import { GameEngine } from './game-engine.js';
import { createCredential, verifyToken } from './session-manager.js';
import { ERROR_CODES } from './protocol.js';
import {
  validateCharacterId,
  validateDisplayName,
  validateMovePayload,
  validateRoomCode,
  validateSettingsPatch,
} from './validators.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function secureRoomCode() {
  return Array.from({ length: 5 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
}

const fail = (code) => ({ ok: false, code });

export class RoomManager {
  #config;
  #now;
  #codeGenerator;
  #randomSide;
  #rooms = new Map();

  constructor({ config = {}, now = Date.now, codeGenerator = secureRoomCode, randomSide } = {}) {
    this.#config = { ...CONFIG, ...config };
    this.#now = now;
    this.#codeGenerator = codeGenerator;
    this.#randomSide = randomSide;
  }

  createRoom({ socketId = null } = {}) {
    if (this.#rooms.size >= this.#config.maxRooms) return fail(ERROR_CODES.ROOM_FULL);

    let roomCode = null;
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const candidate = String(this.#codeGenerator()).trim().toUpperCase();
      if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(candidate) && !this.#rooms.has(candidate)) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) throw new Error('Unable to allocate unique room code');

    const host = createCredential();
    const now = this.#now();
    const room = {
      roomCode,
      createdAt: now,
      lastActivityAt: now,
      status: 'lobby',
      hostDigest: host.digest,
      hostSocketId: socketId,
      hostConnected: Boolean(socketId),
      tvSocketIds: new Set(),
      settings: { ...DEFAULT_SETTINGS },
      players: new Map(),
      engine: null,
      closed: false,
    };
    this.#rooms.set(roomCode, room);
    return { ok: true, roomCode, hostToken: host.token, roomSnapshot: this.roomSnapshot(room) };
  }

  getRoom(code) {
    const valid = validateRoomCode(code);
    return valid.ok ? this.#rooms.get(valid.value) || null : null;
  }

  restoreHost({ roomCode, hostToken, socketId = null }) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    if (!verifyToken(hostToken, room.hostDigest)) return fail(ERROR_CODES.HOST_AUTH_FAILED);
    room.hostSocketId = socketId;
    room.hostConnected = Boolean(socketId);
    this.#touch(room);
    return { ok: true, roomCode: room.roomCode, roomSnapshot: this.roomSnapshot(room) };
  }

  watchTv({ roomCode, socketId }) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    if (socketId) room.tvSocketIds.add(socketId);
    this.#touch(room);
    return { ok: true, roomCode: room.roomCode, roomSnapshot: this.roomSnapshot(room) };
  }

  joinPlayer({ roomCode, displayName, characterId = 'dana', socketId = null }) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    if (room.players.size >= room.settings.maxPlayers) return fail(ERROR_CODES.ROOM_FULL);

    const nameResult = validateDisplayName(displayName);
    if (!nameResult.ok) return nameResult;
    const characterResult = validateCharacterId(characterId);
    if (!characterResult.ok) return characterResult;

    const credential = createCredential();
    const playerId = randomUUID();
    const player = {
      playerId,
      displayName: nameResult.value,
      characterId: characterResult.value,
      tokenDigest: credential.digest,
      socketId,
      connected: Boolean(socketId),
      reconnectDeadline: null,
      sessionExpired: false,
      ready: false,
      roundEligible: room.status === 'lobby',
      joinedAt: this.#now(),
    };
    room.players.set(playerId, player);
    this.#touch(room);
    return {
      ok: true,
      roomCode: room.roomCode,
      playerId,
      playerToken: credential.token,
      roomSnapshot: this.roomSnapshot(room),
      privateState: this.privatePlayerState(room, player),
    };
  }

  restorePlayer({ roomCode, playerToken, socketId = null }) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    const player = this.#findPlayerByToken(room, playerToken);
    if (!player || player.sessionExpired) return fail(ERROR_CODES.PLAYER_AUTH_FAILED);
    if (!player.connected && player.reconnectDeadline !== null && this.#now() > player.reconnectDeadline) {
      player.sessionExpired = true;
      return fail(ERROR_CODES.PLAYER_AUTH_FAILED);
    }
    player.socketId = socketId;
    player.connected = Boolean(socketId);
    player.reconnectDeadline = null;
    this.#touch(room);
    return {
      ok: true,
      roomCode: room.roomCode,
      playerId: player.playerId,
      roomSnapshot: this.roomSnapshot(room),
      privateState: this.privatePlayerState(room, player),
    };
  }

  setCharacter({ roomCode, playerToken, characterId }) {
    const auth = this.#authPlayer(roomCode, playerToken);
    if (!auth.ok) return auth;
    const result = validateCharacterId(characterId);
    if (!result.ok) return result;
    if (auth.room.status !== 'lobby') return fail(ERROR_CODES.ROUND_NOT_ACTIVE);
    auth.player.characterId = result.value;
    this.#touch(auth.room);
    return { ok: true, roomCode: auth.room.roomCode, roomSnapshot: this.roomSnapshot(auth.room), privateState: this.privatePlayerState(auth.room, auth.player) };
  }

  setReady({ roomCode, playerToken, ready }) {
    const auth = this.#authPlayer(roomCode, playerToken);
    if (!auth.ok) return auth;
    if (auth.room.status !== 'lobby') return fail(ERROR_CODES.ROUND_NOT_ACTIVE);
    auth.player.ready = Boolean(ready);
    this.#touch(auth.room);
    return { ok: true, roomCode: auth.room.roomCode, roomSnapshot: this.roomSnapshot(auth.room), privateState: this.privatePlayerState(auth.room, auth.player) };
  }

  updateSettings({ roomCode, hostToken, settings }) {
    const auth = this.#authHost(roomCode, hostToken);
    if (!auth.ok) return auth;
    if (auth.room.status !== 'lobby') return fail(ERROR_CODES.ROUND_NOT_ACTIVE);
    const result = validateSettingsPatch(settings);
    if (!result.ok) return result;
    auth.room.settings = result.value;
    this.#touch(auth.room);
    return { ok: true, roomCode: auth.room.roomCode, roomSnapshot: this.roomSnapshot(auth.room) };
  }

  startRound({ roomCode, hostToken }) {
    const auth = this.#authHost(roomCode, hostToken);
    if (!auth.ok) return auth;
    const room = auth.room;
    if (room.status !== 'lobby') return fail(ERROR_CODES.ROUND_NOT_ACTIVE);
    const participants = [...room.players.values()].filter((player) => player.roundEligible && !player.sessionExpired);
    if (participants.length === 0) return fail(ERROR_CODES.ROUND_NOT_ACTIVE);

    room.engine = new GameEngine({ settings: room.settings, randomSide: this.#randomSide, now: this.#now });
    const roundState = room.engine.startRound(participants.map(({ playerId }) => ({ playerId })));
    room.status = 'countdown';
    for (const player of room.players.values()) player.ready = false;
    this.#touch(room);
    return { ok: true, roomCode: room.roomCode, roundState, roomSnapshot: this.roomSnapshot(room) };
  }

  openStage({ roomCode }) {
    const room = this.getRoom(roomCode);
    if (!room || !room.engine) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    const result = room.engine.openStage();
    if (result.ok) room.status = 'stage-open';
    else if (room.engine.publicRoundState()?.status === 'finished') room.status = 'finished';
    this.#touch(room);
    return result.ok ? { ...result, roomCode: room.roomCode } : result;
  }

  submitMove({ roomCode, playerToken, ...payload }) {
    const auth = this.#authPlayer(roomCode, playerToken);
    if (!auth.ok) return auth;
    const room = auth.room;
    if (!room.engine) return fail(ERROR_CODES.ROUND_NOT_ACTIVE);
    const valid = validateMovePayload(payload);
    if (!valid.ok) return valid;
    if (!auth.player.roundEligible || auth.player.sessionExpired) return fail(ERROR_CODES.PLAYER_AUTH_FAILED);

    const result = room.engine.submitMove({ playerId: auth.player.playerId, ...valid.value });
    if (!result.ok) return result;
    this.#touch(room);

    const alive = room.engine.alivePlayers();
    const publicState = room.engine.publicRoundState();
    const submittedCount = publicState.players.filter((player) => !player.eliminated && player.submitted).length;
    const aliveCount = alive.length;
    return {
      ok: true,
      roomCode: room.roomCode,
      stageIndex: result.stageIndex,
      submittedCount,
      aliveCount,
      shouldResolve: aliveCount > 0 && submittedCount === aliveCount,
    };
  }

  resolveStage({ roomCode, reason = 'deadline' }) {
    const room = this.getRoom(roomCode);
    if (!room || !room.engine) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    const result = room.engine.resolveStage(reason);
    if (!result.ok) return result;
    room.status = result.finished ? 'finished' : 'stage-reveal';
    this.#touch(room);
    return { ...result, roomCode: room.roomCode, roomSnapshot: this.roomSnapshot(room) };
  }

  endRound({ roomCode, hostToken, reason = 'host-ended' }) {
    const auth = this.#authHost(roomCode, hostToken);
    if (!auth.ok) return auth;
    if (!auth.room.engine) return fail(ERROR_CODES.ROUND_NOT_ACTIVE);
    const result = auth.room.engine.endRound(reason);
    auth.room.status = 'finished';
    this.#touch(auth.room);
    return { ...result, roomCode: auth.room.roomCode, roomSnapshot: this.roomSnapshot(auth.room) };
  }

  returnToLobby({ roomCode }) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    room.status = 'lobby';
    room.engine = null;
    for (const player of room.players.values()) {
      player.ready = false;
      player.roundEligible = !player.sessionExpired;
    }
    this.#touch(room);
    return { ok: true, roomCode: room.roomCode, roomSnapshot: this.roomSnapshot(room) };
  }

  closeRoom({ roomCode, hostToken }) {
    const auth = this.#authHost(roomCode, hostToken);
    if (!auth.ok) return auth;
    const room = auth.room;
    room.closed = true;
    room.status = 'closed';
    this.#rooms.delete(room.roomCode);
    return { ok: true, roomCode: room.roomCode };
  }

  markDisconnected(socketId) {
    if (!socketId) return [];
    const changed = [];
    for (const room of this.#rooms.values()) {
      let touched = false;
      if (room.hostSocketId === socketId) {
        room.hostConnected = false;
        room.hostSocketId = null;
        touched = true;
      }
      if (room.tvSocketIds.delete(socketId)) touched = true;
      for (const player of room.players.values()) {
        if (player.socketId !== socketId) continue;
        player.connected = false;
        player.socketId = null;
        player.reconnectDeadline = this.#now() + this.#config.reconnectGraceMs;
        touched = true;
      }
      if (touched) {
        this.#touch(room);
        changed.push(room.roomCode);
      }
    }
    return changed;
  }

  sweepExpired() {
    const now = this.#now();
    const closed = [];
    for (const room of [...this.#rooms.values()]) {
      for (const [playerId, player] of [...room.players.entries()]) {
        if (player.connected || player.reconnectDeadline === null || now <= player.reconnectDeadline) continue;
        if (room.status === 'lobby' || room.status === 'finished') {
          room.players.delete(playerId);
        } else {
          player.sessionExpired = true;
          player.roundEligible = false;
        }
      }

      const hardExpired = now - room.createdAt >= this.#config.hardRoomLifetimeMs;
      const inactiveExpired = ['lobby', 'finished'].includes(room.status) && now - room.lastActivityAt >= this.#config.inactiveExpiryMs;
      if (hardExpired || inactiveExpired) {
        room.closed = true;
        room.status = 'closed';
        this.#rooms.delete(room.roomCode);
        closed.push(room.roomCode);
      }
    }
    return closed;
  }

  roomSnapshot(roomOrCode) {
    const room = typeof roomOrCode === 'string' ? this.getRoom(roomOrCode) : roomOrCode;
    if (!room) return null;
    const roundState = room.engine?.publicRoundState() || null;
    const roundPlayers = new Map((roundState?.players || []).map((player) => [player.playerId, player]));
    return {
      roomCode: room.roomCode,
      status: room.status,
      hostConnected: room.hostConnected,
      tvSpectators: room.tvSocketIds.size,
      settings: { ...room.settings },
      players: [...room.players.values()].map((player) => {
        const round = roundPlayers.get(player.playerId);
        return {
          playerId: player.playerId,
          displayName: player.displayName,
          characterId: player.characterId,
          connected: player.connected,
          ready: player.ready,
          roundEligible: player.roundEligible,
          lives: round?.lives ?? null,
          eliminated: round?.eliminated ?? false,
          furthestStage: round?.furthestStage ?? 0,
          submitted: round?.submitted ?? false,
        };
      }),
      round: roundState,
    };
  }

  privatePlayerState(room, player) {
    return {
      playerId: player.playerId,
      displayName: player.displayName,
      characterId: player.characterId,
      connected: player.connected,
      ready: player.ready,
      roundEligible: player.roundEligible,
      sessionExpired: player.sessionExpired,
      round: room.engine?.privatePlayerState(player.playerId) || null,
    };
  }

  #authHost(roomCode, hostToken) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    if (!verifyToken(hostToken, room.hostDigest)) return fail(ERROR_CODES.HOST_AUTH_FAILED);
    return { ok: true, room };
  }

  #authPlayer(roomCode, playerToken) {
    const room = this.getRoom(roomCode);
    if (!room || room.closed) return fail(ERROR_CODES.ROOM_NOT_FOUND);
    const player = this.#findPlayerByToken(room, playerToken);
    if (!player || player.sessionExpired) return fail(ERROR_CODES.PLAYER_AUTH_FAILED);
    return { ok: true, room, player };
  }

  #findPlayerByToken(room, token) {
    if (typeof token !== 'string') return null;
    for (const player of room.players.values()) {
      if (verifyToken(token, player.tokenDigest)) return player;
    }
    return null;
  }

  #touch(room) {
    room.lastActivityAt = this.#now();
  }
}
