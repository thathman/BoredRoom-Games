#!/usr/bin/env node
// Verify that every catalog artifact's sha256 and ed25519 signature match the built .tgz and the
// trusted public key the server uses. Run after `npm run build` (release.sh does this).
//
// Set BOREDROOM_GAMES_PUBLIC_KEY to check against a specific key; otherwise the production key
// the server ships with is used (so a release built with the wrong private key fails loudly).
import { createHash, createPublicKey, verify } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const PUBLIC_KEY = process.env.BOREDROOM_GAMES_PUBLIC_KEY?.trim() || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3GPtGkub/09AvQgAL4a4hmBPnolthU+p3TbytYFC0PU=
-----END PUBLIC KEY-----`;

const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
const key = createPublicKey(PUBLIC_KEY);
let failures = 0;
const extractionRoot = await mkdtemp(path.join(tmpdir(), 'boredroom-release-verify-'));

try {
  for (const game of catalog.games) {
    const file = path.join(root, 'dist', `${game.id}-${game.version}.tgz`);
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      console.error(`✗ ${game.id}: artifact missing (${file})`);
      failures += 1;
      continue;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== game.artifact.sha256) {
      console.error(`✗ ${game.id}: sha256 mismatch`);
      failures += 1;
      continue;
    }
    const ok = verify(null, Buffer.from(sha256, 'utf8'), key, Buffer.from(game.artifact.signature, 'base64'));
    if (!ok) {
      console.error(`✗ ${game.id}: signature does not verify against the trusted public key`);
      failures += 1;
      continue;
    }

    const destination = path.join(extractionRoot, game.id);
    const extracted = spawnSync('tar', ['-xzf', file, '-C', extractionRoot], { encoding: 'utf8' });
    if (extracted.status !== 0) {
      console.error(`✗ ${game.id}: artifact could not be extracted: ${extracted.stderr.trim()}`);
      failures += 1;
      continue;
    }
    // Move each extraction into a unique import path by renaming the shared source directory.
    await mkdir(destination, { recursive: true });
    await cp(path.join(extractionRoot, 'source'), path.join(destination, 'source'), { recursive: true });
    await rm(path.join(extractionRoot, 'source'), { recursive: true, force: true });
    await rm(path.join(extractionRoot, 'manifest.json'), { force: true });
    const module = await import(`${pathToFileURL(path.join(destination, game.entrypoints.server)).href}?verify=${Date.now()}`);
    const plugin = module.gamePlugin ?? module.default;
    if (plugin?.id !== game.id || plugin?.version !== game.version || typeof plugin?.createRuntime !== 'function') {
      console.error(`✗ ${game.id}: extracted plugin entrypoint is not loadable`);
      failures += 1;
      continue;
    }
    const runtime = plugin.createRuntime();
    if (runtime?.gameType !== game.id || typeof runtime?.handleIntent !== 'function') {
      console.error(`✗ ${game.id}: extracted plugin did not create the expected runtime`);
      failures += 1;
      continue;
    }
    console.log(`✓ ${game.id}@${game.version} verified and loadable`);
  }
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} artifact(s) failed verification.`);
  process.exit(1);
}
console.log(`\nAll ${catalog.games.length} artifacts verified against the trusted public key.`);
