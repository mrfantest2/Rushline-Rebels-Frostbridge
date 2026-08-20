# Frostbridge Multiplayer Preflight

The canonical release-readiness gate is `.github/workflows/main.yml` plus `scripts/preflight.py`.

## Canonical CI sequence

Every pull request to `main`, push to `main`, or manual workflow dispatch runs:

1. Node.js 22 + Python 3.12 setup.
2. `npm ci --ignore-scripts --no-audit --no-fund` from the committed `package-lock.json`.
3. `npm test` for unit, protocol, route, room, reconnect, secrecy, replay/idempotency, and real multi-client integration coverage.
4. `python scripts/preflight.py` for repository, syntax, browser-surface, dependency-boundary, and live Node-server HTTP readiness checks.
5. Packaging of the deployable runtime as `frostbridge-multiplayer-<sha>.tar.gz`.
6. Artifact upload only after every earlier gate passes.

## Automated checks

The production preflight verifies:

- required package, lockfile, server modules, browser surfaces, tests, documentation, and assets are present and non-empty
- all six Rebel character assets and all three design-board SVGs parse as valid XML
- the preserved single-player demo still contains its required gameplay DOM and logic markers
- Host, TV, and Player pages contain the expected controls and role contracts
- the TV client persists no mutation credential
- runtime files contain no dependency on the private Fantest Party monorepo
- every runtime JavaScript file passes `node --check`
- the package declares Node.js 22+, Express, Socket.IO, and Socket.IO Client and the npm lockfile is valid
- the real Node/Socket.IO server reaches `/readyz`
- live HTTP smoke tests return 200 and expected content for `/healthz`, `/readyz`, `/`, `/host/`, `/tv/?room=ABCDE`, `/play/`, and a character asset
- the full Node test suite includes a real multi-client room with Host, TV, multiple players, reconnect, late joining, stale/replayed input rejection, hidden-state secrecy, ranking, and room reuse

## Release artifact boundary

The deployable tarball contains only runtime and operational files:

- `package.json`
- `package-lock.json`
- `server/`
- `public/`
- `assets/`
- `README.md`
- `PRE-FLIGHT.md`
- `DEPLOYMENT.md`

It excludes `node_modules`, tests, Git metadata, environment files, local logs, and credentials.

## Product boundary

Passing this gate means the first host-authoritative multiplayer foundation is internally consistent, tested, packageable, and ready for deployment review. It does **not** add deferred features such as persistent accounts/history, analytics, matchmaking, character-specific abilities, native mobile/TV clients, alternate game modes, or horizontal multi-process scaling.
