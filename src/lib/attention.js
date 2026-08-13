// Which projects are asking for you right now, and which have just finished.
//
// This is the whole of the 0.2 feature that has a rule in it, and it is a pure function of
// events, the current report and the clock — no bus, no widgets, no timers. Everything that
// delivers an event (the D-Bus method, the message tray, a terminal bell) is a seam around
// this, so the rules below are tested without any of them.
//
// The division of labour with recap is the same as everywhere else in this extension:
//
//   recap says *what state a session is in*. An event says *that something happened, in this
//   directory, now*. An event never changes a status — it raises a flag beside one.
//
// So an event that arrives while recap says "idle" leaves the row saying idle, marked. If
// they disagree, recap wins the words and the flag keeps only the emphasis.

/** The two things an agent can tell us. Anything else is ignored, by design. */
export const KIND = Object.freeze({
    ASKING: 'asking',
    FINISHED: 'finished',
});

/** Repeats of the same project within this window are one event, for pulsing purposes. */
const COALESCE_MS = 4000;

/** The most events that will be *acted on* per rolling minute. */
const CEILING_PER_MINUTE = 20;

/**
 * The project an event belongs to: the longest directory recap reported that contains the
 * event's `cwd`.
 *
 * Longest wins so that a project nested inside another takes its own events. Matching is on
 * whole path components, which is the difference between `/home/p/git/aideas` and
 * `/home/p/git/aideas-old` — a plain `startsWith` puts every event from the second onto the
 * first.
 *
 * Returns the row, or null. Null is a real answer: guessing a row would put someone else's
 * question on the wrong project, which is worse than saying "something, somewhere".
 */
export function matchProject(cwd, rows) {
    const path = normalise(cwd);
    if (path === '' || !Array.isArray(rows))
        return null;

    let best = null;
    let bestLength = -1;
    for (const row of rows) {
        for (const dir of directoriesOf(row)) {
            if (!contains(dir, path))
                continue;
            if (dir.length > bestLength) {
                best = row;
                bestLength = dir.length;
            }
        }
    }
    return best;
}

function directoriesOf(row) {
    const dirs = Array.isArray(row?.dirs) ? row.dirs : [];
    const all = [...dirs, row?.dir].map(normalise).filter(dir => dir !== '');
    return [...new Set(all)];
}

/** Whether `path` is `dir` or something inside it, counted in whole path components. */
function contains(dir, path) {
    return path === dir || path.startsWith(`${dir}/`);
}

function normalise(path) {
    if (typeof path !== 'string')
        return '';
    const trimmed = path.trim();
    if (trimmed === '' || trimmed === '/')
        return trimmed === '/' ? '/' : '';
    return trimmed.replace(/\/+$/, '');
}

export class Attention {
    /**
     * @param {object} options
     *   now — the clock, injected so the rules about time are testable without waiting.
     *   coalesceMs — repeats closer together than this do not pulse again.
     *   ceilingPerMinute — how many events will be acted on per rolling minute.
     */
    constructor(options = {}) {
        const {
            now = () => Date.now(),
            coalesceMs = COALESCE_MS,
            ceilingPerMinute = CEILING_PER_MINUTE,
        } = options;

        this._now = now;
        this._coalesceMs = coalesceMs;
        this._ceiling = ceilingPerMinute;

        /** project key -> {kind, at, message} */
        this._flags = new Map();
        /** An event that matched no project: something happened, somewhere. */
        this._fleet = null;
        /** Timestamps of the events acted on, for the ceiling. */
        this._acted = [];
    }

    /**
     * Take one event, decided against the current rows.
     *
     * Returns `{accepted, key, reason}`. `accepted` is what the caller should treat as
     * "something new happened": pulse, and refresh. It is false when the event was a repeat
     * inside the coalescing window or past the per-minute ceiling — in both cases the flag
     * is still raised and still current, because the *state* is true even when the *news* is
     * not worth another flash.
     */
    record(event, rows = []) {
        const kind = event?.kind === KIND.ASKING || event?.kind === KIND.FINISHED
            ? event.kind : null;
        if (kind === null)
            return { accepted: false, key: null, reason: 'unknown-kind' };

        const at = this._now();
        const message = typeof event.message === 'string' ? event.message : '';
        const row = matchProject(event.cwd, rows);
        const key = row?.key ?? null;

        const previous = key === null ? this._fleet : this._flags.get(key) ?? null;
        const flag = {
            // Asking outranks finished: a session that finished after asking you something
            // is still a session waiting for an answer.
            kind: previous?.kind === KIND.ASKING ? KIND.ASKING : kind,
            at,
            message: message !== '' ? message : previous?.message ?? '',
        };
        if (key === null)
            this._fleet = flag;
        else
            this._flags.set(key, flag);

        if (previous !== null && at - previous.at < this._coalesceMs)
            return { accepted: false, key, reason: 'coalesced' };
        if (!this._underCeiling(at))
            return { accepted: false, key, reason: 'rate-limited' };

        this._acted.push(at);
        return { accepted: true, key, reason: '' };
    }

    _underCeiling(at) {
        const oldest = at - 60_000;
        this._acted = this._acted.filter(time => time > oldest);
        return this._acted.length < this._ceiling;
    }

    /** The flag on a project, or null. */
    flagFor(key) {
        return this._flags.get(key) ?? null;
    }

    /** Attention with no row to put it on. */
    get fleet() {
        return this._fleet;
    }

    /** How many things are asking for you. */
    get count() {
        return this._flags.size + (this._fleet === null ? 0 : 1);
    }

    /** What the panel should say, or null when nothing is pending. */
    summary() {
        if (this.count === 0)
            return null;
        let kind = null;
        for (const flag of [...this._flags.values(), this._fleet]) {
            if (flag === null)
                continue;
            kind = kind === KIND.ASKING || flag.kind === KIND.ASKING ? KIND.ASKING : flag.kind;
        }
        return { kind, count: this.count };
    }

    /**
     * Fold in a fresh report: an `asking` flag on a project recap no longer calls waiting has
     * been answered, so it goes.
     *
     * A `finished` flag survives — "it finished" is news whatever the session is doing now —
     * and so does any flag whose project is missing from the report, because recap being
     * unavailable is not evidence that a question went away.
     */
    reconcile(rows) {
        if (!Array.isArray(rows))
            return;
        const byKey = new Map(rows.map(row => [row.key, row]));
        for (const [key, flag] of [...this._flags]) {
            if (flag.kind !== KIND.ASKING)
                continue;
            const row = byKey.get(key);
            if (row !== undefined && statusOf(row) !== 'waiting')
                this._flags.delete(key);
        }
    }

    /** You opened the menu: everything it showed you has been seen. */
    acknowledgeVisible(rows) {
        for (const row of Array.isArray(rows) ? rows : [])
            this._flags.delete(row?.key);
        // Fleet attention has no row to be shown on, so an opened menu is the only thing
        // that can ever clear it.
        this._fleet = null;
    }

    /** You clicked a row. */
    acknowledge(key) {
        this._flags.delete(key);
    }

    /** Everything goes: the extension is being disabled. */
    clear() {
        this._flags.clear();
        this._fleet = null;
        this._acted = [];
    }
}

function statusOf(row) {
    // Defended, because this is fed straight from a decoded report.
    return typeof row?.statusWord === 'string' ? row.statusWord : '';
}
