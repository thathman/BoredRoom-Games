#!/usr/bin/env bash
# One-command signed release for BoredRoom-Games.
#
# The only thing this script needs that an agent cannot supply is the private signing key.
# Run it as the key holder:
#
#   BOREDROOM_GAMES_SIGNING_KEY="$(cat /path/to/private.pem)" RELEASE_TAG=v1.3.0.0 bash scripts/release.sh
#
# It runs the full test suite, rebuilds signed artifacts + catalog at RELEASE_TAG, verifies the
# tarball signatures against the bundled public key, and prints what changed so you can commit,
# tag, and push a GitHub release.
set -euo pipefail
cd "$(dirname "$0")/.."

RELEASE_TAG="${RELEASE_TAG:-v1.3.0.0}"
export RELEASE_TAG

if [ -z "${BOREDROOM_GAMES_SIGNING_KEY:-}" ]; then
  echo "ERROR: BOREDROOM_GAMES_SIGNING_KEY is not set (export the private signing key PEM)." >&2
  exit 1
fi

echo "==> 1/4 Running the full test suite"
npm test

echo "==> 2/4 Building signed artifacts + catalog at ${RELEASE_TAG}"
npm run build

echo "==> 3/4 Verifying artifact signatures against the bundled public key"
node scripts/verify-release.mjs

echo "==> 4/4 Changed files (review, then commit + tag + push a GitHub release):"
git status --short dist catalog.json
echo
echo "Next:"
echo "  git add dist catalog.json"
echo "  git commit -m \"Release ${RELEASE_TAG}: rebuilt runtimes\""
echo "  git tag ${RELEASE_TAG} && git push --tags"
echo "  gh release create ${RELEASE_TAG} dist/*.tgz --title \"${RELEASE_TAG}\" --notes \"BoredRoom-Games ${RELEASE_TAG}\""
echo
echo "Done. Installed games will pick up ${RELEASE_TAG} on the next catalog fetch."
