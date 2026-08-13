# recap for GNOME Shell

Your coding agents are working in six directories at once. One of them stopped ten minutes
ago to ask you a question, and you have no idea which. This puts the answer in the top bar.

```sh
curl -fsSL https://raw.githubusercontent.com/gortazar/recap-gs/main/install.sh | sh
```

Then log out and back in, and the indicator appears. It needs
[`recap`](https://github.com/gortazar/recap) on your `PATH` — that is where the report comes
from — and says so plainly if recap is not installed.

![the panel indicator](screenshots/panel.png)

The icon is the most urgent thing happening and the number is how many are in that state, so
"something is waiting for you" is visible without opening anything. Open it for the list:

![the menu](screenshots/menu.png)

One row per project, newest first, each with recap's own one-sentence account of what that
session was asked and where it got to. **Click a row and the session resumes** — a terminal
opens in the directory that session was running in, and `claude --resume` (or
`opencode --session`) picks it up where it stopped.

## Notifications: the moment it happens

Polling every 30 seconds means you learn that a session is waiting for you up to 30 seconds
late. Your agents can tell the panel instead, the moment it happens:

```sh
~/.local/share/gnome-shell/extensions/recap@recap-gs.patxi/hooks/install-hooks.sh
```

It shows you exactly what it will change and asks before changing it, backs up your
settings first, merges rather than overwrites, leaves hooks you wrote yourself alone, and
can be undone with `--uninstall`. The same command is on the **Detection** page of the
preferences window, with a button that copies it.

What it wires up:

| Agent | Event | What the panel does |
|---|---|---|
| Claude Code | `Notification` — waiting for you, or for permission | marks the project **asking** |
| Claude Code | `Stop` — finished answering | marks the project **finished** |
| opencode | `session.idle` — finished working | marks the project **finished** |

opencode has no equivalent of Claude Code's `Notification`, so it gets *finished* only and
stays on the poll for *asking*. That is documented rather than faked: inventing an "asking"
from an idle event would put a question mark on a session that never asked anything.

![the panel with a project asking for you](screenshots/panel-flagged.png)

The flagged project moves to the top of the menu, marked, with the agent's own words under
recap's sentence:

![the menu with a flagged project](screenshots/menu-flagged.png)

It stops asking when you look: opening the menu clears the marks it showed you (when you
close it, so they last long enough to read), clicking a row clears that row, and a session
recap reports as no longer waiting clears itself at the next refresh. Nothing clears on a
timer — a question asked while you were away from the machine is still a question when you
get back.

**Restart your agents after installing the hooks.** A session that was already running does
not pick them up.

### The other two sources

Both are off by default and live on the **Detection** page:

- **Desktop notifications** — for agents that already `notify-send`. Configurable by
  application name.
- **A terminal asking for attention** — a bell. Off by default because *any* bell from *any*
  terminal raises it, and a signal that lies is worse than one that is late.

Neither can say which project it is about, so both mark the panel rather than a row.

### Under the hood

`recap-gs-notify asking` reads the agent's hook JSON on stdin and makes one D-Bus call. It
always exits 0, it is bounded by a timeout, and it does nothing at all when the extension is
not running — a hook that can fail the agent it is attached to is this feature's bug, not the
agent's. The interface it calls is specified in
[`docs/event-interface.md`](docs/event-interface.md) and treated as public: a shim installed
months ago keeps working.

To turn it all off: `hooks/install-hooks.sh --uninstall`, or just switch the sources off in
preferences.

## What it shows

The vocabulary is recap's, and this extension decides none of it: it reads `recap --json`
and draws what it says.

| | Status | What it means |
|---|---|---|
| exclamation mark | **waiting** | stopped and waiting for you: a question, an answer, or a permission prompt |
| play triangle | **running** | an agent is working in that directory right now |
| cross | **interrupted** | not running, and the transcript ends mid-work — the closed-the-laptop case |
| question mark | **unclear** | recap could not tell: an unreadable transcript, or no way to check what is running |
| hollow circle | **idle** | not running; it stopped at an ordinary point |
| tick | **finished** | ended after explicitly completing what it was asked |

Those are the same six states recap prints as 🟡 🟢 🔴 ❓ ⚪ ✅ in a terminal; the panel draws
them as symbolic icons instead, so they follow your icon theme and your light/dark
preference. The mapping is spelled out in both directions in
[`docs/recap-json-contract.md`](docs/recap-json-contract.md).

**waiting outranks running** wherever one icon has to stand for several sessions. A running
agent needs nothing from you; a waiting one is the reason to look.

## Preferences

![the preferences window](screenshots/preferences.png)

Refresh interval, the path to recap, which of recap's filters to pass (`--since`, `--agent`,
project roots), whether to show the count, whether to list finished and idle sessions, and
which terminal to open when you click a row.

## What it does not do

- **It never reads a transcript.** recap owns every rule about what a session's state is; two
  implementations of that would eventually disagree, and then the panel and the terminal
  would be telling you different things about the same session.
- **It never blocks the shell.** recap is run through `Gio.Subprocess` with
  `communicate_utf8_async`, with a timeout that cancels the run *and* kills the child. A slow
  or hung recap leaves the last report on screen, labelled with its age.
- **It does not poll behind your back.** Refreshes stop while the screen is locked or the
  session has been idle for five minutes, and resume the moment you come back.
- **It does not interrupt you.** No desktop notifications of its own, no dialogs, no sound.
  When something asks for you the panel changes and pulses three times — bounded, because an
  indicator that moves until acknowledged is an accessibility problem as much as an
  irritation — and then waits.
- **It never writes to an agent's state.** The only thing it starts is the terminal you asked
  for by clicking a row.

## Requirements

- GNOME Shell 46, 47, 48, 49 or 50.
- [`recap`](https://github.com/gortazar/recap) on your `PATH` (or its path set in
  preferences). Without it the extension installs and runs perfectly happily, and the menu
  tells you what is missing.

## Development

```sh
nix develop                              # gjs, eslint, glib, dbus, the packer
dbus-run-session -- gjs -m tests/run.js  # the headless suite: 237 tests, no compositor
nix flake check                          # lint + that suite + a schema compile + the zip
nix build                                # the packed .shell-extension.zip
```

The suite needs a session bus because the event interface is tested by calling it over a real
one — a name being owned, a call arriving, the name going away again on disable are not
things a stand-in can vouch for.

Everything with a decision in it lives in [`src/lib/`](src/lib), which imports only GLib and
Gio — no `St`, no `resource:///org/gnome/shell`. That is what makes the suite above possible:
decoding, the status vocabulary, the row model, the panel summary, error classification, the
refresh schedule, the resume command lines and the whole attention model are all tested under
plain `gjs`.
[`src/extension.js`](src/extension.js) is creation and destruction and nothing else.

Two things the suite cannot ask, so a script does instead:

```sh
ci/smoke-test.sh                  # boot a real headless shell and load the extension into it
scripts/screenshot.sh             # the same run, with the pictures above taken from it
scripts/install-local.sh          # install the working tree for a hand-try
scripts/record-fixtures.sh        # re-record tests/fixtures from the real recap binary
```

`ci/smoke-test.sh` starts a headless GNOME Shell with a throwaway `HOME` of its own, lets it
load the extension out of `enabled-extensions` the way a session would, checks that the panel
button appears and its menu fills from a real subprocess, then enables and disables the
extension five times and asserts that nothing is left attached to the main loop. It touches
neither your session nor your dconf.

It is not in CI: GitHub's runners have no GNOME Shell, and installing one plus a virtual
monitor to run it is a much bigger dependency than the thing it checks. Run it by hand before
a release.

## The contract with recap

`recap --json` is a versioned public interface, and this extension is written against
**schema version 1**. A report at any other version is refused with a message saying so,
rather than rendered on a guess. [`tests/fixtures/`](tests/fixtures) holds recorded output
from the real binary — every status, an empty report, an unreadable session, and a machine
with no process table — and `docs/recap-json-contract.md` says what version 1 guarantees and
what happens when it is broken.

## Licence

GPL-2.0-or-later, like GNOME Shell itself. See [LICENSE](src/LICENSE).
