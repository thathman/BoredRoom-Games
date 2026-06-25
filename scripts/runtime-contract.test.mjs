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
    assert.equal(runtime.privateState('p1').submitted, false);
    assert.equal(runtime.privateState('p1').seated, true);
    assert.equal(runtime.privateState('late-player').seated, false);
    assert.deepEqual(runtime.legalIntents('late-player'), []);
    assert.ok(runtime.legalIntents('p1').length > 0);

    const legal = runtime.legalIntents('p1')[0];
    const intent = legal.type === 'answer'
      ? { type: 'answer', optionIndex: legal.optionIndex }
      : legal.type === 'guess'
        ? { type: 'guess', amount: 1000 }
        : legal.type === 'answer_text'
          ? { type: 'answer_text', text: 'test' }
          : { type: 'submit_order', orderedIndexes: [0, 1, 2, 3] };
    assert.equal(runtime.handleIntent('p1', intent, false), true);
    assert.equal(runtime.privateState('p1').submitted, true);
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
