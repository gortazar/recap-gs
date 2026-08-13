// The smoke-test driver. Test-only: it is installed into the throwaway home that
// ci/smoke-test.sh builds, and never into anyone's session and never into the packed zip.
//
// It exists because the two things most worth knowing about a shell extension cannot be
// asked of it outside a compositor:
//
//   1. does it actually load, render a panel button and fill a menu with real rows?
//   2. does disabling it leave anything behind?
//
// Everything it learns is written to $RECAP_DRIVER_RESULT as JSON, and then the shell is
// asked to quit. The script that started the shell reads that file and decides.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const TARGET = 'recap@recap-gs.patxi';
const CYCLES = 5;
const BUS_NAME = 'org.gnome.Shell.Extensions.RecapGs';

// Module scope, because the shell can enable an extension more than once in a session and
// this driver is a script that must run exactly once: keeping the record and the "already
// started" flag out of the instance means a second enable() cannot quietly begin a second
// run, nor throw away the first one's findings.
const results = { checks: [], failures: [] };
let started = false;

// ExtensionState, as the shell numbers it.
const STATE_ACTIVE = 1;
const STATE_DISABLED = 2;

/**
 * Every GLib source the target extension creates while it is enabled, so that a source it
 * forgets to remove can be named rather than guessed at. Attribution is by stack: the only
 * frames that matter are the ones in the extension's own files.
 */
class SourceLedger {
    constructor(uuid) {
        this._uuid = uuid;
        this._live = new Map();
        this._patched = false;
    }

    install() {
        if (this._patched)
            return;
        this._patched = true;

        this._realTimeoutSeconds = GLib.timeout_add_seconds;
        this._realTimeout = GLib.timeout_add;
        this._realRemove = GLib.Source.remove;

        const ledger = this;
        GLib.timeout_add_seconds = function (...args) {
            const id = ledger._realTimeoutSeconds.apply(this, args);
            ledger._note(id, 'timeout_add_seconds');
            return id;
        };
        GLib.timeout_add = function (...args) {
            const id = ledger._realTimeout.apply(this, args);
            ledger._note(id, 'timeout_add');
            return id;
        };
        GLib.Source.remove = function (id) {
            ledger._live.delete(id);
            return ledger._realRemove.call(this, id);
        };
    }

    uninstall() {
        if (!this._patched)
            return;
        GLib.timeout_add_seconds = this._realTimeoutSeconds;
        GLib.timeout_add = this._realTimeout;
        GLib.Source.remove = this._realRemove;
        this._patched = false;
    }

    _note(id, how) {
        const stack = new Error().stack ?? '';
        if (stack.includes(this._uuid))
            this._live.set(id, how);
    }

    /** Sources the extension created that are still attached to the main context. */
    leaked() {
        const context = GLib.MainContext.default();
        const leaks = [];
        for (const [id, how] of this._live) {
            if (context.find_source_by_id(id) !== null)
                leaks.push(`${how} #${id}`);
        }
        return leaks;
    }

    forget() {
        this._live.clear();
    }
}

export default class DriverExtension extends Extension {
    enable() {
        this._results = results;
        this._ledger = new SourceLedger(TARGET);
        this._shots = GLib.getenv('RECAP_DRIVER_SHOTS');
        this._manager = Main.extensionManager;

        if (started)
            return;
        started = true;

        // Everything below is a single asynchronous script; the shell's main loop keeps
        // running throughout, which is the point.
        this._run().catch(e => {
            this._fail('driver', `${e}\n${e.stack}`);
            this._finish();
        });
    }

    disable() {
        this._ledger?.uninstall();
        this._ledger = null;
    }

    async _run() {
        this._ledger.install();

        // A shell that has just started sits in the overview, which is not what anyone's
        // desktop looks like while they glance at the top bar.
        Main.overview.hide();
        await sleep(500);

        // 1. It loads. The shell enables it out of enabled-extensions, the way a real
        // session does — asking for it by hand while the shell is still working through its
        // own startup is a race, and one this test lost about one run in three. Waited for
        // rather than slept through: how long startup takes depends on the machine.
        await this._waitFor(() => indicatorOf() !== null, 25000);

        const state = this._manager.lookup(TARGET)?.state;
        this._check('loads', state === STATE_ACTIVE,
            `extension state is ${state} (${STATE_ACTIVE} is enabled)`);

        const indicator = indicatorOf();
        this._check('adds a panel button', indicator !== null,
            'nothing was added to the status area');
        if (!indicator) {
            this._finish();
            return;
        }

        // 2. It renders a real report. The refresh is a subprocess, so give it a moment —
        // and wait for *project* rows, not just for any row: the menu says "Asking recap…"
        // straight away, and a check that counted that would pass on a broken extension.
        await this._waitFor(() => rowCount(indicator) > 0, 10000);
        this._check('fills the menu from recap', rowCount(indicator) > 0,
            `after 10 seconds the menu holds ${menuItemCount(indicator)} items and no ` +
            'project rows');
        this._check('says something in the panel',
            indicator.accessible_name !== null && indicator.accessible_name !== '',
            `the panel button describes itself as "${indicator.accessible_name}"`);
        this._results.panel = indicator.accessible_name;
        this._results.rows = rowCount(indicator);

        await this._screenshot('panel.png');

        // 3. The menu opens, with the rows in it.
        indicator.menu.open(false);
        await sleep(700);
        this._check('opens its menu', indicator.menu.isOpen, 'the menu did not open');
        await this._screenshot('menu.png');
        indicator.menu.close(false);
        await sleep(300);

        // 3a. An agent event, delivered the way an agent delivers one: a separate process
        // running the shim, talking over the bus. Nothing here reaches into the extension.
        this._check('exports the event interface', nameHasOwner(BUS_NAME),
            'nothing owns ' + BUS_NAME + ' while the extension is enabled');

        const shim = `${extensionDir()}/bin/recap-gs-notify`;
        const payload = JSON.stringify({
            session_id: 'bbbb2222',
            cwd: '/home/demo/projects/blog-pipeline',
            hook_event_name: 'Notification',
            message: 'Claude needs your permission to run git push',
        });
        const delivered = await runShim(shim, 'asking', payload);
        this._check('the shim exits 0', delivered.status === 0,
            `recap-gs-notify exited ${delivered.status}: ${delivered.stderr}`);

        await this._waitFor(() => hasStyleClass(indicator, 'recap-asking'), 5000);
        this._check('an event lights the panel up',
            hasStyleClass(indicator, 'recap-asking'),
            `the panel button's style classes are ${styleClassesOf(indicator)}`);

        // The flagged row leads the menu and carries what the agent said.
        indicator.menu.open(false);
        await sleep(600);
        const firstRow = firstRowText(indicator);
        this._check('the flagged project leads the menu',
            firstRow.includes('blog-pipeline'),
            `the first row reads ${JSON.stringify(firstRow)}`);
        this._check('the row carries the agent\'s own words',
            firstRow.includes('permission to run git push'),
            `the first row reads ${JSON.stringify(firstRow)}`);
        await this._screenshot('menu-flagged.png');
        await this._screenshot('panel-flagged.png');

        // Visiting the menu is acknowledgement, taken when it closes: the marks have to
        // survive long enough to be read.
        this._check('the flag survives the menu being open',
            hasStyleClass(indicator, 'recap-asking'),
            'the flag was cleared before it could be read');
        indicator.menu.close(false);
        await sleep(800);
        this._check('closing the menu clears the flag',
            !hasStyleClass(indicator, 'recap-asking'),
            `the panel button's style classes are ${styleClassesOf(indicator)}`);

        // The pulse is bounded, and it does not leave the icon half-faded or a source
        // behind — the two ways an animation in the compositor goes wrong.
        await sleep(2500);
        this._check('the pulse finished at full opacity', iconOpacity(indicator) === 255,
            `the icon's opacity is ${iconOpacity(indicator)}`);

        // 3b. The preferences window opens, in its own process, and is worth a picture too.
        if (this._shots) {
            try {
                this._manager.openExtensionPrefs(TARGET, '', {});
                await this._waitFor(() => prefsWindow() !== null, 20000);
                // Opening it is not the same as looking at it: the window arrives behind
                // the overview, and a screenshot then is a screenshot of the wallpaper.
                const window = prefsWindow();
                if (window) {
                    Main.activateWindow(window);
                    Main.overview.hide();
                }
                await sleep(2500); // let it finish drawing itself
                this._results.windows = global.get_window_actors().map(a => ({
                    id: a.meta_window.get_gtk_application_id(),
                    wmClass: a.meta_window.get_wm_class(),
                    title: a.meta_window.get_title(),
                }));
                this._check('opens its preferences', prefsWindow() !== null,
                    'no preferences window appeared');
                await this._screenshot('preferences.png');
                prefsWindow()?.delete(global.get_current_time());
                await sleep(500);
            } catch (e) {
                this._check('opens its preferences', false, String(e));
            }
        }

        // 4. Nothing is left behind. Five rounds, because a leak that only happens on the
        // second enable is the interesting kind.
        this._ledger.forget();
        for (let i = 0; i < CYCLES; i++) {
            this._manager.disableExtension(TARGET);
            // Wait for the manager's own bookkeeping, not just for the actor to vanish:
            // asking it to enable an extension it still considers enabled does nothing at
            // all, and the round after that would look like a leak.
            await this._waitFor(() => stateOf() === STATE_DISABLED && indicatorOf() === null, 15000);
            this._check(`round ${i + 1}: the panel button goes`, indicatorOf() === null,
                `state is ${stateOf()} and the indicator is ${indicatorOf() ? 'still there' : 'gone'}`);

            this._manager.enableExtension(TARGET);
            await this._waitFor(() => indicatorOf() !== null, 15000);
            this._check(`round ${i + 1}: the panel button comes back`, indicatorOf() !== null,
                `state is ${stateOf()} and nothing was added to the status area`);
        }

        this._manager.disableExtension(TARGET);
        await this._waitFor(() => indicatorOf() === null, 5000);
        // Long enough for anything the extension started on its way out to have run.
        await sleep(1000);

        const leaks = this._ledger.leaked();
        this._check('leaves no timer behind', leaks.length === 0,
            `still attached to the main loop: ${leaks.join(', ')}`);
        // A bus name left owned by a disabled extension swallows every hook call after it.
        await this._waitFor(() => !nameHasOwner(BUS_NAME), 5000);
        this._check('gives the bus name back', !nameHasOwner(BUS_NAME),
            BUS_NAME + ' is still owned after the extension was disabled');
        this._results.cycles = CYCLES;

        this._finish();
    }

    /**
     * Save the whole stage to a PNG.
     *
     * Through Shell.Screenshot rather than the org.gnome.Shell.Screenshot D-Bus method:
     * that method only answers a short list of well-known callers, and a test driver is not
     * one of them. This is the same object the shell's own screenshot service uses.
     */
    async _screenshot(name) {
        if (!this._shots)
            return;
        const path = `${this._shots}/${name}`;
        try {
            const Shell = (await import('gi://Shell')).default;
            const stream = Gio.File.new_for_path(path)
                .replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            const shooter = new Shell.Screenshot();
            await new Promise((resolve, reject) => {
                shooter.screenshot(false, stream, (source, result) => {
                    try {
                        source.screenshot_finish(result);
                        stream.close(null);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            this._results.checks.push({ name: `screenshot ${name}`, ok: true });
        } catch (e) {
            // A missing screenshot is not a failing extension; say so and carry on.
            this._results.checks.push({
                name: `screenshot ${name}`, ok: false, detail: String(e),
            });
        }
    }

    _waitFor(predicate, timeoutMs) {
        const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
        return (async () => {
            while (!predicate() && GLib.get_monotonic_time() < deadline)
                await sleep(200);
        })();
    }

    _check(name, ok, detail) {
        this._results.checks.push({ name, ok, detail: ok ? '' : detail });
        if (!ok)
            this._results.failures.push(`${name}: ${detail}`);
    }

    _fail(name, detail) {
        this._check(name, false, detail);
    }

    _finish() {
        const path = GLib.getenv('RECAP_DRIVER_RESULT');
        if (path) {
            GLib.file_set_contents(path,
                new TextEncoder().encode(JSON.stringify(this._results, null, 2)));
        }
        this._ledger?.uninstall();
        // The script that started this shell is waiting for it to exit. Mutter has moved
        // the way to ask for that around between 46 and 50, so try both spellings.
        try {
            global.context.terminate();
        } catch (e) {
            void e;
            Meta.quit(Meta.ExitCode.SUCCESS);
        }
    }
}

/** Project rows, as opposed to the notes the menu shows when there are none. */
function rowCount(indicator) {
    try {
        return indicator.menu.box.get_children()
            .filter(child => (child.style_class ?? '').includes('recap-row')).length;
    } catch (e) {
        void e;
        return 0;
    }
}

/** The preferences window, which is a window of its own process, not part of the shell. */
function prefsWindow() {
    for (const actor of global.get_window_actors()) {
        const window = actor.meta_window;
        // Both spellings: this window arrives from Wayland with no GTK application id set,
        // and only its wm_class says who it belongs to.
        const id = window.get_gtk_application_id() ?? '';
        const wmClass = window.get_wm_class() ?? '';
        if (id.includes('org.gnome.Shell.Extensions') || wmClass.includes('org.gnome.Shell.Extensions'))
            return window;
    }
    return null;
}

function extensionDir() {
    return `${GLib.get_user_data_dir()}/gnome-shell/extensions/${TARGET}`;
}

function nameHasOwner(name) {
    try {
        const reply = Gio.DBus.session.call_sync(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'NameHasOwner', new GLib.Variant('(s)', [name]),
            null, Gio.DBusCallFlags.NONE, 2000, null);
        return reply.deepUnpack()[0];
    } catch (e) {
        void e;
        return false;
    }
}

/** Run the shim as an agent would: a separate process, payload on stdin. */
function runShim(path, kind, payload) {
    return new Promise((resolve, reject) => {
        const proc = Gio.Subprocess.new([path, kind],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(payload, null, (subprocess, result) => {
            try {
                const [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                resolve({ status: subprocess.get_exit_status(), stdout, stderr });
            } catch (e) {
                reject(e);
            }
        });
    });
}

function styleClassesOf(indicator) {
    return indicator.get_style_class_name?.() ?? '';
}

function hasStyleClass(indicator, name) {
    return styleClassesOf(indicator).split(/\s+/).includes(name);
}

function iconOpacity(indicator) {
    const icon = indicator.get_children()
        .flatMap(child => child.get_children?.() ?? [])
        .find(child => child.constructor?.name?.includes('Icon'));
    return icon?.opacity ?? 255;
}

/** Everything the first row of the menu says, joined. */
function firstRowText(indicator) {
    const [first] = indicator.menu.box.get_children()
        .filter(child => (child.style_class ?? '').includes('recap-row'));
    if (!first)
        return '';
    const texts = [];
    const walk = actor => {
        if (typeof actor.get_text === 'function')
            texts.push(actor.get_text());
        for (const child of actor.get_children?.() ?? [])
            walk(child);
    };
    walk(first);
    return texts.join(' ');
}

function stateOf() {
    return Main.extensionManager.lookup(TARGET)?.state;
}

function indicatorOf() {
    return Main.panel.statusArea[TARGET] ?? null;
}

function menuItemCount(indicator) {
    try {
        return indicator.menu.box.get_children().length;
    } catch (e) {
        void e;
        return 0;
    }
}

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}
