# Frostbridge Full Preflight

This repository uses `.github/workflows/main.yml` plus `scripts/preflight.py` as the release-readiness gate for the current browser prototype.

## Automated gates

- required repository files present and non-empty
- all six Rebel character assets present
- all three design-board images present
- SVG files parse as valid XML
- required gameplay DOM elements present
- required Frostbridge game-logic markers present
- no dependency on the private Fantest Party monorepo
- local HTML asset references resolve inside the repository
- inline JavaScript passes `node --check`
- local HTTP server returns the Frostbridge page successfully
- successful runs produce a static release artifact

## Current product boundary

Passing this preflight means the standalone browser prototype is internally consistent and packageable. It does **not** mean the future multiplayer production target is complete. TV multiplayer, room-code networking, player-phone controllers, authoritative host state, realtime synchronization, character abilities, reconnect handling, telemetry and production deployment remain separate implementation phases.
