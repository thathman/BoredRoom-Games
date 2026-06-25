import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const gamesRoot = path.join(root, 'games');
const dist = path.join(root, 'dist');
const tag = process.env.RELEASE_TAG ?? 'v1.0.0.0';
const privateKeyText = process.env.BOREDROOM_GAMES_SIGNING_KEY;
if (!privateKeyText) throw new Error('BOREDROOM_GAMES_SIGNING_KEY is required');
const privateKey = createPrivateKey(privateKeyText);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const entries = [];
for (const id of (await readdir(gamesRoot)).sort()) {
  const gameDir = path.join(gamesRoot, id);
  const manifest = JSON.parse(await readFile(path.join(gameDir, 'manifest.json'), 'utf8'));
  const artifactName = `${id}-${manifest.version}.tgz`;
  const artifactPath = path.join(dist, artifactName);
  const reproducibleFlags = process.platform === 'linux'
    ? ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner']
    : [];
  const packed = spawnSync('tar', [
    ...reproducibleFlags, '-czf', artifactPath, '-C', gameDir, 'manifest.json', 'source',
  ], {
    stdio: 'inherit',
  });
  if (packed.status !== 0) throw new Error(`Could not package ${id}`);
  const bytes = await readFile(artifactPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const signature = sign(null, Buffer.from(sha256, 'utf8'), privateKey).toString('base64');
  entries.push({
    ...manifest,
    artifact: {
      url: `https://github.com/thathman/BoredRoom-Games/releases/download/${tag}/${artifactName}`,
      sha256,
      signature,
      size: bytes.byteLength
    }
  });
}

const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: 'https://github.com/thathman/BoredRoom-Games',
  games: entries
};
await writeFile(path.join(root, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Built ${entries.length} signed game artifacts.`);
