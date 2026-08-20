import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared Frostbridge design system exposes production presentation primitives', () => {
  const css = read('public/shared/ui.css');
  for (const marker of ['--frost-glow', '.screen-frame', '.hud-cluster', '.glass-panel', '.status-orb']) {
    assert.ok(css.includes(marker), `missing shared UI primitive: ${marker}`);
  }
});

test('TV surface exposes cinematic arena and player presentation regions', () => {
  const html = read('public/tv/index.html');
  for (const marker of ['class="tv-stage"', 'class="bridge-frame"', 'class="player-strip"', 'class="tv-hud"']) {
    assert.ok(html.includes(marker), `missing TV presentation region: ${marker}`);
  }
  for (const id of ['roomCode', 'phase', 'timer', 'bridge', 'roster', 'ranking']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing preserved TV contract id: ${id}`);
  }
});

test('player surface exposes vertical game HUD and oversized decision controls', () => {
  const html = read('public/play/index.html');
  for (const marker of ['class="phone-shell"', 'class="player-identity"', 'class="choice-panel"', 'class="player-hud"']) {
    assert.ok(html.includes(marker), `missing player presentation region: ${marker}`);
  }
  for (const id of ['joinCard', 'gameCard', 'leftBtn', 'rightBtn', 'readyBtn', 'outcome', 'placement']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing preserved player contract id: ${id}`);
  }
});

test('host surface exposes production control-room hierarchy while retaining control ids', () => {
  const html = read('public/host/index.html');
  for (const marker of ['class="host-hero"', 'class="host-status-strip"', 'class="host-dashboard"', 'class="room-code-panel"']) {
    assert.ok(html.includes(marker), `missing host presentation region: ${marker}`);
  }
  for (const id of ['roomCode', 'createBtn', 'copyBtn', 'startBtn', 'endBtn', 'closeBtn', 'settingsBtn', 'roster', 'ranking']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing preserved host contract id: ${id}`);
  }
});
