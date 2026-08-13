#!/usr/bin/env bash
# Boot a real GNOME Shell, load the extension into it, and see what happens.
#
# Everything the headless suite cannot ask: does it load at all, does it render a panel
# button, does its menu fill with rows from a real subprocess, does an event from a separate
# process light the panel up and clear again when the menu is opened, and does disabling it
# five times leave anything attached to the main loop or owning a bus name.
#
#   ci/smoke-test.sh              run it
#   ci/smoke-test.sh --shots DIR  and write screenshots there
#
# The shell is headless (no window appears) and runs against a throwaway HOME of its own, so
# this touches neither your session nor your dconf. That isolation is not a nicety: the
# obvious version of this script installs into ~/.local/share/gnome-shell/extensions and
# rewrites org.gnome.shell enabled-extensions, and run outside a container it would maul the
# session you are sitting in.
set -euo pipefail

UUID="recap@recap-gs.patxi"
DRIVER="recap-driver@test.recap-gs"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shots=""
[ "${1:-}" = "--shots" ] && { shots="$(cd "$2" && pwd)"; }

for tool in gnome-shell dbus-run-session glib-compile-schemas python3; do
  command -v "$tool" >/dev/null || { echo "$tool not found" >&2; exit 1; }
done

work="$here/.nested"
rm -rf "$work"
mkdir -p "$work"
export HOME="$work/home"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_STATE_HOME="$HOME/.local/state"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
# The distro's own extensions load in this shell too, and the desktop-icons one fills the
# log with criticals about a home directory that has no Desktop in it.
mkdir -p "$HOME/Desktop"

# A wayland socket path has 108 bytes to live in, and this checkout is nested deep enough to
# blow that on its own. /run/user is short; a TMPDIR is the fallback for CI images without
# a logind runtime directory.
if [ -d "/run/user/$(id -u)" ] && [ -w "/run/user/$(id -u)" ]; then
  runtime="$(mktemp -d "/run/user/$(id -u)/rgsXXXXXX")"
else
  runtime="$(mktemp -d "${TMPDIR:-/tmp}/rgsXXXXXX")"
fi
export XDG_RUNTIME_DIR="$runtime"
chmod 700 "$runtime"
cleanup() { rm -rf "$runtime"; }
trap cleanup EXIT

extensions="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$extensions/$UUID" "$extensions/$DRIVER"
# Laid out the way the packed zip lays it out — src/ at the root, with bin/ and hooks/
# beside it — because that is what a user installs and what the extension's own paths
# assume.
cp -r "$here/src/." "$extensions/$UUID/"
cp -r "$here/bin" "$here/hooks" "$extensions/$UUID/"
cp -r "$here/ci/driver/." "$extensions/$DRIVER/"
glib-compile-schemas "$extensions/$UUID/schemas"

# A recap that answers instantly and always the same way: this is a test of the extension,
# not of recap, and recap has a suite of its own. The timestamps are moved to now so the
# ages in the menu read like a live report rather than like the day it was recorded.
mkdir -p "$work/bin"
python3 - "$here/tests/fixtures/every-status.json" "$work/report.json" <<'PY'
import json, sys
from datetime import datetime, timedelta, timezone

doc = json.load(open(sys.argv[1]))
now = datetime.now(timezone.utc)
recorded = datetime.fromisoformat(doc["generated_at"].replace("Z", "+00:00"))
shift = now - recorded

def move(value):
    return (datetime.fromisoformat(value.replace("Z", "+00:00")) + shift).isoformat()

doc["generated_at"] = move(doc["generated_at"])
for project in doc["projects"]:
    project["last_activity"] = move(project["last_activity"])
    for session in project["sessions"]:
        for field in ("started", "last_activity"):
            if session.get(field):
                session[field] = move(session[field])
json.dump(doc, open(sys.argv[2], "w"), indent=2)
PY
cat > "$work/bin/recap" <<EOF
#!/bin/sh
exec cat "$work/report.json"
EOF
chmod +x "$work/bin/recap"
# On PATH rather than named in the settings: a bare "recap" is the default the extension
# ships with, so this exercises the lookup a real install depends on.
export PATH="$work/bin:$PATH"

result="$work/result.json"
export RECAP_DRIVER_RESULT="$result"
[ -n "$shots" ] && export RECAP_DRIVER_SHOTS="$shots"

# dconf is per-user, not per-bus, so these writes land in the throwaway HOME above and
# nowhere else.
settings() {
  dbus-run-session -- sh -c "$*"
}
settings "gsettings set org.gnome.shell disable-user-extensions false
          gsettings set org.gnome.shell enabled-extensions \"['$DRIVER', '$UUID']\"
          GSETTINGS_SCHEMA_DIR='$extensions/$UUID/schemas' \
            gsettings set org.gnome.shell.extensions.recap refresh-interval 5"

log="$work/shell.log"
echo "booting a headless shell (log: $log)"
set +e
timeout 180 dbus-run-session -- \
  gnome-shell --headless --virtual-monitor 1280x1024 --wayland --no-x11 \
  >"$log" 2>&1
shell_status=$?
set -e

echo
if [ ! -f "$result" ]; then
  echo "the driver never wrote a result (shell exited $shell_status)" >&2
  tail -40 "$log" >&2
  exit 1
fi

python3 - "$result" "$log" "$shots" <<'PY'
import json, os, re, sys

results = json.load(open(sys.argv[1]))
log = open(sys.argv[2], errors="replace").read()
shots = sys.argv[3] if len(sys.argv) > 3 else ""


for check in results["checks"]:
    if check["name"].startswith("screenshot") and not shots:
        continue
    print(f"  {'ok  ' if check['ok'] else 'FAIL'} {check['name']}"
          + (f"\n       {check['detail']}" if check.get("detail") else ""))

failures = [f for f in results["failures"] if not f.startswith("screenshot ")]

# A screenshot that did not happen is only a failure when one was asked for.
if shots:
    for name in ("panel.png", "menu.png", "preferences.png",
                 "panel-flagged.png", "menu-flagged.png"):
        if not os.path.exists(os.path.join(shots, name)):
            failures.append(f"no screenshot was written to {shots}/{name}")

# The shell logs what an extension gets wrong instead of raising it, so a run that passed
# every check and filled the journal with criticals has not passed.
for line in log.splitlines():
    # Only ours: the checkout path contains "recap", and so do other extensions' complaints
    # about it, so match the uuid and the extension's own files instead.
    if (re.search(r"(JS ERROR|Gjs-CRITICAL|has been already disposed)", line)
            and re.search(r"(recap@recap-gs\.patxi|recap-driver@)", line)):
        failures.append(f"the shell logged: {line.strip()}")

print()
print(f"panel: {results.get('panel')!r}, rows: {results.get('rows')}, "
      f"enable/disable rounds: {results.get('cycles')}")
if failures:
    print()
    for failure in failures:
        print(f"FAILED: {failure}")
    sys.exit(1)
print("smoke test passed")
PY
