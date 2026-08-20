import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('multiplayer browser surfaces and character assets serve successfully', async (t) => {
  const app = createApp();
  const port = await app.start(0);
  t.after(async () => app.stop());
  const base = `http://127.0.0.1:${port}`;
  for (const path of ['/', '/host/', '/tv/?room=ABCDE', '/play/', '/assets/characters/dana.svg']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, `${path} should return HTTP 200`);
    assert.ok((await response.text()).length > 0, `${path} should not be empty`);
  }
});
