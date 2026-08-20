import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/game-engine.js';
import { ERROR_CODES } from '../server/protocol.js';
import { createTestClock } from './helpers/test-clock.js';

const settings = {
  stageCount: 2,
  startingLives: 2,
  decisionMs: 8000,
  revealMs: 10,
  countdownMs: 0,
};

function engineWithSides(sides, clock = createTestClock(1000)) {
  let i = 0;
  return {
    clock,
    engine: new GameEngine({
      settings,
      randomSide: () => sides[i++] ?? 'L',
      now: clock.now,
    }),
  };
}

test('public state hides unresolved safe side and private pattern', () => {
  const { engine } = engineWithSides(['L', 'R']);
  engine.startRound([{ playerId: 'p1' }]);
  engine.openStage();
  const serialized = JSON.stringify(engine.publicRoundState());
  assert.equal(serialized.includes('safeSide'), false);
  assert.equal(serialized.includes('pattern'), false);
  assert.equal(serialized.includes('"side":"L"'), false);
});

test('resolution applies all submitted choices together', () => {
  const { engine } = engineWithSides(['L', 'R']);
  engine.startRound([{ playerId: 'p1' }, { playerId: 'p2' }]);
  engine.openStage();
  const id = engine.publicRoundState().roundId;
  assert.equal(engine.submitMove({ playerId: 'p1', roundId: id, stageIndex: 0, inputSeq: 1, side: 'L' }).ok, true);
  assert.equal(engine.submitMove({ playerId: 'p2', roundId: id, stageIndex: 0, inputSeq: 1, side: 'R' }).ok, true);
  const reveal = engine.resolveStage('all-submitted');
  assert.equal(reveal.safeSide, 'L');
  assert.equal(reveal.outcomes.p1, 'safe');
  assert.equal(reveal.outcomes.p2, 'broken');
  const publicState = engine.publicRoundState();
  assert.equal(publicState.players.find((p) => p.playerId === 'p1').furthestStage, 1);
  assert.equal(publicState.players.find((p) => p.playerId === 'p2').lives, 1);
});

test('timeout costs one life and zero lives eliminates', () => {
  const { engine } = engineWithSides(['L', 'L']);
  engine.startRound([{ playerId: 'p1' }]);
  engine.openStage();
  let reveal = engine.resolveStage('deadline');
  assert.equal(reveal.outcomes.p1, 'timeout');
  assert.equal(engine.privatePlayerState('p1').lives, 1);

  engine.openStage();
  reveal = engine.resolveStage('deadline');
  assert.equal(reveal.outcomes.p1, 'eliminated');
  assert.equal(engine.privatePlayerState('p1').lives, 0);
  assert.equal(engine.privatePlayerState('p1').eliminated, true);
});

test('stale replay and duplicate submissions are rejected without mutation', () => {
  const { engine } = engineWithSides(['L', 'R']);
  engine.startRound([{ playerId: 'p1' }]);
  engine.openStage();
  const id = engine.publicRoundState().roundId;

  assert.equal(engine.submitMove({ playerId: 'p1', roundId: 'stale', stageIndex: 0, inputSeq: 1, side: 'L' }).code, ERROR_CODES.ROUND_ID_STALE);
  assert.equal(engine.submitMove({ playerId: 'p1', roundId: id, stageIndex: 1, inputSeq: 1, side: 'L' }).code, ERROR_CODES.STAGE_STALE);
  assert.equal(engine.submitMove({ playerId: 'p1', roundId: id, stageIndex: 0, inputSeq: 2, side: 'L' }).ok, true);
  assert.equal(engine.submitMove({ playerId: 'p1', roundId: id, stageIndex: 0, inputSeq: 2, side: 'R' }).code, ERROR_CODES.INPUT_REPLAYED);
  assert.equal(engine.submitMove({ playerId: 'p1', roundId: id, stageIndex: 0, inputSeq: 3, side: 'R' }).code, ERROR_CODES.MOVE_ALREADY_SUBMITTED);
  assert.equal(engine.privatePlayerState('p1').lives, 2);
  assert.equal(engine.privatePlayerState('p1').submission.side, 'L');
});

test('ranking uses survivor, progress, lives, successful timestamp, then player id', () => {
  const clock = createTestClock(1000);
  const { engine } = engineWithSides(['L', 'L'], clock);
  engine.startRound([{ playerId: 'b' }, { playerId: 'a' }, { playerId: 'c' }]);
  engine.openStage();
  const id = engine.publicRoundState().roundId;
  clock.set(1100);
  engine.submitMove({ playerId: 'b', roundId: id, stageIndex: 0, inputSeq: 1, side: 'L' });
  clock.set(1050);
  engine.submitMove({ playerId: 'a', roundId: id, stageIndex: 0, inputSeq: 1, side: 'L' });
  clock.set(1200);
  engine.submitMove({ playerId: 'c', roundId: id, stageIndex: 0, inputSeq: 1, side: 'R' });
  engine.resolveStage('all-submitted');

  engine.openStage();
  clock.set(1300);
  engine.submitMove({ playerId: 'b', roundId: id, stageIndex: 1, inputSeq: 2, side: 'L' });
  clock.set(1250);
  engine.submitMove({ playerId: 'a', roundId: id, stageIndex: 1, inputSeq: 2, side: 'L' });
  clock.set(1400);
  engine.submitMove({ playerId: 'c', roundId: id, stageIndex: 1, inputSeq: 2, side: 'R' });
  const reveal = engine.resolveStage('all-submitted');

  assert.equal(reveal.finished, true);
  assert.deepEqual(reveal.ranking.map((x) => x.playerId), ['a', 'b', 'c']);
});
