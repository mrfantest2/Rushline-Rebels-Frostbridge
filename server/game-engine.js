import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from './protocol.js';

const copyPlayer = (player) => ({
  playerId: player.playerId,
  lives: player.lives,
  eliminated: player.eliminated,
  furthestStage: player.furthestStage,
  submitted: Boolean(player.submission),
});

export class GameEngine {
  #settings;
  #randomSide;
  #now;
  #round = null;
  #pattern = [];

  constructor({ settings, randomSide = () => (Math.random() < 0.5 ? 'L' : 'R'), now = Date.now }) {
    this.#settings = { ...settings };
    this.#randomSide = randomSide;
    this.#now = now;
  }

  startRound(players) {
    if (!Array.isArray(players) || players.length === 0) {
      throw new Error('startRound requires at least one player');
    }
    this.#pattern = Array.from({ length: this.#settings.stageCount }, () => this.#randomSide());
    this.#round = {
      roundId: randomUUID(),
      status: 'countdown',
      stageIndex: -1,
      deadlineAt: null,
      startedAt: this.#now(),
      finishedAt: null,
      finishReason: null,
      players: new Map(players.map(({ playerId }) => [playerId, {
        playerId,
        lives: this.#settings.startingLives,
        eliminated: false,
        furthestStage: 0,
        submission: null,
        lastInputSeq: -1,
        finalSuccessfulSubmissionAt: Number.POSITIVE_INFINITY,
      }])),
      ranking: null,
    };
    return this.publicRoundState();
  }

  openStage() {
    if (!this.#round || this.#round.status === 'finished') {
      return { ok: false, code: ERROR_CODES.ROUND_NOT_ACTIVE };
    }
    if (this.#round.status === 'stage-open') {
      return { ok: false, code: ERROR_CODES.STAGE_CLOSED };
    }

    const nextIndex = this.#round.status === 'countdown'
      ? 0
      : this.#round.stageIndex + 1;

    if (nextIndex >= this.#settings.stageCount || this.alivePlayers().length === 0) {
      return this.endRound('complete');
    }

    this.#round.stageIndex = nextIndex;
    this.#round.status = 'stage-open';
    this.#round.deadlineAt = this.#now() + this.#settings.decisionMs;
    for (const player of this.#round.players.values()) {
      player.submission = null;
    }
    return {
      ok: true,
      roundId: this.#round.roundId,
      stageIndex: this.#round.stageIndex,
      deadlineAt: this.#round.deadlineAt,
      aliveCount: this.alivePlayers().length,
    };
  }

  submitMove(input) {
    if (!this.#round || this.#round.status !== 'stage-open') {
      return { ok: false, code: ERROR_CODES.ROUND_NOT_ACTIVE };
    }
    if (input.roundId !== this.#round.roundId) {
      return { ok: false, code: ERROR_CODES.ROUND_ID_STALE };
    }
    if (input.stageIndex !== this.#round.stageIndex) {
      return { ok: false, code: ERROR_CODES.STAGE_STALE };
    }
    const player = this.#round.players.get(input.playerId);
    if (!player || player.eliminated) {
      return { ok: false, code: ERROR_CODES.PLAYER_ELIMINATED };
    }
    if (!Number.isSafeInteger(input.inputSeq) || input.inputSeq <= player.lastInputSeq) {
      return { ok: false, code: ERROR_CODES.INPUT_REPLAYED };
    }
    if (player.submission) {
      return { ok: false, code: ERROR_CODES.MOVE_ALREADY_SUBMITTED };
    }
    if (!['L', 'R'].includes(input.side)) {
      return { ok: false, code: ERROR_CODES.STAGE_STALE };
    }

    player.lastInputSeq = input.inputSeq;
    player.submission = { side: input.side, submittedAt: this.#now() };
    return { ok: true, stageIndex: this.#round.stageIndex };
  }

  resolveStage(reason = 'deadline') {
    if (!this.#round || this.#round.status !== 'stage-open') {
      return { ok: false, code: ERROR_CODES.ROUND_NOT_ACTIVE };
    }

    const stageIndex = this.#round.stageIndex;
    const safeSide = this.#pattern[stageIndex];
    const outcomes = {};

    for (const player of this.#round.players.values()) {
      if (player.eliminated) continue;

      if (!player.submission) {
        player.lives -= 1;
        if (player.lives <= 0) {
          player.lives = 0;
          player.eliminated = true;
          outcomes[player.playerId] = 'eliminated';
        } else {
          outcomes[player.playerId] = 'timeout';
        }
        continue;
      }

      if (player.submission.side === safeSide) {
        player.furthestStage = Math.max(player.furthestStage, stageIndex + 1);
        player.finalSuccessfulSubmissionAt = player.submission.submittedAt;
        outcomes[player.playerId] = 'safe';
      } else {
        player.lives -= 1;
        if (player.lives <= 0) {
          player.lives = 0;
          player.eliminated = true;
          outcomes[player.playerId] = 'eliminated';
        } else {
          outcomes[player.playerId] = 'broken';
        }
      }
    }

    const isLastStage = stageIndex >= this.#settings.stageCount - 1;
    const noSurvivors = this.alivePlayers().length === 0;
    this.#round.status = isLastStage || noSurvivors ? 'finished' : 'stage-reveal';
    this.#round.deadlineAt = null;

    if (this.#round.status === 'finished') {
      this.#round.finishedAt = this.#now();
      this.#round.finishReason = noSurvivors ? 'all-eliminated' : 'bridge-complete';
      this.#round.ranking = this.#computeRanking();
    }

    return {
      ok: true,
      roundId: this.#round.roundId,
      stageIndex,
      reason,
      safeSide,
      outcomes,
      finished: this.#round.status === 'finished',
      ranking: this.#round.ranking ? structuredClone(this.#round.ranking) : null,
    };
  }

  endRound(reason = 'host-ended') {
    if (!this.#round) return { ok: false, code: ERROR_CODES.ROUND_NOT_ACTIVE };
    this.#round.status = 'finished';
    this.#round.deadlineAt = null;
    this.#round.finishedAt = this.#now();
    this.#round.finishReason = reason;
    this.#round.ranking = this.#computeRanking();
    return {
      ok: true,
      roundId: this.#round.roundId,
      reason,
      ranking: structuredClone(this.#round.ranking),
    };
  }

  publicRoundState() {
    if (!this.#round) return null;
    return {
      roundId: this.#round.roundId,
      status: this.#round.status,
      stageIndex: this.#round.stageIndex,
      deadlineAt: this.#round.deadlineAt,
      players: [...this.#round.players.values()].map(copyPlayer),
      ranking: this.#round.ranking ? structuredClone(this.#round.ranking) : null,
    };
  }

  privatePlayerState(playerId) {
    if (!this.#round) return null;
    const player = this.#round.players.get(playerId);
    if (!player) return null;
    return {
      ...copyPlayer(player),
      roundId: this.#round.roundId,
      stageIndex: this.#round.stageIndex,
      submission: player.submission ? { ...player.submission } : null,
    };
  }

  alivePlayers() {
    if (!this.#round) return [];
    return [...this.#round.players.values()].filter((player) => !player.eliminated);
  }

  #computeRanking() {
    const players = [...this.#round.players.values()];
    players.sort((a, b) => {
      const aSurvived = a.furthestStage >= this.#settings.stageCount && !a.eliminated;
      const bSurvived = b.furthestStage >= this.#settings.stageCount && !b.eliminated;
      if (aSurvived !== bSurvived) return aSurvived ? -1 : 1;
      if (a.furthestStage !== b.furthestStage) return b.furthestStage - a.furthestStage;
      if (a.lives !== b.lives) return b.lives - a.lives;
      if (a.finalSuccessfulSubmissionAt !== b.finalSuccessfulSubmissionAt) {
        return a.finalSuccessfulSubmissionAt - b.finalSuccessfulSubmissionAt;
      }
      return a.playerId.localeCompare(b.playerId);
    });
    return players.map((player, index) => ({
      place: index + 1,
      playerId: player.playerId,
      lives: player.lives,
      eliminated: player.eliminated,
      furthestStage: player.furthestStage,
    }));
  }
}
