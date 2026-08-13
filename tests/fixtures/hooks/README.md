# Hook payload fixtures

What the agents send the shim on stdin, which the shim passes to the extension untouched.

Unlike `tests/fixtures/*.json` — recorded from the real recap binary — these are **written
from each agent's documented hook input**, with the project names swapped for the ones the
recap fixtures use so the two sets line up:

- **Claude Code** (`claude-notification.json`, `claude-stop.json`) — the fields every hook
  receives (`session_id`, `transcript_path`, `cwd`, `hook_event_name`) plus `message`, which
  only `Notification` carries. Recording these for real needs a live agent session with
  credentials; `STATUS.md` says exactly how far the end-to-end path was exercised instead.
- **opencode** (`opencode-session-idle.json`) — this one is exact rather than documented,
  because the payload is written by *our* plugin (`hooks/opencode-recap-gs.js`) from what
  `session.idle` hands it. If that plugin changes, this changes with it.

The decoder is deliberately incurious about the rest: it needs `cwd`, it will use `message`,
`session_id` and an agent name if they are there, and it ignores everything else — including
fields an agent adds later.
