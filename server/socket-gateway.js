import { EVENTS, ERROR_CODES, PROTOCOL_VERSION } from './protocol.js';

const roomChannel = (roomCode) => `room:${roomCode}`;
const fail = (code) => ({ ok: false, code });

export function bindSocketGateway({ io, roomManager, logger, roomSettingsOverrides = {} }) {
  const timers = new Map();

  const stateFor = (roomCode) => {
    if (!timers.has(roomCode)) timers.set(roomCode, { stage: null, transition: null });
    return timers.get(roomCode);
  };

  const clearTimer = (handle) => { if (handle) clearTimeout(handle); };
  const clearRoomTimers = (roomCode) => {
    const state = timers.get(roomCode);
    if (!state) return;
    clearTimer(state.stage);
    clearTimer(state.transition);
    timers.delete(roomCode);
  };

  const emitSnapshot = (roomCode) => {
    const snapshot = roomManager.roomSnapshot(roomCode);
    if (snapshot) io.to(roomChannel(roomCode)).emit(EVENTS.ROOM_SNAPSHOT, { protocolVersion: PROTOCOL_VERSION, ...snapshot });
  };

  const emitPrivateStates = (roomCode) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) continue;
      io.to(player.socketId).emit(EVENTS.PLAYER_PRIVATE_STATE, {
        protocolVersion: PROTOCOL_VERSION,
        ...roomManager.privatePlayerState(room, player),
      });
    }
  };

  const returnToLobby = (roomCode) => {
    const result = roomManager.returnToLobby({ roomCode });
    if (result.ok) {
      emitSnapshot(roomCode);
      emitPrivateStates(roomCode);
    }
  };

  const openStage = (roomCode) => {
    const result = roomManager.openStage({ roomCode });
    if (!result.ok) return;
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    io.to(roomChannel(roomCode)).emit(EVENTS.STAGE_OPEN, {
      protocolVersion: PROTOCOL_VERSION,
      roundId: result.roundId,
      stageIndex: result.stageIndex,
      deadlineAt: result.deadlineAt,
      aliveCount: result.aliveCount,
    });
    emitSnapshot(roomCode);
    emitPrivateStates(roomCode);
    const state = stateFor(roomCode);
    clearTimer(state.stage);
    state.stage = setTimeout(() => resolveStage(roomCode, 'deadline'), Math.max(0, result.deadlineAt - Date.now()));
  };

  const resolveStage = (roomCode, reason) => {
    const state = stateFor(roomCode);
    clearTimer(state.stage);
    state.stage = null;
    const result = roomManager.resolveStage({ roomCode, reason });
    if (!result.ok) return;
    io.to(roomChannel(roomCode)).emit(EVENTS.STAGE_REVEAL, {
      protocolVersion: PROTOCOL_VERSION,
      roundId: result.roundId,
      stageIndex: result.stageIndex,
      safeSide: result.safeSide,
      outcomes: result.outcomes,
      finished: result.finished,
    });
    emitSnapshot(roomCode);
    emitPrivateStates(roomCode);
    const room = roomManager.getRoom(roomCode);
    const revealMs = room?.settings?.revealMs ?? 1800;
    clearTimer(state.transition);
    state.transition = setTimeout(() => {
      if (result.finished) {
        io.to(roomChannel(roomCode)).emit(EVENTS.ROUND_FINISHED, {
          protocolVersion: PROTOCOL_VERSION,
          roundId: result.roundId,
          ranking: result.ranking,
        });
        returnToLobby(roomCode);
      } else {
        openStage(roomCode);
      }
    }, revealMs);
  };

  const withProtocol = (socket, handler) => async (payload = {}, ack = () => {}) => {
    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      ack(fail(ERROR_CODES.PROTOCOL_VERSION_UNSUPPORTED));
      return;
    }
    try {
      await handler(payload, ack);
    } catch (error) {
      logger.error('socket handler failed', { event: handler.name, socketId: socket.id, error: error?.message });
      ack({ ok: false, code: 'INTERNAL_ERROR' });
      socket.emit(EVENTS.SERVER_ERROR, { protocolVersion: PROTOCOL_VERSION, code: 'INTERNAL_ERROR' });
    }
  };

  io.on('connection', (socket) => {
    socket.on(EVENTS.HOST_CREATE_ROOM, withProtocol(socket, (payload, ack) => {
      let result = roomManager.createRoom({ socketId: socket.id });
      if (result.ok && Object.keys(roomSettingsOverrides).length > 0) {
        const updated = roomManager.updateSettings({ roomCode: result.roomCode, hostToken: result.hostToken, settings: roomSettingsOverrides });
        if (updated.ok) result = { ...result, roomSnapshot: updated.roomSnapshot };
      }
      if (result.ok) {
        socket.join(roomChannel(result.roomCode));
        socket.data = { role: 'host', roomCode: result.roomCode };
      }
      ack(result);
      if (result.ok) emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.HOST_RESTORE, withProtocol(socket, (payload, ack) => {
      const result = roomManager.restoreHost({ ...payload, socketId: socket.id });
      if (result.ok) {
        socket.join(roomChannel(result.roomCode));
        socket.data = { role: 'host', roomCode: result.roomCode };
      }
      ack(result);
      if (result.ok) emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.HOST_UPDATE_SETTINGS, withProtocol(socket, (payload, ack) => {
      const result = roomManager.updateSettings(payload);
      ack(result);
      if (result.ok) emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.HOST_START_ROUND, withProtocol(socket, (payload, ack) => {
      const result = roomManager.startRound(payload);
      ack(result);
      if (!result.ok) return;
      clearRoomTimers(result.roomCode);
      emitSnapshot(result.roomCode);
      emitPrivateStates(result.roomCode);
      const room = roomManager.getRoom(result.roomCode);
      const countdownMs = room?.settings?.countdownMs ?? 3000;
      io.to(roomChannel(result.roomCode)).emit(EVENTS.ROUND_COUNTDOWN, {
        protocolVersion: PROTOCOL_VERSION,
        roundId: result.roundState.roundId,
        startsAt: Date.now() + countdownMs,
      });
      const state = stateFor(result.roomCode);
      state.transition = setTimeout(() => openStage(result.roomCode), countdownMs);
    }));

    socket.on(EVENTS.HOST_END_ROUND, withProtocol(socket, (payload, ack) => {
      const result = roomManager.endRound(payload);
      ack(result);
      if (!result.ok) return;
      clearRoomTimers(result.roomCode);
      io.to(roomChannel(result.roomCode)).emit(EVENTS.ROUND_FINISHED, {
        protocolVersion: PROTOCOL_VERSION,
        roundId: result.roundId,
        ranking: result.ranking,
        reason: result.reason,
      });
      emitSnapshot(result.roomCode);
      emitPrivateStates(result.roomCode);
      const room = roomManager.getRoom(result.roomCode);
      const revealMs = room?.settings?.revealMs ?? 1800;
      const state = stateFor(result.roomCode);
      state.transition = setTimeout(() => returnToLobby(result.roomCode), revealMs);
    }));

    socket.on(EVENTS.HOST_CLOSE_ROOM, withProtocol(socket, (payload, ack) => {
      const roomCode = String(payload.roomCode || '').toUpperCase();
      const result = roomManager.closeRoom(payload);
      ack(result);
      if (!result.ok) return;
      clearRoomTimers(roomCode);
      io.to(roomChannel(roomCode)).emit(EVENTS.ROOM_CLOSED, { protocolVersion: PROTOCOL_VERSION, roomCode });
    }));

    socket.on(EVENTS.TV_WATCH, withProtocol(socket, (payload, ack) => {
      const result = roomManager.watchTv({ ...payload, socketId: socket.id });
      if (result.ok) {
        socket.join(roomChannel(result.roomCode));
        socket.data = { role: 'tv', roomCode: result.roomCode };
      }
      ack(result);
      if (result.ok) socket.emit(EVENTS.ROOM_SNAPSHOT, { protocolVersion: PROTOCOL_VERSION, ...result.roomSnapshot });
    }));

    socket.on(EVENTS.PLAYER_JOIN, withProtocol(socket, (payload, ack) => {
      const result = roomManager.joinPlayer({ ...payload, socketId: socket.id });
      if (result.ok) {
        socket.join(roomChannel(result.roomCode));
        socket.data = { role: 'player', roomCode: result.roomCode, playerId: result.playerId };
      }
      ack(result);
      if (!result.ok) return;
      socket.emit(EVENTS.PLAYER_PRIVATE_STATE, { protocolVersion: PROTOCOL_VERSION, ...result.privateState });
      emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.PLAYER_RESTORE, withProtocol(socket, (payload, ack) => {
      const result = roomManager.restorePlayer({ ...payload, socketId: socket.id });
      if (result.ok) {
        socket.join(roomChannel(result.roomCode));
        socket.data = { role: 'player', roomCode: result.roomCode, playerId: result.playerId };
      }
      ack(result);
      if (!result.ok) return;
      socket.emit(EVENTS.PLAYER_PRIVATE_STATE, { protocolVersion: PROTOCOL_VERSION, ...result.privateState });
      emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.PLAYER_SET_CHARACTER, withProtocol(socket, (payload, ack) => {
      const result = roomManager.setCharacter(payload);
      ack(result);
      if (!result.ok) return;
      socket.emit(EVENTS.PLAYER_PRIVATE_STATE, { protocolVersion: PROTOCOL_VERSION, ...result.privateState });
      emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.PLAYER_SET_READY, withProtocol(socket, (payload, ack) => {
      const result = roomManager.setReady(payload);
      ack(result);
      if (!result.ok) return;
      socket.emit(EVENTS.PLAYER_PRIVATE_STATE, { protocolVersion: PROTOCOL_VERSION, ...result.privateState });
      emitSnapshot(result.roomCode);
    }));

    socket.on(EVENTS.PLAYER_MOVE, withProtocol(socket, (payload, ack) => {
      const result = roomManager.submitMove(payload);
      ack(result);
      if (!result.ok) return;
      io.to(roomChannel(result.roomCode)).emit(EVENTS.STAGE_SUBMISSION_COUNT, {
        protocolVersion: PROTOCOL_VERSION,
        stageIndex: result.stageIndex,
        submittedCount: result.submittedCount,
        aliveCount: result.aliveCount,
      });
      emitPrivateStates(result.roomCode);
      if (result.shouldResolve) resolveStage(result.roomCode, 'all-submitted');
    }));

    socket.on('disconnect', () => {
      const changedRooms = roomManager.markDisconnected(socket.id);
      for (const roomCode of changedRooms) emitSnapshot(roomCode);
    });
  });

  return {
    clearRoomTimers,
    sweepExpired() {
      const expired = roomManager.sweepExpired();
      for (const roomCode of expired) {
        clearRoomTimers(roomCode);
        io.to(roomChannel(roomCode)).emit(EVENTS.ROOM_CLOSED, { protocolVersion: PROTOCOL_VERSION, roomCode });
      }
      return expired;
    },
    dispose() {
      for (const roomCode of [...timers.keys()]) clearRoomTimers(roomCode);
    },
  };
}
