import { CHARACTER_IDS, ERROR_CODES } from './protocol.js';
import { DEFAULT_SETTINGS } from './config.js';

const ok = (value) => ({ ok: true, value });
const bad = (code) => ({ ok: false, code });

export function validateDisplayName(value) {
  if (typeof value !== 'string') return bad(ERROR_CODES.PLAYER_NAME_INVALID);
  const name = value.trim();
  return name.length >= 1 && name.length <= 32
    ? ok(name)
    : bad(ERROR_CODES.PLAYER_NAME_INVALID);
}

export function validateCharacterId(value) {
  return CHARACTER_IDS.includes(value)
    ? ok(value)
    : bad(ERROR_CODES.CHARACTER_INVALID);
}

export function validateRoomCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code)
    ? ok(code)
    : bad(ERROR_CODES.ROOM_NOT_FOUND);
}

export function validateMovePayload(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.roundId !== 'string' ||
    value.roundId.length < 1 ||
    !Number.isInteger(value.stageIndex) ||
    value.stageIndex < 0 ||
    !Number.isSafeInteger(value.inputSeq) ||
    value.inputSeq < 0 ||
    !['L', 'R'].includes(value.side)
  ) {
    return bad(ERROR_CODES.STAGE_STALE);
  }

  return ok({
    roundId: value.roundId,
    stageIndex: value.stageIndex,
    inputSeq: value.inputSeq,
    side: value.side,
  });
}

export function validateSettingsPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return bad(ERROR_CODES.SETTINGS_INVALID);
  }

  const allowed = new Set([
    'maxPlayers',
    'stageCount',
    'startingLives',
    'decisionMs',
    'revealMs',
    'countdownMs',
  ]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return bad(ERROR_CODES.SETTINGS_INVALID);
  }

  const next = { ...DEFAULT_SETTINGS, ...value };
  const valid =
    Number.isInteger(next.maxPlayers) &&
    next.maxPlayers >= 1 &&
    next.maxPlayers <= 6 &&
    Number.isInteger(next.stageCount) &&
    next.stageCount >= 1 &&
    next.stageCount <= 30 &&
    Number.isInteger(next.startingLives) &&
    next.startingLives >= 1 &&
    next.startingLives <= 9 &&
    Number.isInteger(next.decisionMs) &&
    next.decisionMs >= 2000 &&
    next.decisionMs <= 30000 &&
    Number.isInteger(next.revealMs) &&
    next.revealMs >= 250 &&
    next.revealMs <= 10000 &&
    Number.isInteger(next.countdownMs) &&
    next.countdownMs >= 0 &&
    next.countdownMs <= 10000;

  return valid ? ok(next) : bad(ERROR_CODES.SETTINGS_INVALID);
}
