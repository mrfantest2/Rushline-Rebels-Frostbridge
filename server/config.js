export const DEFAULT_SETTINGS = Object.freeze({
  maxPlayers: 6,
  stageCount: 10,
  startingLives: 3,
  decisionMs: 8000,
  revealMs: 1800,
  countdownMs: 3000,
});

export const CONFIG = Object.freeze({
  port: Number(process.env.PORT || 3000),
  maxRooms: Number(process.env.MAX_ROOMS || 100),
  reconnectGraceMs: 90_000,
  inactiveExpiryMs: 30 * 60_000,
  hardRoomLifetimeMs: 4 * 60 * 60_000,
});
