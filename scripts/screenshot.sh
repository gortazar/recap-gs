#!/usr/bin/env bash
# Regenerate screenshots/ from a real GNOME Shell.
#
#     nix develop -c scripts/screenshot.sh
#
# The pictures are the extension running, not a mock-up: a headless shell boots with the
# extension installed, a stand-in recap answers with the same made-up report the fixtures
# hold, and the driver opens the menu and the preferences window in front of the camera. See
# ci/smoke-test.sh, which is the same run with its results checked.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shots="$here/screenshots"
mkdir -p "$shots"

"$here/ci/smoke-test.sh" --shots "$shots"
gjs -m "$here/ci/crop.js" "$shots"

echo
ls -l "$shots"
