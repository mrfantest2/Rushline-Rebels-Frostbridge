# Frostbridge Multiplayer Deployment

## Runtime

The first production milestone runs as exactly **one Node.js 22 process**.

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
PORT=3000 MAX_ROOMS=100 npm start
```

Environment variables:

- `PORT` — HTTP/WebSocket listen port. Default: `3000`.
- `MAX_ROOMS` — maximum simultaneous in-memory rooms per process. Default: `100`.

The application exposes:

- `GET /healthz` — process health
- `GET /readyz` — readiness and protocol version
- `/host/` — authenticated host controller
- `/tv/?room=ABCDE` — read-only room display
- `/play/?room=ABCDE` — player phone controller
- `/` — preserved standalone Frostbridge demo

## Reverse proxy requirements

The reverse proxy or tunnel must forward normal HTTP **and WebSocket upgrade traffic** to the same Node process. Socket.IO must not be routed to a different process than the HTTP room request because room state is currently in memory.

For Cloudflare Tunnel, Nginx, Caddy, or another reverse proxy, preserve the request host/proto headers and allow WebSocket upgrades. TLS can terminate at the proxy; the Node process may stay on private HTTP behind it.

## Single-process boundary

Do not run multiple Frostbridge application workers behind a load balancer in this milestone. There is no shared room datastore or cross-process Socket.IO adapter yet.

Before horizontal scaling, add both:

1. shared authoritative room/session state, and
2. shared Socket.IO pub/sub/adapter infrastructure.

Only after those exist may multiple processes serve the same room-code namespace safely.

## State lifetime

Room state is intentionally ephemeral:

- player reconnect grace: 90 seconds
- inactive lobby/finished room expiry: 30 minutes
- hard room lifetime: 4 hours

Restarting the Node process closes all active rooms. Persistent match history and account state are outside this milestone.

## Secrets and logs

No external secret is required for the base multiplayer server. Host/player mutation tokens are generated at runtime, stored hashed in memory server-side, and never intentionally logged. Room codes are locators, not authorization credentials.

## Release artifact

The canonical GitHub Actions workflow produces `frostbridge-multiplayer-<sha>.tar.gz` containing runtime code, locked dependency manifests, public surfaces, assets, and deployment/readiness documentation. Tests and `node_modules` are excluded.
