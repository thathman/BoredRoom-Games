# External Game Reference Plan

Last updated: 2026-06-26 22:05 WAT

This repo must use a fork/adapt-first strategy for official games. Do not invent a board/card game from scratch when a usable open-source implementation exists. External code still has to be wrapped in BoredRoom’s server-authoritative `GameRuntime` contract and must pass private/public-state isolation, reconnect, snapshot, bot, and browser tests.

## Rules

- Prefer permissive licenses: MIT, BSD, Apache-2.0.
- GPL/AGPL repos are reference-only unless the whole distribution intentionally accepts the copyleft obligations.
- No direct dependency may expose external room codes, client-authoritative state, secrets, or browser-only rule enforcement.
- Forked/adapted logic must be converted into deterministic server-side rules first; UI/animation assets are secondary.
- Every adapted repo must keep license attribution in the relevant game package.

## Candidate map

| BoredRoom game | Fork/adapt candidate | License | Use |
|---|---|---:|---|
| Oga Landlord | https://github.com/christelbuchanan/Monopoly-Game | Author permission stated by Hendrix; no public license detected | **Preferred feature source.** Hendrix prefers this repo’s feature shape. Existing BoredRoom Landlord source already references it; permission is stated by the project owner. Preserve attribution/permission evidence in release notes. Use its board/property/card/jail/building/mortgage/auction/trade-style feature set as the target behavior. |
| Oga Landlord | https://github.com/itaylayzer/Monopoly | MIT | Secondary source for bots, sound/music, property UI polish, React/TypeScript patterns, online/PeerJS concepts and board/audio assets. Extract only pieces that improve the preferred `christelbuchanan/Monopoly-Game` feature target. |
| Oga Landlord | https://github.com/intrepidcoder/monopoly | MIT | Secondary reference only. Older JS/HTML implementation with useful Monopoly rules/card concepts, but less aligned with BoredRoom’s React/TS stack than `itaylayzer/Monopoly`. |
| Whot | https://github.com/mykeels/whot and https://github.com/mykeels/whot-server | MIT | Primary rules/API reference for Nigerian Whot behavior, card vocabulary, market/pick/suspension logic. |
| Connect 4 | https://github.com/joshtom/connect-four-game | ISC in `package.json`; no LICENSE file found | User-preferred reference. Use only after preserving attribution/license notice because no standalone LICENSE file was detected. Simple JS board classes are useful for rule/UI audit; BoredRoom still needs server-authoritative team mode, best-of rounds and snapshot/restore. |
| Connect 4 | https://github.com/kenrick95/c4 | MIT | Secondary safer-license reference. Keep available if `joshtom/connect-four-game` attribution/licensing is not sufficient for vendoring. |
| Ludo | https://github.com/smokelaboratory/fludo | Apache-2.0 | Strong board/canvas reference. Logic is Flutter/Dart, so adapt concepts, not direct JS copy. Also compare with existing goal references. |
| Word Wahala | https://github.com/rcdexta/react-scrabble | MIT | Primary Scrabble-like UI/rack/board reference. Server rules still need BoredRoom dictionary and Nigerian/Pidgin mode. |
| Faith Feud | https://github.com/joshzcold/Friendly-Feud | MIT | **Primary fork/adapt target.** Stronger than earlier candidate: host/admin/display/buzzer flows, Go backend APIs, Next frontend, CSV/JSON game data, timers, audio, Docker and Playwright E2E. Adapt game data model, board reveal, buzzer/answer flow and tests into BoredRoom’s HouseSession runtime. |
| Faith Feud | https://github.com/yulrizka/fam100 | MIT | Secondary lightweight reference. |
| Logo Guesser | https://github.com/syxanash/logosweeper and https://github.com/swapnilrane24/Logo-Quiz | MIT | Logo quiz mechanics/reference. Verify assets before reuse; prefer BoredRoom-owned/allowed brand assets. |
| Color Wahala | https://github.com/khrigo/TrueOrFalseColor | MIT | Stroop-effect reference. Adapt timing, prompt validation, speed scoring, and accessibility. |
| Market Price | https://github.com/Amine-Smahi/UPrice | MIT | Price guessing/reference. Gameplay can be adapted; BoredRoom still needs curated immutable Nigerian price snapshots. |
| Endless Tic Tac Toe | No strong exact match found yet | TBD | Continue search for “rolling tic tac toe” / “three marks tic tac toe”. Current in-house logic may remain if no permissive match exists. |
| Bible Timeline Rush | No usable permissive match found yet | TBD | Search mostly found content/apps without clear license. Need either licensed content source or original curated content. |
| Half & Half | No strong exact match found yet | TBD | Search under “would you rather”, “split vote”, and “majority party game”; many candidates lack licenses. |
| Hustle | No direct match | TBD | Can borrow snakes-and-ladders/open board-game patterns, but needs original Nigerian board/content. Search still needed. |
| Pidgin Translator | No direct match found | TBD | Needs original BoredRoom implementation around text/voice translation privacy and scoring. |
| Who Sabi Pass / Trivia | Multiple generic quiz repos exist | MIT/Apache candidates | Use only for UI/quiz flow patterns; content and anti-repeat/timer/scoring remain BoredRoom-specific. |

## Immediate implementation impact

- Oga Landlord Phase now uses `christelbuchanan/Monopoly-Game` as the preferred feature target because Hendrix prefers its features and states author permission is in place.
- Use `itaylayzer/Monopoly` as a secondary source for bots, audio/music and React/TS implementation ideas; do not replace the preferred feature target unless the user changes direction.
- Existing Landlord source comments mention `christelbuchanan/Monopoly-Game`; keep attribution/permission evidence with the release record.
- Whot Phase should compare current runtime against `mykeels/whot` and `mykeels/whot-server` before adding more rules.
- Faith Feud Phase should use `joshzcold/Friendly-Feud` as the primary source for host/display/buzzer/reveal flow and test coverage.
- Connect 4 Phase should audit `joshtom/connect-four-game` first because the user selected it, but only vendor code if the package-level ISC license is preserved clearly; otherwise use it as reference and keep `kenrick95/c4` as MIT fallback.
- Each game phase must start with a license/architecture audit of the selected external repo.
- The handoff docs must call out whether a game is:
  - `fork-adapt`: external implementation is good enough to adapt;
  - `reference-only`: useful concepts but incompatible language/license/architecture;
  - `original-required`: no suitable source found.

## Next searches

- Rolling/endless tic-tac-toe permissive JS/TS implementation.
- Snakes-and-ladders JS/TS permissive implementation for Hustle board behavior.
- Survey/Family Feud web games with explicit MIT/BSD/Apache license.
- Bible timeline content with explicit reuse license.
- Pidgin/Nigerian phrase datasets with explicit reuse license.

## Reconciliation status (Claude continuation, 2026-06-27)

Reference repos cloned to a scratch area and audited against the BoredRoom runtimes:

- **Whot ← mykeels/whot (MIT):** BoredRoom's Whot runtime is **rule-identical** to the reference — same 54-card deck (Circle/Triangle 1–14 minus 6,9; Cross/Square subset; Star 1–8; 5× Whot-20) and the same special-move mapping (2=PickTwo, 5=PickThree, 14=GeneralMarket, 1=HoldOn, 8=Suspension, 20=Whot call-shape). Implemented independently but validated against the source of truth. Attribution noted in the runtime.
- **Oga Landlord ← christelbuchanan/Monopoly-Game (author permission; no LICENSE file):** rules reimplemented server-side (no code vendored). Reconciled the feature target by adding the two missing behaviors: passing-GO bonus and three-doubles→jail. Board animations (3D dice roll, token glide, card flip) adapted into `src/index.css` (`landlord-*`) in the main app with attribution. Runtime now has monopoly sets/houses/mortgage/jail.
- **Faith Feud ← joshzcold/Friendly-Feud (MIT):** sound effects vendored into `boredroom/public/sounds/feud/` with `ATTRIBUTION.txt` and wired to reveal/correct/wrong/steal. Full host/buzzer UI port still pending.
- **Connect 4 ← joshtom/connect-four-game (ISC):** audited; BoredRoom's server-authoritative team-mode/best-of implementation kept (reference is client-only). No code vendored.

Scratch clones live outside the repos (not committed). Assets that were vendored carry license attribution alongside them.
