import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('catalog contains 15 unique four-part-version games', async () => {
  const catalog = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.games.length, 15);
  assert.equal(new Set(catalog.games.map((game) => game.id)).size, 15);
  for (const game of catalog.games) {
    assert.match(game.version, /^\d+\.\d+\.\d+\.\d+$/);
    assert.match(game.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(game.artifact.signature);
  }
});
