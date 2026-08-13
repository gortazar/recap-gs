#!/usr/bin/env bash
# Wire your agents up to the recap panel indicator.
#
#     hooks/install-hooks.sh            ask first, then do it
#     hooks/install-hooks.sh --yes      do not ask (for scripts)
#     hooks/install-hooks.sh --print    print what it would add, change nothing
#     hooks/install-hooks.sh --uninstall  take it all out again
#
# What it changes, and nothing else:
#
#   ~/.claude/settings.json          a Notification hook and a Stop hook, both running
#                                    `recap-gs-notify`
#   ~/.config/opencode/plugin/       a plugin forwarding session.idle
#   ~/.local/bin/recap-gs-notify     the shim itself, if it is not already on PATH
#
# It is editing your own configuration, so: it shows you the change, asks (default yes),
# backs the file up before touching it, merges rather than overwrites, and is idempotent —
# running it twice leaves one entry, not two. A hook you wrote yourself is never touched.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assume_yes=0
print_only=0
uninstall=0

for arg in "$@"; do
    case "$arg" in
        -y|--yes) assume_yes=1 ;;
        --print) print_only=1 ;;
        --uninstall) uninstall=1 ;;
        -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

command -v python3 >/dev/null 2>&1 || {
    echo "install-hooks.sh needs python3 to edit settings.json safely" >&2
    echo "Add the hooks by hand instead — hooks/install-hooks.sh --print shows them." >&2
    exit 1
}

claude_settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
opencode_plugin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugin"
bin_dir="${RECAP_GS_BIN_DIR:-$HOME/.local/bin}"

CLAUDE_SNIPPET=$(cat <<'JSON'
{
  "hooks": {
    "Notification": [
      { "hooks": [ { "type": "command", "command": "recap-gs-notify asking" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "recap-gs-notify finished" } ] }
    ]
  }
}
JSON
)

if [ "$print_only" = 1 ]; then
    echo "Claude Code — merge into $claude_settings:"
    echo
    echo "$CLAUDE_SNIPPET"
    echo
    echo "opencode — copy hooks/opencode-recap-gs.js to $opencode_plugin_dir/recap-gs.js"
    exit 0
fi

if [ "$uninstall" = 0 ]; then
    cat <<EOF
This will wire your agents up to the recap panel indicator:

  $claude_settings
      + a Notification hook  ->  recap-gs-notify asking
      + a Stop hook          ->  recap-gs-notify finished
  $opencode_plugin_dir/recap-gs.js
      + a plugin forwarding session.idle
  $bin_dir/recap-gs-notify
      the shim both of them run

Your settings file is backed up first, the change is merged rather than written over, and
hooks you added yourself are left alone.
EOF
else
    echo "This will remove the recap-gs hooks from $claude_settings and delete"
    echo "$opencode_plugin_dir/recap-gs.js."
fi

if [ "$assume_yes" = 0 ]; then
    if [ -t 0 ]; then
        printf '\nGo ahead? [Y/n] '
        read -r answer
        case "${answer:-y}" in
            [Nn]*) echo "Nothing was changed."; exit 0 ;;
        esac
    else
        echo
        echo "Not a terminal, so nothing was changed. Re-run with --yes to go ahead," >&2
        echo "or --print to see what it would add." >&2
        exit 1
    fi
fi

# The shim, if it is not already reachable. Copied rather than symlinked so that moving the
# checkout does not silently disarm every hook.
if command -v recap-gs-notify >/dev/null 2>&1 && [ "$uninstall" = 0 ]; then
    echo "recap-gs-notify: already on PATH at $(command -v recap-gs-notify)"
elif [ "$uninstall" = 0 ]; then
    mkdir -p "$bin_dir"
    cp "$here/bin/recap-gs-notify" "$bin_dir/recap-gs-notify"
    chmod +x "$bin_dir/recap-gs-notify"
    echo "recap-gs-notify: installed to $bin_dir"
    case ":$PATH:" in
        *":$bin_dir:"*) ;;
        *) echo "  note: $bin_dir is not on your PATH, so the hooks will not find it" >&2 ;;
    esac
fi

# Claude Code's settings.json, edited as JSON rather than as text.
RECAP_GS_UNINSTALL="$uninstall" python3 - "$claude_settings" <<'PY'
import json
import os
import shutil
import sys

path = sys.argv[1]
uninstalling = os.environ.get("RECAP_GS_UNINSTALL") == "1"
ours = {
    "Notification": "recap-gs-notify asking",
    "Stop": "recap-gs-notify finished",
}

settings = {}
if os.path.exists(path):
    with open(path) as handle:
        text = handle.read().strip()
    if text:
        try:
            settings = json.loads(text)
        except json.JSONDecodeError as error:
            print(f"{path} is not valid JSON ({error}); leaving it alone", file=sys.stderr)
            raise SystemExit(1)
    if not isinstance(settings, dict):
        print(f"{path} is not a JSON object; leaving it alone", file=sys.stderr)
        raise SystemExit(1)
    # Back up before touching it, once per run, never overwriting an older backup blindly.
    backup = path + ".recap-gs.bak"
    shutil.copy2(path, backup)
    print(f"Claude Code: backed up {path} -> {backup}")

hooks = settings.setdefault("hooks", {})
if not isinstance(hooks, dict):
    print(f"{path}: \"hooks\" is not an object; leaving it alone", file=sys.stderr)
    raise SystemExit(1)

changed = False
for event, command in ours.items():
    groups = hooks.get(event) or []
    if not isinstance(groups, list):
        print(f"{path}: \"hooks.{event}\" is not a list; leaving it alone", file=sys.stderr)
        raise SystemExit(1)

    # Idempotent, and gentle: only entries whose command is exactly ours are removed, so a
    # hook somebody wrote by hand survives both installing and uninstalling.
    def is_ours(group):
        return any(
            isinstance(entry, dict) and entry.get("command") == command
            for entry in (group.get("hooks") or [])
            if isinstance(group, dict)
        )

    kept = [group for group in groups if not is_ours(group)]
    if not uninstalling:
        kept.append({"hooks": [{"type": "command", "command": command}]})

    if kept != groups:
        changed = True
    if kept:
        hooks[event] = kept
    else:
        hooks.pop(event, None)

if not hooks:
    settings.pop("hooks", None)

if changed:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as handle:
        json.dump(settings, handle, indent=2)
        handle.write("\n")
    print(f"Claude Code: {'removed' if uninstalling else 'installed'} the hooks in {path}")
else:
    print(f"Claude Code: nothing to change in {path}")
PY

# opencode's plugin directory.
plugin="$opencode_plugin_dir/recap-gs.js"
if [ "$uninstall" = 1 ]; then
    if [ -f "$plugin" ]; then
        rm -f "$plugin"
        echo "opencode: removed $plugin"
    else
        echo "opencode: nothing to remove"
    fi
else
    mkdir -p "$opencode_plugin_dir"
    cp "$here/hooks/opencode-recap-gs.js" "$plugin"
    echo "opencode: installed $plugin"
fi

echo
if [ "$uninstall" = 1 ]; then
    echo "Done. Restart any running agents for it to take effect."
else
    cat <<'EOF'
Done. Restart any running agents for it to take effect.

Claude Code will now tell the panel the moment a session asks you something or finishes
answering; opencode will tell it when a session goes idle. Nothing else changes, and the
panel keeps polling recap either way.
EOF
fi
