import { createHash, createPrivateKey, sign } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const gamesRoot = path.join(root, 'games');
const dist = path.join(root, 'dist');
const tag = process.env.RELEASE_TAG ?? 'v1.2.0.0';
const releaseVersion = tag.replace(/^v/, '');
const privateKeyText = process.env.BOREDROOM_GAMES_SIGNING_KEY;
if (!privateKeyText) throw new Error('BOREDROOM_GAMES_SIGNING_KEY is required');
const privateKey = createPrivateKey(privateKeyText);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const entries = [];
for (const id of (await readdir(gamesRoot)).sort()) {
  const gameDir = path.join(gamesRoot, id);
  const sourceManifest = JSON.parse(await readFile(path.join(gameDir, 'manifest.json'), 'utf8'));
  const manifest = {
    ...sourceManifest,
    version: releaseVersion,
    ai: {
      commentary: true,
      hints: sourceManifest.capabilities.hints,
      rules: true,
      recommendations: true,
      recaps: true,
      moderation: false,
      deterministicBots: sourceManifest.capabilities.bots,
    },
    rules: {
      summary: sourceManifest.rules?.summary ?? `${sourceManifest.name} validates every player action on the server and exposes legal actions without revealing private state.`,
      intents: sourceManifest.rules?.intents ?? ['answer', 'guess', 'answer_text', 'submit_order', 'advance'],
    },
  };
  const artifactName = `${id}-${manifest.version}.tgz`;
  const artifactPath = path.join(dist, artifactName);
  const staging = path.join(dist, `.stage-${id}`);
  await mkdir(path.join(staging, 'source'), { recursive: true });
  await cp(path.join(gameDir, 'source'), path.join(staging, 'source'), { recursive: true });
  // Copy the full runtime directory so per-game modules resolve correctly
  await cp(path.join(root, 'runtime'), path.join(staging, 'source'), { recursive: true });
  await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(staging, 'source', 'server.js'),
    `import { createPlugin } from './game-runtime.js';\nconst manifest = ${JSON.stringify(manifest)};\nexport const gamePlugin = createPlugin(manifest);\nexport default gamePlugin;\n`,
  );
  const reproducibleFlags = process.platform === 'linux'
    ? ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner']
    : [];
  const packed = spawnSync('tar', [
    ...reproducibleFlags, '-czf', artifactPath, '-C', staging, 'manifest.json', 'source',
  ], {
    stdio: 'inherit',
  });
  if (packed.status !== 0) throw new Error(`Could not package ${id}`);
  await rm(staging, { recursive: true, force: true });
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
