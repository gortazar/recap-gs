// Running recap without stopping the desktop.
//
// This code runs inside the compositor process. Everything it does that takes time is
// asynchronous — Gio.Subprocess with communicate_utf8_async, never a synchronous spawn,
// never a read on the main loop — because a slow refresh here is a frozen desktop for as
// long as it lasts, and it is one of the first things an extensions.gnome.org reviewer
// looks for.
//
// Three rules the tests pin:
//   - a run that overruns its timeout is cancelled, and the last good report stays on
//     screen marked stale, rather than the menu emptying because recap hiccupped;
//   - two refreshes never overlap: the timer and an opened menu coincide easily, and the
//     two answers would race to be the one displayed;
//   - destroy() cancels whatever is in flight and leaves no timer behind, so disabling the
//     extension mid-refresh is silent and complete.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { buildArgv, classifyOutcome } from './recap.js';

/** How long recap gets before it is cancelled. Generous: a cold cache over 25 projects. */
export const DEFAULT_TIMEOUT_SECONDS = 15;

export class RecapSource {
    constructor(options = {}) {
        const {
            spawn = spawnRecap,
            timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
            setTimer = (seconds, fn) => GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                fn();
                return GLib.SOURCE_REMOVE;
            }),
            clearTimer = id => GLib.Source.remove(id),
        } = options;

        this._spawn = spawn;
        this._timeoutSeconds = timeoutSeconds;
        this._setTimer = setTimer;
        this._clearTimer = clearTimer;

        this._destroyed = false;
        this._inFlight = null;
        this._cancellable = null;
        this._timerId = null;

        this._state = { document: null, problem: null, stale: false, updatedAt: 0 };
    }

    /** The latest state, whether or not a refresh is in flight. */
    get state() {
        return this._state;
    }

    /**
     * Run recap once and fold the answer into the state.
     *
     * Resolves with the new state — never rejects, because there is no caller in a position
     * to handle a rejection: this is invoked from a timer and from a menu-open handler.
     */
    refresh(settings) {
        if (this._destroyed)
            return Promise.resolve(this._state);
        if (this._inFlight !== null)
            return this._inFlight;

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        let timedOut = false;
        this._timerId = this._setTimer(this._timeoutSeconds, () => {
            timedOut = true;
            this._timerId = null;
            cancellable.cancel();
        });

        const run = this._spawn(buildArgv(settings), cancellable)
            .then(outcome => outcome, outcome => ({ ...outcome, timedOut, timeoutSeconds: this._timeoutSeconds }))
            .then(outcome => {
                this._clearTimeout();
                this._inFlight = null;
                this._cancellable = null;
                return this._apply(classifyOutcome(outcome));
            });

        this._inFlight = run;
        return run;
    }

    /** Cancel anything in flight and refuse to start anything else. */
    destroy() {
        this._destroyed = true;
        this._clearTimeout();
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    _clearTimeout() {
        if (this._timerId !== null) {
            this._clearTimer(this._timerId);
            this._timerId = null;
        }
    }

    _apply(result) {
        if (result.ok) {
            this._state = {
                document: result.document,
                problem: null,
                stale: false,
                updatedAt: Date.now(),
            };
        } else if (result.problem !== null) {
            // The report that was true a minute ago beats an empty menu, as long as the
            // menu says how old it is.
            this._state = {
                document: this._state.document,
                problem: result.problem,
                stale: this._state.document !== null,
                updatedAt: this._state.updatedAt,
            };
        }
        // A cancellation with no problem (disabled, or superseded) changes nothing: there
        // is no news, and nobody to tell.
        return this._state;
    }
}

/**
 * The seam: one run of recap, asynchronously.
 *
 * Resolves with `{exitStatus, stdout, stderr}`, or rejects with `{failedToStart, notFound,
 * message}` or `{cancelled: true}` — the plain-object outcomes classifyOutcome understands,
 * so that everything above this function is testable without a process.
 */
export function spawnRecap(argv, cancellable) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            reject({ failedToStart: true, notFound: isNotFound(e), message: e.message });
            return;
        }

        // Cancelling the read stops us listening; it does not stop the child. A recap
        // invoked every 30 seconds that never exits would pile up processes for the life of
        // the session, so the child goes down with the request.
        const cancelledId = cancellable?.connect(() => proc.force_exit());

        proc.communicate_utf8_async(null, cancellable, (subprocess, result) => {
            if (cancelledId !== undefined && cancelledId !== 0)
                cancellable.disconnect(cancelledId);
            try {
                const [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                resolve({
                    exitStatus: subprocess.get_exit_status(),
                    stdout: stdout ?? '',
                    stderr: stderr ?? '',
                });
            } catch (e) {
                if (isCancelled(e))
                    reject({ cancelled: true });
                else
                    reject({ failedToStart: false, exitStatus: -1, stdout: '', stderr: e.message });
            }
        });
    });
}

function isCancelled(e) {
    return typeof e?.matches === 'function' &&
        e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/**
 * Whether a spawn failure means "there is no such binary". Gio reports it from the spawn
 * domain when the name is not on PATH, and as a Gio not-found when a configured absolute
 * path does not exist.
 */
function isNotFound(e) {
    if (typeof e?.matches !== 'function')
        return false;
    return e.matches(GLib.SpawnError, GLib.SpawnError.NOENT) ||
        e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}
