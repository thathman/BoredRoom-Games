#!/usr/bin/env node
// Verify that every catalog artifact's sha256 and ed25519 signature match the built .tgz and the
// trusted public key the server uses. Run after `npm run build` (release.sh does this).
//
// Set BOREDROOM_GAMES_PUBLIC_KEY to check against a specific key; otherwise the production key
// the server ships with is used (so a release built with the wrong private key fails loudly).
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const PUBLIC_KEY = process.env.BOREDROOM_GAMES_PUBLIC_KEY?.trim() || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3GPtGkub/09AvQgAL4a4hmBPnolthU+p3TbytYFC0PU=
-----END PUBLIC KEY-----`;

const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
const key = createPublicKey(PUBLIC_KEY);
let failures = 0;

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
  console.log(`✓ ${game.id}@${game.version} verified`);
}

if (failures > 0) {
  console.error(`\n${failures} artifact(s) failed verification.`);
  process.exit(1);
}
console.log(`\nAll ${catalog.games.length} artifacts verified against the trusted public key.`);
