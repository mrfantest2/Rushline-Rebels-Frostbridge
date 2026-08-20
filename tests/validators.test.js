import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRoomCode,
  validateDisplayName,
  validateCharacterId,
  validateMovePayload,
  validateSettingsPatch,
} from '../server/validators.js';
import { DEFAULT_SETTINGS } from '../server/config.js';

test('display name is trimmed and length constrained', () => {
  assert.deepEqual(validateDisplayName('  Dana  '), { ok: true, value: 'Dana' });
  assert.equal(validateDisplayName('').ok, false);
  assert.equal(validateDisplayName('x'.repeat(33)).ok, false);
});

test('character id accepts only canonical rebels', () => {
  assert.deepEqual(validateCharacterId('dana'), { ok: true, value: 'dana' });
  assert.equal(validateCharacterId('layla').ok, false);
});

test('room code normalizes valid unambiguous codes', () => {
  assert.deepEqual(validateRoomCode(' ab2c3 '), { ok: true, value: 'AB2C3' });
  assert.equal(validateRoomCode('AB0C3').ok, false);
  assert.equal(validateRoomCode('ABC').ok, false);
});

test('move payload constrains round stage sequence and side', () => {
  const good = validateMovePayload({ roundId: 'r1', stageIndex: 2, inputSeq: 7, side: 'L' });
  assert.deepEqual(good, {
    ok: true,
    value: { roundId: 'r1', stageIndex: 2, inputSeq: 7, side: 'L' },
  });
  assert.equal(validateMovePayload({ roundId: 'r1', stageIndex: 2, inputSeq: 7, side: 'X' }).ok, false);
  assert.equal(validateMovePayload({ roundId: 'r1', stageIndex: -1, inputSeq: 7, side: 'L' }).ok, false);
  assert.equal(validateMovePayload({ roundId: '', stageIndex: 0, inputSeq: 1, side: 'L' }).ok, false);
});

test('settings patch preserves defaults and enforces milestone bounds', () => {
  assert.deepEqual(validateSettingsPatch({ decisionMs: 5000 }), {
    ok: true,
    value: { ...DEFAULT_SETTINGS, decisionMs: 5000 },
  });
  assert.equal(validateSettingsPatch({ maxPlayers: 7 }).ok, false);
  assert.equal(validateSettingsPatch({ decisionMs: 1000 }).ok, false);
  assert.equal(validateSettingsPatch({ unknown: 1 }).ok, false);
});
