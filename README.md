# Rushline Rebels: Frostbridge

**Rushline Rebels: Frostbridge** is evolving from the original standalone ice-bridge prototype into a host-authoritative multiplayer party game.

## Multiplayer surfaces

The production branch now exposes three coordinated browser roles from one Node.js + Socket.IO server:

- `/host/` — create or restore a room, configure the round, copy the player join link, start/end the round, and monitor players, lives, stage timing, submissions, and ranking.
- `/tv/?room=ABCDE` — read-only shared display for the room lobby, countdown, bridge, submitted/locked indicators, synchronized reveal, eliminations, and final ranking. The TV stores no host or player credential.
- `/play/?room=ABCDE` — mobile player flow for room/name/character join, ready state, LEFT/RIGHT decisions, private locked state, reveal result, lives, elimination, reconnect restoration, and final placement.

The original playable single-player concept remains available at `/` as the visual/demo landing experience.

### Development run

```bash
npm install
npm start
```

Default server: `http://localhost:3000`

Example local surfaces:

```text
Host:   http://localhost:3000/host/
TV:     http://localhost:3000/tv/?room=ABCDE
Player: http://localhost:3000/play/?room=ABCDE
Demo:   http://localhost:3000/
```

Player and host browser sessions explicitly restore their authenticated room slot after transport reconnects. TV clients re-subscribe to the room after reconnect and never receive a mutation credential.

## Multiplayer authority model

The Node.js server owns the room lifecycle, hidden bridge pattern, stage timers, submitted choices, lives, eliminations, ranking, and outcomes. Clients render public/private state and submit intent; they do not decide the safe side or resolve gameplay.

Important rules in the current milestone:

- 5-character room codes
- up to 6 players
- 10 stages by default
- 3 starting lives
- simultaneous private LEFT/RIGHT submissions
- no safe-side or submitted-side leakage before reveal
- host and player mutation credentials stored as server-side digests
- 90-second player reconnect grace
- late joiners spectate the active round and become eligible in the next lobby
- disconnected alive players remain counted until the stage deadline, preventing an early reveal advantage

## Visual mockups

### TV / host gameplay

![Frostbridge TV gameplay](assets/mockups/tv-gameplay.svg)

### Phone controller

![Frostbridge phone controller](assets/mockups/phone-controller.svg)

### Character selection / lobby

![Frostbridge character selection](assets/mockups/character-select.svg)

## Rushline Rebels cast

- Nadir — The Anchor
- Zayd — The Instinct
- Jolyne — The Analyst
- Dana — The Challenger
- Sami — The Decoder
- Rami — The Connector

Character artwork is stored in `assets/characters/` so this repository remains self-contained.

## Original standalone prototype

The preserved demo demonstrates character selection, randomized safe/breaking panels, lives, countdown timer, progression HUD, tile failure animation, fall/win states, and responsive desktop/mobile layouts. It is intentionally separate from multiplayer authority.

## Production roadmap

Current foundation: authoritative realtime Classic Frostbridge with Host, TV, and Player browser surfaces.

Follow-on phases remain intentionally separate: character-specific abilities, alternate modes such as Blitz/Memory Trail/Team Relay/Last Rebel Standing, persistent match history, accounts, analytics, native clients, matchmaking, and horizontal multi-process scaling.
