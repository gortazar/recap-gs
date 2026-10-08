#!/usr/bin/env bash
# Does a resume actually land in the right directory when the terminal is Terminator?
#
#     ci/verify-terminator.sh
#
# The headless suite can assert the argv this extension builds, and does. What it cannot
# assert is what Terminator then does with it, and Terminator is the one terminal in the
# list where that is a real question: when an instance is already running, a second
# invocation is handed to it over D-Bus and the *existing* process opens the window. So the
# working directory arrives only if --working-directory survives that hand-off. If it does
# not, a window still opens and the agent still resumes — against whatever project the first
# Terminator instance was started in. That is the failure this script exists to rule out,
# and it is invisible to anything short of a real desktop.
#
# Three things can be wrong independently, so three things are checked:
#
#   1. a window appears at all;
#   2. its working directory is the session's own, not the launcher's;
#   3. the whole command line survived — `-x` takes the rest of the line, where `-e` would
#      have taken only the first word.
#
# Run it from a real GNOME session. It opens two short-lived Terminator windows and closes
# them itself.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

command -v terminator >/dev/null || { echo "terminator is not installed — nothing to verify" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
project="$work/project/deep"
mkdir -p "$project"

# The recorder stands where `claude` would. $1 is where to write; the rest is what the
# terminal handed it, which is the part that proves -x took more than one word.
cat > "$work/record.sh" <<'RECORDER'
#!/bin/sh
out="$1"
shift
{
    echo "cwd=$(pwd)"
    echo "argc=$#"
    for a in "$@"; do echo "arg=$a"; done
} > "$out"
sleep 5
RECORDER

status=0

# Deliberately launched from a directory that is *not* the target: if the terminal merely
# inherited our working directory, the check below would pass for the wrong reason.
run_case() {
    local label="$1" record="$2"
    shift 2
    ( cd / && setsid terminator "$@" \
        --working-directory="$project" \
        -x sh "$work/record.sh" "$record" --resume aaaa1111 >/dev/null 2>&1 & )

    local waited=0
    while [ ! -f "$record" ] && [ "$waited" -lt 20 ]; do
        sleep 1
        waited=$((waited + 1))
    done

    echo "== $label =="
    if [ ! -f "$record" ]; then
        echo "  FAIL: no window ever ran the command"
        status=1
        return
    fi

    local cwd argc
    cwd="$(sed -n 's/^cwd=//p' "$record")"
    argc="$(sed -n 's/^argc=//p' "$record")"

    if [ "$cwd" = "$project" ]; then
        echo "  ok   started in the session's own directory"
    else
        echo "  FAIL: started in $cwd, wanted $project"
        status=1
    fi

    # `claude --resume <id>` is two arguments after the command. One would mean -x behaved
    # like -e and swallowed the rest.
    if [ "$argc" = 2 ] && grep -qx 'arg=--resume' "$record" && grep -qx 'arg=aaaa1111' "$record"; then
        echo "  ok   the whole command line arrived, arguments intact"
    else
        echo "  FAIL: the command line did not survive (argc=$argc)"
        sed -n 's/^arg=/       got: /p' "$record"
        status=1
    fi
}

# The risky one first. Terminator must already be running for this to be the hand-off at
# all, so say which case was actually exercised rather than assuming.
if pgrep -x terminator >/dev/null 2>&1; then
    run_case "an instance was already running (the D-Bus hand-off)" "$work/record-dbus"
else
    echo "== no Terminator was running, so the D-Bus hand-off was not exercised =="
    echo "   start one and run this again to cover it"
fi

run_case "a standalone instance (-u, no D-Bus)" "$work/record-nodbus" -u

exit "$status"
