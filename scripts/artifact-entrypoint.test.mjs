import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('generated server entrypoint imports the packaged runtime location', async () => {
  const builder = await readFile(new URL('./build-catalog.mjs', import.meta.url), 'utf8');
  assert.match(builder, /createPlugin \} from '\.\/game-runtime\.js'/);
  assert.doesNotMatch(builder, /createPlugin \} from '\.\/runtime\/game-runtime\.js'/);
});
