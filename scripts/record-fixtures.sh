#!/usr/bin/env bash
# Record tests/fixtures/ from the real recap binary.
#
# The fixtures are the boundary between this idea and recap, so they are recorded output,
# not JSON someone typed: hand-written fixtures agree with whatever the person writing them
# believed, which is exactly the disagreement they exist to catch.
#
# The data is made up. It comes from recap's own tools/demo-store.py, which builds a
# throwaway home with one session in each state — nobody's real project names end up here.
#
#   nix develop -c scripts/record-fixtures.sh
#
# Two fixtures cannot be recorded on this machine and are derived instead, each by one
# documented jq edit (see docs/recap-json-contract.md):
#   - finished, which recap only ever reports for an archived opencode session;
#   - liveness "unavailable", which needs a machine with no readable process table.
set -euo pipefail

cd "$(dirname "$0")/.."
here="$PWD"
fixtures="$here/tests/fixtures"

# recap's own repository, which is where both the binary and the demo store come from. This
# extension never vendors either: a fixture recorded against a copy of recap is a fixture
# recorded against a guess.
RECAP_REPO="${RECAP_REPO:-github:gortazar/recap}"
DEMO_STORE_URL="${DEMO_STORE_URL:-https://raw.githubusercontent.com/gortazar/recap/main/tools/demo-store.py}"

for tool in jq python3 nix curl; do
  command -v "$tool" >/dev/null || { echo "$tool not found: run inside nix develop" >&2; exit 1; }
done

echo "building recap from $RECAP_REPO..."
recap_bin="$(nix build "$RECAP_REPO" --no-link --print-out-paths)/bin/recap"

demo_store="$(mktemp -d)/demo-store.py"
curl -fsSL "$DEMO_STORE_URL" -o "$demo_store"
root="$(python3 "$demo_store")"
trap 'rm -rf "$root"' EXIT

# The demo store has no unreadable session — recap's own screenshot deliberately leaves it
# out. This extension needs one: "recap could not tell" is a state the menu must render.
mkdir -p "$root/projects/half-written-notes"
store="$root/.claude/projects/${root//\//-}-projects-half-written-notes"
mkdir -p "$store"
printf '{"type":"user","cwd":"%s/projects/half-written-notes","sessionId":"ffff6\n' \
  "$root" > "$store/ffff6666.jsonl"

# Stand-ins for running agents: same argv[0] and same working directory as the real thing,
# which is all recap's liveness check looks at.
agents=()
for p in orchestrator blog-pipeline; do
  ( cd "$root/projects/$p" && exec -a claude sleep 60 ) </dev/null >/dev/null 2>&1 &
  agents+=($!)
done
trap 'kill "${agents[@]}" 2>/dev/null || true; rm -rf "$root"' EXIT
sleep 0.3

mkdir -p "$fixtures"

# The tmp directory the store lives in changes every run, and a fixture whose paths churn is
# a fixture nobody can diff. /home/demo is not a real account on any machine this runs on.
# Both spellings: the store escapes a working directory by turning its slashes into dashes,
# and that escaped name is what recap falls back to naming a project it cannot read.
normalise() { sed -e "s|$root|/home/demo|g" -e "s|${root//\//-}|-home-demo|g"; }

echo "recording every-status.json..."
HOME="$root" "$recap_bin" --all --json | normalise > "$fixtures/every-status.json"

echo "recording empty.json..."
HOME="$root" "$recap_bin" --project no-such-project --json | normalise > "$fixtures/empty.json"

kill "${agents[@]}" 2>/dev/null || true
wait "${agents[@]}" 2>/dev/null || true
trap 'rm -rf "$root"' EXIT

# ✅ is reserved for an explicit completion marker, which only opencode's archived sessions
# carry, and there is no opencode store here. The line is otherwise a recorded one.
echo "deriving finished.json..."
jq '.projects |= map(if .name == "vacations"
      then .status = "finished" | .icon = "✅"
         | .recap = "Asked to \"Write the accrual rules down as a markdown table\" — finished."
         | .agents = ["opencode"]
         | .sessions |= map(.status = "finished" | .icon = "✅" | .agent = "opencode"
             | .recap = "Asked to \"Write the accrual rules down as a markdown table\" — finished.")
      else . end)' \
  "$fixtures/every-status.json" > "$fixtures/finished.json"

# What recap emits where it cannot read the process table: every status it cannot stand
# behind becomes unclear, and the document says why.
echo "deriving no-liveness.json..."
jq '.liveness = "unavailable"
    | .projects |= map(
        (if .status == "running" or .status == "waiting"
         then .status = "unclear" | .icon = "❓" else . end)
        | .sessions |= map(if .status == "running" or .status == "waiting"
            then .status = "unclear" | .icon = "❓" else . end))' \
  "$fixtures/every-status.json" > "$fixtures/no-liveness.json"

echo
echo "recorded against $recap_bin"
ls -1 "$fixtures"
