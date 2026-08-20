import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { CONFIG } from './config.js';
import { logger as defaultLogger } from './logger.js';
import { RoomManager } from './room-manager.js';
import { bindSocketGateway } from './socket-gateway.js';
import { PROTOCOL_VERSION } from './protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const publicDir = join(root, 'public');
const assetsDir = join(root, 'assets');
const legacyIndex = join(root, 'index.html');
const ROOM_SETTING_KEYS = ['maxPlayers', 'stageCount', 'startingLives', 'decisionMs', 'revealMs', 'countdownMs'];

function pickRoomSettings(overrides = {}) {
  return Object.fromEntries(ROOM_SETTING_KEYS.filter((key) => overrides[key] !== undefined).map((key) => [key, overrides[key]]));
}

class ConfiguredRoomManager extends RoomManager {
  #roomDefaults;

  constructor({ config, roomDefaults }) {
    super({ config });
    this.#roomDefaults = roomDefaults;
  }

  createRoom(input) {
    const result = super.createRoom(input);
    if (!result.ok || Object.keys(this.#roomDefaults).length === 0) return result;
    const room = this.getRoom(result.roomCode);
    room.settings = { ...room.settings, ...this.#roomDefaults };
    result.roomSnapshot = this.roomSnapshot(room);
    return result;
  }
}

export function createApp({ roomManager, configOverrides = {}, logger = defaultLogger } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    serveClient: true,
    cors: { origin: false },
  });

  const roomDefaults = pickRoomSettings(configOverrides);
  const rooms = roomManager || new ConfiguredRoomManager({ config: configOverrides, roomDefaults });
  const gateway = bindSocketGateway({
    io,
    roomManager: rooms,
    logger,
    roomSettingsOverrides: {},
  });

  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, service: 'frostbridge' }));
  app.get('/readyz', (_req, res) => res.status(200).json({ ok: true, protocolVersion: PROTOCOL_VERSION }));
  app.get('/version', (_req, res) => res.status(200).json({ protocolVersion: PROTOCOL_VERSION, version: '0.2.0' }));
  app.use('/assets', express.static(assetsDir, { fallthrough: false, index: false }));
  if (existsSync(publicDir)) app.use(express.static(publicDir));
  app.get('/', (_req, res, next) => {
    const publicIndex = join(publicDir, 'index.html');
    const file = existsSync(publicIndex) ? publicIndex : legacyIndex;
    if (!existsSync(file)) return next();
    return res.sendFile(file);
  });

  const sweepIntervalMs = Number(configOverrides.sweepIntervalMs || 30_000);
  const sweeper = setInterval(() => gateway.sweepExpired(), sweepIntervalMs);
  sweeper.unref?.();

  let boundPort = null;
  async function start(port = Number(configOverrides.port ?? CONFIG.port)) {
    if (httpServer.listening) return boundPort;
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off('error', onError);
        resolve();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, '127.0.0.1');
    });
    boundPort = httpServer.address().port;
    return boundPort;
  }

  async function stop() {
    clearInterval(sweeper);
    gateway.dispose();
    if (io.engine) {
      await new Promise((resolve) => io.close(() => resolve()));
    }
    if (httpServer.listening) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
    boundPort = null;
  }

  return { app, httpServer, io, roomManager: rooms, start, stop };
}

const entryArg = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryArg && import.meta.url === entryArg) {
  const frostbridge = createApp();
  frostbridge.start().then((port) => {
    defaultLogger.info('Frostbridge server listening', { port });
  }).catch((error) => {
    defaultLogger.error('Frostbridge server failed to start', { error: error?.message });
    process.exitCode = 1;
  });
}
