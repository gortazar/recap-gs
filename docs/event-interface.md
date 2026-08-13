# The event interface

How an agent tells the panel that a session just asked you something, or just finished.

This is a **public interface**. A shim somebody installed into their agent's hooks months ago
keeps calling it, and nothing here changes in a way that would break it without the name
changing too.

## The surface

| | |
|---|---|
| Bus | the session bus |
| Name | `org.gnome.Shell.Extensions.RecapGs` |
| Object | `/org/gnome/Shell/Extensions/RecapGs` |
| Interface | `org.gnome.Shell.Extensions.RecapGs` |
| Method | `Event(kind: s, payload: s) → ()` |

The name is owned while the extension is enabled and given back when it is disabled. There is
no signal, no property and no other method.

```sh
gdbus call --session \
  --dest org.gnome.Shell.Extensions.RecapGs \
  --object-path /org/gnome/Shell/Extensions/RecapGs \
  --method org.gnome.Shell.Extensions.RecapGs.Event \
  asking '{"cwd": "/home/you/git/project", "message": "needs your permission to run git push"}'
```

You do not normally write that: `bin/recap-gs-notify asking` does it, reading the payload from
stdin, and `hooks/install-hooks.sh` wires your agents up to *it*.

### `kind`

`asking` or `finished`.

- **`asking`** — the session stopped and wants you: a question, a permission prompt. Claude
  Code's `Notification` hook.
- **`finished`** — the session finished what it was doing. Claude Code's `Stop` hook,
  opencode's `session.idle`.

**Any other value is ignored, silently and successfully.** That is deliberate: a newer shim
calling an older extension must be harmless, so adding a third kind later cannot break
anyone.

### `payload`

The agent's own hook JSON, passed through untouched — the shim does not parse it, so it needs
no `jq` and cannot fall behind an agent's schema.

Read from it:

| Field | Required | Used for |
|---|---|---|
| `cwd` | **yes**, and must be absolute | matching the event to a project |
| `message` | no | the line shown under recap's sentence on the flagged row |
| `session_id` | no | nothing yet; recorded because it costs nothing |
| `agent` | no | the agent's name, when it says |
| `transcript_path` | no | recognising Claude Code when `agent` is absent |

Everything else is ignored, including fields an agent adds later.

The event is ignored — successfully, with a reason in the log at debug level — when: the
payload is over 16 KiB, is not JSON, is not a JSON object, or has no absolute `cwd`. Without a
`cwd` there is no row to flag, and resolving a relative path against some current directory
would be inventing a fact.

## What it does with it

1. **It matches the event to a project**: the longest directory recap reported that contains
   `cwd`, compared component by component, so `/home/you/git/project-old` never lands on
   `/home/you/git/project`. An event that matches nothing raises fleet attention — the panel
   lights, no row is marked — rather than being dropped or guessed onto somebody else's row.
2. **It raises a flag**, which the panel and the menu draw. `asking` outranks `finished`.
3. **It asks recap for a fresh report**, unless the screen is locked or the session is idle,
   in which case the flag is raised and nothing is spawned.

It never changes what a row *says*. recap owns every status and every sentence; an event only
decides what deserves your eye right now.

## What it will not do

- **It will not block you.** The method returns nothing, returns immediately, and does its
  work afterwards. A hook that waits on the compositor makes the agent it is attached to feel
  slow.
- **It will not fail your hook.** The shim exits 0 whatever happens — extension disabled, no
  bus, no `gdbus`, a slow reply — because a hook that can fail the agent it is attached to is
  this feature's bug, not the agent's.
- **It will not run anything from the payload.** Nothing in it is executed, spawned, or
  interpolated into a command. The message becomes the text of a label, and a label
  interprets nothing.
- **It will not strobe.** Repeats for one project within a few seconds coalesce, and a
  per-minute ceiling means a hook stuck in a loop cannot turn the panel into a strobe. The
  flag still updates; only the flash is dropped.

## Rate limits, exactly

| | |
|---|---|
| Coalescing window | 4 seconds per project |
| Ceiling | 20 acted-on events per rolling minute |
| Payload cap | 16 KiB (the shim also caps stdin at 16 KiB) |
| Message cap | 200 characters, control characters collapsed to spaces |

## Versioning

The method signature and the two `kind` values are the promise. Additions that cannot break a
caller — another optional field read from the payload, another `kind` — can happen in any
release. Anything else needs a new interface name, because the old shims will still be out
there calling this one.
