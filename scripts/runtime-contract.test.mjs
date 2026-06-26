import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPlugin } from '../runtime/game-runtime.js';

const root = path.resolve(import.meta.dirname, '..');
const gameIds = (await readdir(path.join(root, 'games'))).sort();

for (const id of gameIds) {
  test(`${id} satisfies the unified runtime contract`, async () => {
    const sourceManifest = JSON.parse(await readFile(path.join(root, 'games', id, 'manifest.json'), 'utf8'));
    const manifest = {
      ...sourceManifest,
      version: '1.1.0.0',
      rules: { summary: `${sourceManifest.name} rules`, intents: ['answer', 'guess', 'answer_text', 'submit_order', 'advance'] },
    };
    const plugin = createPlugin(manifest);
    const runtime = plugin.createRuntime();
    runtime.configure({ sessionId: 'session-1', gameRunId: `run-${id}`, settings: { allowBots: true } });
    runtime.seatPlayers([{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]);
    runtime.start();

    assert.equal(runtime.gameType, id);
    assert.equal(runtime.publicState().gameType, id);
    assert.equal(runtime.privateState('p1').seated, true);
    assert.equal(runtime.privateState('late-player').seated, false);
    assert.deepEqual(runtime.legalIntents('late-player'), []);
    assert.ok(runtime.legalIntents('p1').length > 0);

    const legal = runtime.legalIntents('p1')[0];
    const intent = legal.type === 'guess'
      ? { ...legal, amount: Number.isFinite(Number(legal.amount)) ? Number(legal.amount) : 1000 }
      : legal.type === 'answer_text'
        ? { ...legal, text: typeof legal.text === 'string' ? legal.text : 'test' }
        : { ...legal };
    assert.equal(runtime.handleIntent('p1', intent, false), true);
    if ('submitted' in runtime.privateState('p1')) assert.equal(runtime.privateState('p1').submitted, true);
    assert.equal(runtime.handleIntent('p1', intent, false), false);

    const snapshot = runtime.snapshot();
    const restored = plugin.createRuntime();
    restored.configure({ sessionId: 'session-1', gameRunId: `run-${id}`, settings: {} });
    restored.seatPlayers([]);
    restored.start();
    restored.restore(snapshot);
    assert.deepEqual(restored.publicState(), runtime.publicState());
    assert.ok(Array.isArray(restored.finish().winnerPlayerIds));
    restored.dispose();
    runtime.dispose();
  });
}

test('connect-4 enforces turns, drops counters and detects a horizontal win', async () => {
  const runtime = createRuntimeFor('connect-4');
  runtime.handleIntent('p1', { type: 'drop', column: 0 }, false);
  runtime.handleIntent('p2', { type: 'drop', column: 0 }, false);
  runtime.handleIntent('p1', { type: 'drop', column: 1 }, false);
  runtime.handleIntent('p2', { type: 'drop', column: 1 }, false);
  runtime.handleIntent('p1', { type: 'drop', column: 2 }, false);
  runtime.handleIntent('p2', { type: 'drop', column: 2 }, false);
  assert.equal(runtime.handleIntent('p1', { type: 'drop', column: 3 }, false), true);
  assert.equal(runtime.publicState().phase, 'finished');
  assert.deepEqual(runtime.publicState().winnerPlayerIds, ['p1']);
  assert.equal(runtime.publicState().winningCells.length, 4);
});

test('endless tic tac toe places marks and detects a diagonal win', async () => {
  const runtime = createRuntimeFor('ettt');
  for (const [playerId, cell] of [['p1', 0], ['p2', 1], ['p1', 4], ['p2', 2]]) {
    assert.equal(runtime.handleIntent(playerId, { type: 'place', cell }, false), true);
  }
  assert.equal(runtime.handleIntent('p1', { type: 'place', cell: 8 }, false), true);
  assert.equal(runtime.publicState().phase, 'finished');
  assert.deepEqual(runtime.publicState().winnerPlayerIds, ['p1']);
});

test('ludo rolls, brings a token out, rotates turns and rejects illegal movement', async () => {
  const runtime = createRuntimeFor('ludo');
  assert.equal(runtime.handleIntent('p1', { type: 'move_token', tokenIndex: 0 }, false), false);
  assert.equal(runtime.handleIntent('p1', { type: 'roll' }, false), true);
  assert.equal(runtime.publicState().pendingRoll, 6);
  assert.equal(runtime.handleIntent('p1', { type: 'move_token', tokenIndex: 0 }, false), true);
  assert.equal(runtime.privateState('p1').tokens[0], 0);
  assert.equal(runtime.publicState().currentPlayerId, 'p1');
  runtime.handleIntent('p1', { type: 'roll' }, false);
  runtime.handleIntent('p1', { type: 'move_token', tokenIndex: 0 }, false);
  assert.equal(runtime.publicState().currentPlayerId, 'p2');
});

test('whot keeps hands private, plays legal cards and rejects illegal cards', async () => {
  const runtime = createRuntimeFor('whot');
  const p1 = runtime.privateState('p1');
  const p2 = runtime.privateState('p2');
  assert.ok(p1.hand.length > 0);
  assert.ok(p2.hand.length > 0);
  assert.equal(JSON.stringify(runtime.publicState()).includes(p1.hand[0].id), false);
  const legal = p1.legalIntents.find((intent) => intent.type === 'play_card') ?? p1.legalIntents[0];
  assert.equal(runtime.handleIntent('p1', legal, false), true);
  assert.equal(runtime.handleIntent('p2', { type: 'play_card', cardId: 'not-in-hand' }, false), false);
});

function createRuntimeFor(id) {
  const runtime = createPlugin({
    id,
    name: id,
    emoji: '🎮',
    version: '1.2.0.0',
    minPlayers: 2,
    maxPlayers: 8,
    capabilities: { bots: true, audience: true, hints: true, restore: true },
    rules: { summary: `${id} rules`, intents: [] },
  }).createRuntime();
  runtime.configure({ sessionId: 'session-1', gameRunId: `run-${id}`, settings: { allowBots: true } });
  runtime.seatPlayers([{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Tobi' }]);
  runtime.start();
  return runtime;
}
