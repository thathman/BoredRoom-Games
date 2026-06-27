# BoredRoom Games

Official installable games for [BoredRoom](https://github.com/thathman/BoredRoom).

Each directory under `games/` is an independently installable game. Release artifacts are
checksummed and Ed25519-signed. BoredRoom installs only artifacts listed in the signed catalog.

The source snapshots are intentionally kept outside the BoredRoom application repository so a
fresh BoredRoom deployment starts with an empty game library.

Current gameplay release: `v1.4.0.0`. Whot uses a best-of-five match, awards one
match point per round, and emits automatic semi-last-card, last-card, and check-up callouts.
