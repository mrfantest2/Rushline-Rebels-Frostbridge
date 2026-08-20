export const PROTOCOL_VERSION = 1;

export const CHARACTER_IDS = Object.freeze([
  'nadir',
  'zayd',
  'jolyne',
  'dana',
  'sami',
  'rami',
]);

export const ERROR_CODES = Object.freeze({
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_CLOSED: 'ROOM_CLOSED',
  HOST_AUTH_FAILED: 'HOST_AUTH_FAILED',
  PLAYER_AUTH_FAILED: 'PLAYER_AUTH_FAILED',
  PLAYER_NAME_INVALID: 'PLAYER_NAME_INVALID',
  CHARACTER_INVALID: 'CHARACTER_INVALID',
  ROUND_NOT_ACTIVE: 'ROUND_NOT_ACTIVE',
  ROUND_ID_STALE: 'ROUND_ID_STALE',
  STAGE_STALE: 'STAGE_STALE',
  STAGE_CLOSED: 'STAGE_CLOSED',
  PLAYER_ELIMINATED: 'PLAYER_ELIMINATED',
  MOVE_ALREADY_SUBMITTED: 'MOVE_ALREADY_SUBMITTED',
  INPUT_REPLAYED: 'INPUT_REPLAYED',
  PROTOCOL_VERSION_UNSUPPORTED: 'PROTOCOL_VERSION_UNSUPPORTED',
  SETTINGS_INVALID: 'SETTINGS_INVALID',
});

export const EVENTS = Object.freeze({
  HOST_CREATE_ROOM: 'host:create-room',
  HOST_RESTORE: 'host:restore',
  HOST_UPDATE_SETTINGS: 'host:update-settings',
  HOST_START_ROUND: 'host:start-round',
  HOST_END_ROUND: 'host:end-round',
  HOST_CLOSE_ROOM: 'host:close-room',
  TV_WATCH: 'tv:watch',
  PLAYER_JOIN: 'player:join',
  PLAYER_RESTORE: 'player:restore',
  PLAYER_SET_CHARACTER: 'player:set-character',
  PLAYER_SET_READY: 'player:set-ready',
  PLAYER_MOVE: 'player:move',
  ROOM_SNAPSHOT: 'room:snapshot',
  ROOM_CLOSED: 'room:closed',
  PLAYER_PRIVATE_STATE: 'player:private-state',
  ROUND_COUNTDOWN: 'round:countdown',
  STAGE_OPEN: 'stage:open',
  STAGE_SUBMISSION_COUNT: 'stage:submission-count',
  STAGE_REVEAL: 'stage:reveal',
  ROUND_FINISHED: 'round:finished',
  SERVER_ERROR: 'server:error',
});
