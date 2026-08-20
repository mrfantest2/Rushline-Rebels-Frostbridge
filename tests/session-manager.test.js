import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCredential,
  hashToken,
  issueToken,
  verifyToken,
} from '../server/session-manager.js';

test('issued token verifies only against its own digest', () => {
  const a = createCredential();
  const b = createCredential();
  assert.notEqual(a.token, b.token);
  assert.equal(verifyToken(a.token, a.digest), true);
  assert.equal(verifyToken(b.token, a.digest), false);
});

test('tokens provide 256 bits of random material and hashes are deterministic', () => {
  const token = issueToken();
  assert.ok(token.length >= 43);
  assert.equal(hashToken(token), hashToken(token));
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
});

test('malformed verification inputs fail closed', () => {
  const { token, digest } = createCredential();
  assert.equal(verifyToken(null, digest), false);
  assert.equal(verifyToken(token, 'not-a-digest'), false);
  assert.equal(verifyToken('', digest), false);
});
