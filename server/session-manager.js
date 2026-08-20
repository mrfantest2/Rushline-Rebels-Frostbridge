import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function issueToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(rawToken) {
  return createHash('sha256').update(String(rawToken)).digest('hex');
}

export function verifyToken(rawToken, expectedDigest) {
  if (typeof rawToken !== 'string' || typeof expectedDigest !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(expectedDigest)) return false;
  const actual = Buffer.from(hashToken(rawToken), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createCredential() {
  const token = issueToken();
  return { token, digest: hashToken(token) };
}
