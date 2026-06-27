# BoredRoom Games

<p align="center">
  <strong>Official installable game catalog for BoredRoom.</strong>
</p>

<p align="center">
  <a href="https://github.com/thathman/BoredRoom-Games"><img alt="Repo" src="https://img.shields.io/badge/repo-BoredRoom--Games-7c3aed?style=for-the-badge&logo=github"></a>
  <a href="https://github.com/thathman/BoredRoom"><img alt="Platform" src="https://img.shields.io/badge/platform-BoredRoom-22c55e?style=for-the-badge&logo=react"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
  <img alt="Release" src="https://img.shields.io/badge/gameplay%20release-v1.4.0.0-f97316?style=for-the-badge">
</p>

<p align="center">
  <a href="#game-catalog">Game catalog</a> •
  <a href="#runtime-contract">Runtime contract</a> •
  <a href="#build-and-release">Build</a> •
  <a href="#testing">Testing</a> •
  <a href="#data-sources-and-attribution">Attribution</a>
</p>

---

## What is this repo?

`BoredRoom-Games` contains the official installable games for [`BoredRoom`](https://github.com/thathman/BoredRoom).

Each directory under `games/` represents an independently installable game. Release artifacts are checksummed and Ed25519-signed. BoredRoom should install only artifacts listed in the generated catalog and verified by the configured public key.

The game source lives outside the main BoredRoom app so a fresh platform deployment can start with an empty game library and install only the games the owner wants.

---

## Current release

Current gameplay release: `v1.4.0.0`.

The generated catalog is [`catalog.json`](./catalog.json). Each catalog entry includes:

- game id;
- display name;
- description;
- version;
- player limits;
- capabilities;
- entrypoints;
- AI feature flags;
- rules metadata;
- artifact URL;
- SHA-256 digest;
- Ed25519 signature;
- artifact size.

---

## Game catalog

| Game | ID | Players | Type | Core promise |
| --- | --- | ---: | --- | --- |
| Bible Timeline Rush | `bible-timeline` | 1–12 | Timeline / speed | Arrange Bible events from earliest to latest before the timer runs out. |
| Color Wahala | `color-wahala` | 2–8 | Stroop / reaction | Read the instruction, ignore the visual trap, and tap the right colour fast. |
| Connect 4 | `connect-4` | 2–4 | Board / team | Drop discs into a public board, solo or team style, and connect four. |
| Endless Tic Tac Toe | `ettt` | 2–4 | Board / memory | Rolling tic-tac-toe where old marks disappear and memory matters. |
| Faith Feud | `faith-feud` | 2–12 | Survey / team | Faith-friendly Family Feud-style team guessing. |
| Half & Half | `half-half` | 2–8 | Social prediction | Predict the room split or land closest to the midpoint. |
| Hustle | `hustle` | 2–4 | Board / dice | Snakes-and-Ladders-style Naija hustle board. |
| Oga Landlord | `landlord` | 2–6 | Property / board | Roll, buy, rent, and survive Nigerian property wahala. |
| Logo Guesser | `logo` | 2–8 | Recognition | Guess the obscured brand/logo before the reveal. |
| Ludo | `ludo` | 2–4 | Board / dice | Classic race-home Ludo with public board and private controller moves. |
| Market Price | `market-price` | 1–12 | Estimation | Guess Nigerian product/grocery prices from cached snapshots. |
| Pidgin Translator | `pidgin-translator` | 1–12 | Voice/text speed | Translate fast between English and Pidgin without turning phones into room mics. |
| Who Sabi Pass? | `trivia` | 2–8 | Trivia | Nigerian culture, history, music, film, and general knowledge trivia. |
| Whot | `whot` | 2–8 | Card game | Nigerian shape-and-number card showdown. |
| Word Wahala | `word-wahala` | 2–8 | Word board | Scrabble-like Naija word-board game. |

---

## Runtime contract

Every installable game must expose a server-authoritative runtime. The BoredRoom server owns game state, validates player intent, and publishes role-safe projections.

Each game runtime must support:

- `configure(context)`;
- `seatPlayers(players)`;
- `start()`;
- `handleIntent(playerId, intent, isHost)`;
- `publicState()`;
- `privateState(playerId)`;
- `companionState()`;
- `crowdState()`;
- `snapshot()`;
- `restore(snapshot)`;
- `finish()`;
- `dispose()`;
- `legalIntents(playerId)`;
- `explainIntent(intent)`;
- `recapSignals()`;
- `rankBotIntent(...)` where bots are supported.

Rules:

1. Server state is authoritative.
2. Legal intents describe allowed actions; they must not leak hidden answers.
3. Public state must never expose private hands, private transcripts, hidden answers, raw audio, service credentials, or admin-only data.
4. Private state must only include the requesting player’s private data.
5. Companion state may include host-control information but not raw secrets.
6. Crowd state must be audience-safe.
7. Snapshot/restore must preserve active game state, settings, timers, and current turn/round.
8. Finish/recap must expose enough information for BoredRoom to show a meaningful review screen.

---

## Game UX model

BoredRoom games should follow the platform role model:

| Surface | Job |
| --- | --- |
| Public display | The stage: board, prompt, timer, reveal, scores, animations, reactions. |
| Controller | The player's hand: legal actions, cards, dice, voice/text input, private info. |
| Companion | The host control booth: settings, timers, player controls, reveal/skip/pause. |
| Crowd | Audience-safe view: watch, react, vote only if allowed. |

Do not put the full game board on a controller unless the game requires a compact private control view. Do not put host/admin controls on player controllers.

---

## Game-specific implementation notes

### Whot

Whot should behave like a real card game:

- full deck;
- deterministic shuffle;
- draw/market pile;
- discard pile;
- shape/number matching;
- Whot card call-shape;
- configurable special cards;
- round scoring;
- bot support;
- table-style public view;
- private hand controller view.

### Ludo

Ludo should behave like a real board game:

- seeded dice;
- player paths;
- home yards;
- safe squares;
- captures;
- home stretch;
- exact finish rules;
- extra turn on six;
- optional quick mode;
- animated public board;
- private dice/token controller.

### Connect 4

Connect 4 should support:

- 6x7 board;
- legal column drops;
- horizontal/vertical/diagonal wins;
- draw detection;
- solo/team mode;
- best-of rounds;
- animated public board;
- controller column controls.

### Bible Timeline Rush

Bible Timeline Rush should support:

- hidden canonical timeline;
- randomized visible order;
- drag/drop controller ordering;
- all-submit reveal;
- countdown-to-next-round;
- difficulty levels;
- Bible reference explanations;
- no repeated prompts.

### Color Wahala

Color Wahala should be a true Stroop/reaction game:

- displayed word and ink colour separated;
- misleading prompt logic;
- safe flag-colour prompts;
- answer timer;
- speed scoring;
- reveal explanations;
- no repeated prompts.

### Endless Tic Tac Toe

Endless Tic Tac Toe should be rolling tic-tac-toe:

- limited active marks;
- oldest mark removal;
- move history;
- team mode;
- final board review.

### Half & Half

Half & Half should be a social midpoint/split game:

- split-vote mode;
- midpoint guess mode;
- distribution reveal;
- median/split scoring;
- clear recap.

### Faith Feud

Faith Feud should be a Family Feud-style game:

- survey setup/generation;
- team mode;
- answer aliases;
- fuzzy matching;
- top answers;
- strikes;
- steals;
- reveal board;
- team scoring.

### Hustle

Hustle should be a Snakes-and-Ladders-style Nigerian hustle board:

- dice;
- tokens;
- ladders/opportunities;
- snakes/wahala;
- event cards;
- animated board;
- quick/normal mode.

### Oga Landlord

Oga Landlord should be a Monopoly-inspired Nigerian property game:

- roll/move;
- buy/pass;
- rent;
- property ownership;
- chance/wahala cards;
- bankruptcy/end conditions;
- quick/normal mode;
- public board and private portfolio controls.

### Logo Guesser

Logo Guesser should support:

- logo bank;
- obscured logo stages;
- blur/crop/pixelate/mask reveal;
- typed or multiple-choice answers;
- hints;
- no repeated logos;
- safe configured logo sources only.

### Word Wahala

Word Wahala should be Scrabble-like:

- tile bag;
- racks;
- board;
- letter values;
- placement validation;
- cross-word validation;
- dictionary modes;
- pass/swap;
- score preview.

### Market Price

Market Price should use curated data and optional cached Supermart.ng snapshots.

Rules:

- never fetch Supermart during active gameplay;
- import/cache product snapshots server-side;
- use product detail pages as source of truth;
- store product name, price, image, URL, availability, fetchedAt, lastVerifiedAt, and source credit;
- show product image and source credit on reveal;
- exclude restricted categories by default;
- use manual CSV/JSON fallback where scraping/import is not appropriate.

Supermart credit text:

> Product/price reference: Supermart.ng

Prices change often. Each round should display the cached verification time.

### Pidgin Translator

Pidgin Translator should be voice-first but privacy-safe:

- default mode: fastest-correct speed voice;
- text fallback mandatory;
- no continuous listening;
- no live audio broadcast;
- raw audio not stored by default;
- push-to-talk or tap-to-record only;
- server timestamp decides speed ranking;
- transcription completion time must not affect fastest-player scoring;
- host display shows recording/submitted status but no live transcript before reveal.

### Who Sabi Pass?

Who Sabi Pass should support:

- large question banks;
- categories;
- difficulty;
- timers;
- reveal explanations;
- no repeated questions;
- optional AI-generated questions with moderation and fallback.

---

## Build and release

### Install

```bash
git clone https://github.com/thathman/BoredRoom-Games.git
cd BoredRoom-Games
npm install
```

### Build catalog and artifacts

```bash
BOREDROOM_GAMES_SIGNING_KEY="<ed25519-private-key>" npm run build
```

The build script:

1. reads each game manifest;
2. stages game source;
3. writes release metadata;
4. packages a `.tgz` artifact;
5. calculates SHA-256;
6. signs the artifact digest;
7. writes `catalog.json`.

`BOREDROOM_GAMES_SIGNING_KEY` is required for release builds. Never commit the private signing key.

### Release version

The build script reads `RELEASE_TAG` and defaults to the configured release tag. Example:

```bash
RELEASE_TAG=v1.4.0.0 BOREDROOM_GAMES_SIGNING_KEY="<key>" npm run build
```

---

## Testing

Run:

```bash
npm test
```

The test command runs:

- dictionary sync where needed;
- runtime contract tests;
- per-game tests under `games/*/tests/*.test.mjs`.

Every game should have tests for:

- runtime contract;
- legal intents;
- illegal intent rejection;
- settings validation;
- scoring;
- timers where applicable;
- snapshot/restore;
- finish/recap;
- public/private projection isolation;
- bot behavior where supported;
- team behavior where supported;
- no-repeat content where applicable;
- external data fallback where applicable.

---

## Data sources and attribution

Some games may use third-party reference data or brand/product/logo sources.

Rules:

1. Do not claim partnership or endorsement unless one exists.
2. Preserve source links and attribution where required.
3. Do not bundle third-party images or product data unless licensing/permission allows it.
4. Prefer cached snapshots with source links and timestamps over live gameplay dependencies.
5. Keep API keys and source credentials out of game artifacts.

### Supermart.ng / Market Price

Market Price can use cached product and price snapshots imported from Supermart.ng. Product names, prices, images, and product links are credited to Supermart.ng on reveal screens. Prices change often, so each game round displays the cached verification time.

Supermart.ng is not affiliated with BoredRoom unless explicitly stated.

### Logos / Logo Guesser

Logos, marks, and brand names remain the property of their respective owners. Logo sources must be used through safe configured adapters and should not expose API keys.

### Voice / Pidgin Translator

Voice input must be private, intentional, short, and player-controlled. Raw audio must not be broadcast to other players or included in public game state.

---

## Security

See [`SECURITY.md`](./SECURITY.md).

Important game security rules:

- validate all intents server-side;
- never trust client-side timers for scoring;
- never leak hidden answers through legal intents;
- never put private hands/transcripts/audio in public state;
- sign release artifacts;
- verify artifacts before install;
- keep signing keys private;
- do not include service credentials in game packages.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

The short version:

- preserve real game identity;
- keep gameplay server-authoritative;
- keep controllers private and focused;
- keep public display cinematic;
- add tests with every game change;
- update catalog artifacts only through the build pipeline;
- document third-party sources and credits.

---

## Code of conduct

See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

---

## License

This repository is licensed under the MIT License. See [`LICENSE`](./LICENSE).

Third-party assets, trademarks, logos, product data, product images, brand names, and referenced services are not relicensed by this repository. See [`NOTICE.md`](./NOTICE.md).
