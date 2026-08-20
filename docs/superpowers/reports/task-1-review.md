# Task 1 Review Gate

Review criteria:

- Node runtime floor remains 22.
- Protocol constants match the approved spec.
- Canonical character IDs are unchanged.
- Room/name/character/move/settings validation rejects malformed values without mutation.
- No multiplayer authority is introduced client-side.
- Validator tests pass under GitHub Actions.
- Generated npm lockfile is captured from the CI environment rather than fabricated locally.
