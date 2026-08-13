// When to ask recap again.
//
// A GLib timeout source, created when the indicator is built and removed when it is
// destroyed — one source, never two, and never one left behind. The timer functions are
// injectable so that the whole policy is testable in a plain gjs run: a rule about time
// that can only be checked by waiting is a rule nobody checks.

import GLib from 'gi://GLib';

export class Scheduler {
    /**
     * @param {object} options
     *   intervalSeconds — how long between refreshes.
     *   onTick — what a refresh is.
     *   isSuppressed — when true, the tick is skipped but the schedule keeps running.
     *     Polling behind a lock screen spends battery on a report nobody can see.
     */
    constructor(options = {}) {
        const {
            intervalSeconds = 30,
            onTick = () => {},
            isSuppressed = () => false,
            setTimer = (seconds, fn) => GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                fn();
                return GLib.SOURCE_REMOVE;
            }),
            clearTimer = id => GLib.Source.remove(id),
        } = options;

        this._intervalSeconds = intervalSeconds;
        this._onTick = onTick;
        this._isSuppressed = isSuppressed;
        this._setTimer = setTimer;
        this._clearTimer = clearTimer;
        this._timerId = null;
        this._running = false;
    }

    /** Refresh now, then every interval. */
    start() {
        if (this._running)
            return;
        this._running = true;
        this._tick();
    }

    /** Stop refreshing and remove the timer. Safe to call twice, and after destroy. */
    stop() {
        this._running = false;
        this._clear();
    }

    /** Change the interval. Takes effect now, not after the interval already running. */
    setInterval(seconds) {
        this._intervalSeconds = seconds;
        if (this._running) {
            this._clear();
            this._schedule();
        }
    }

    /**
     * Refresh right now, whatever the schedule said and whether or not refreshes are
     * suppressed — this is somebody opening the menu, so there is somebody looking. The
     * interval starts over, so the next scheduled refresh is a full interval away.
     */
    wake() {
        this._onTick();
        if (this._running) {
            this._clear();
            this._schedule();
        }
    }

    /**
     * Something happened that this schedule did not know about — an agent event — so refresh
     * now, unless refreshing is suppressed.
     *
     * The difference from wake(): wake() is somebody looking at the menu, so it refreshes
     * whatever the state of the machine. A nudge comes from a process, and a locked or idle
     * machine should not start spawning because an agent finished a turn. The flag is raised
     * either way; only the subprocess waits.
     */
    nudge() {
        if (this._isSuppressed())
            return;
        this._onTick();
        if (this._running) {
            this._clear();
            this._schedule();
        }
    }

    _tick() {
        if (!this._isSuppressed())
            this._onTick();
        this._schedule();
    }

    _schedule() {
        this._timerId = this._setTimer(this._intervalSeconds, () => {
            this._timerId = null;
            if (this._running)
                this._tick();
        });
    }

    _clear() {
        if (this._timerId !== null) {
            this._clearTimer(this._timerId);
            this._timerId = null;
        }
    }
}
