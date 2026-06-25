# BoredRoom Games

Official installable games for [BoredRoom](https://github.com/thathman/BoredRoom).

Each directory under `games/` is an independently installable game. Release artifacts are
checksummed and Ed25519-signed. BoredRoom installs only artifacts listed in the signed catalog.

The source snapshots are intentionally kept outside the BoredRoom application repository so a
fresh BoredRoom deployment starts with an empty game library.
