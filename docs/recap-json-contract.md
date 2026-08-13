# The `recap --json` contract

This extension shows what `recap` reports and decides nothing for itself: no transcript is
read here, no status is inferred here. That makes `recap --json` the whole interface between
the two ideas, and this document names the version of it we are written against.

**Supported schema version: 1.** Declared in `src/lib/contract.js` as
`SUPPORTED_SCHEMA_VERSION`, and defined upstream in `ideas/recap/internal/render/json.go`
(`render.SchemaVersion`) and in recap's README under "`--json`".

## What version 1 guarantees

Taken from recap's README, which states these as guarantees to consumers:

- `version` is present and is an integer.
- `projects` and every `sessions` list is always a list, never `null` — even when there is
  nothing to report.
- `status` is one of `running`, `waiting`, `idle`, `interrupted`, `finished`, `unclear`.
- `liveness` is `process-table` or `unavailable`. When it is `unavailable`, an `unclear`
  status means "recap could not check what is running", not "this session is odd".
- These session fields are optional and may be absent: `title`, `dir`, `branch`, `model`,
  `agent_version`, `started`, `last_tool`, `last_file`, `todo_done`, `todo_total`, `source`,
  `unreadable`.

## How this extension reacts to a version it does not know

- **Same major version (1):** rendered normally. Unknown *fields* are ignored, which is what
  makes an additive change to recap safe.
- **Any other version:** nothing is rendered. The menu says which version recap emitted and
  which one this extension understands, and the indicator goes neutral. Guessing at the
  shape of a document we do not know is how a panel ends up quietly lying about what your
  agents are doing.

An unrecognised *status word* is treated differently: it becomes `unclear` rather than an
error, because "recap said something I do not understand about this session" is precisely
what `unclear` means, and one odd session should not blank the whole menu.

## The status vocabulary, in both spellings

recap prints emoji in a terminal; the panel draws symbolic icons, because emoji ignore the
icon theme and the light/dark preference. They mean the same thing, and the mapping lives in
one table (`src/lib/contract.js`):

| recap | this extension | Status | Meaning (recap's rule) |
|---|---|---|---|
| 🟡 | `recap-waiting-symbolic` (an exclamation mark) | `waiting` | stopped and waiting for you: a question, an answer, or a permission prompt |
| 🟢 | `recap-running-symbolic` (a play triangle) | `running` | an agent process is attached to that directory and the transcript is live |
| 🔴 | `recap-interrupted-symbolic` (a cross) | `interrupted` | not running, and the transcript ends mid-work |
| ❓ | `recap-unclear-symbolic` (a question mark) | `unclear` | recap could not tell: unreadable transcript, or no way to check what is running |
| ⚪ | `recap-idle-symbolic` (a hollow circle) | `idle` | not running; it stopped at an ordinary point |
| ✅ | `recap-finished-symbolic` (a tick) | `finished` | ended after explicitly completing what it was asked |

The rows of that table are in **urgency order**, most urgent first: it is also the order that
decides which status the single panel icon shows when several sessions disagree. `waiting`
outranks `running` deliberately — a running agent needs nothing from you.

## The fixtures

`tests/fixtures/` is this contract as data. Everything in it is output from the real recap
binary, recorded by `scripts/record-fixtures.sh` against the throwaway store recap's own
`tools/demo-store.py` builds, so no real project name is committed here. Re-record them
whenever recap's output changes; a fixture nobody can regenerate is a fixture nobody trusts.

| Fixture | What it pins |
|---|---|
| `every-status.json` | one project per status, including an unreadable session (`unclear`) and two different interruptions |
| `empty.json` | the document recap emits when nothing matches: `projects: []`, not `null`, not an empty file |
| `finished.json` | a project in the one state this machine cannot produce (see below) |
| `no-liveness.json` | `liveness: "unavailable"` — the statuses recap will not stand behind have degraded to `unclear` |

Two of those four are derived from the recording by one `jq` edit each, because this machine
cannot produce them:

- **`finished.json`** — recap reserves ✅ for an explicit completion marker, which only
  opencode's archived sessions carry, and the demo store is a Claude Code store. The edit
  flips one project (and its session) to `finished`/`opencode`.
- **`no-liveness.json`** — `liveness: "unavailable"` needs a machine where recap cannot read
  the process table. The edit sets the field and degrades `running`/`waiting` to `unclear`,
  which is what recap's own status rules do when liveness is unknown.

Both edits are in `scripts/record-fixtures.sh`, so they are re-applied on every re-recording
rather than being hand-patched into a file and forgotten.

## If recap changes

Whoever changes recap's JSON shape updates this document and re-records the fixtures. An
additive change needs neither a version bump nor anything here; anything else does, and the
extension will refuse the new version until it is taught about it.
