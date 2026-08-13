// The boundary with recap: the schema version this extension understands, and the status
// vocabulary recap defines.
//
// recap is the sole authority on which state a session is in — nothing here classifies
// anything. All this module does is say how recap's words are drawn in a panel, and how
// they rank when one line has to summarise several sessions.
//
// The vocabulary is documented in ../../docs/recap-json-contract.md and, upstream, in
// recap's own README. Keep the three in step.

/** The `version` field of `recap --json` that this extension is written against. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** The status recap reports when it cannot tell — and our answer to anything unrecognised. */
export const UNCLEAR = 'unclear';

// Urgency orders the summary: the worst state wins, so one session waiting on a question is
// visible without opening the menu. Higher is more urgent.
//
// `waiting` outranks `running` on purpose: a running agent needs nothing from you, and a
// waiting one is the whole reason to glance at the panel.
const STATUS_TABLE = [
    {
        word: 'waiting',
        emoji: '🟡',
        iconName: 'recap-waiting-symbolic',
        label: 'Waiting for you',
        urgency: 5,
        describe: 'stopped and waiting for you: a question, an answer, or a permission prompt',
    },
    {
        word: 'running',
        emoji: '🟢',
        iconName: 'recap-running-symbolic',
        label: 'Running',
        urgency: 4,
        describe: 'an agent is working on it right now',
    },
    {
        word: 'interrupted',
        emoji: '🔴',
        iconName: 'recap-interrupted-symbolic',
        label: 'Interrupted',
        urgency: 3,
        describe: 'not running, and the transcript ends mid-work',
    },
    {
        word: UNCLEAR,
        emoji: '❓',
        iconName: 'recap-unclear-symbolic',
        label: 'Unclear',
        urgency: 2,
        describe: 'recap could not tell: an unreadable transcript, or no way to check what is running',
    },
    {
        word: 'idle',
        emoji: '⚪',
        iconName: 'recap-idle-symbolic',
        label: 'Idle',
        urgency: 1,
        describe: 'not running; it stopped at an ordinary point',
    },
    {
        word: 'finished',
        emoji: '✅',
        iconName: 'recap-finished-symbolic',
        label: 'Finished',
        urgency: 0,
        describe: 'ended after explicitly completing what it was asked',
    },
];

const BY_WORD = new Map(STATUS_TABLE.map(info => [info.word, Object.freeze(info)]));

/** Every status word schema version 1 guarantees, most urgent first. */
export const STATUS_WORDS = Object.freeze(STATUS_TABLE.map(info => info.word));

/**
 * How to draw a status. A word this extension does not know — a newer recap, a corrupted
 * document — is `unclear` rather than an error: recap remains the authority, and "I do not
 * recognise that" is exactly what unclear means.
 */
export function statusInfo(word) {
    return BY_WORD.get(word) ?? BY_WORD.get(UNCLEAR);
}

export function iconNameFor(word) {
    return statusInfo(word).iconName;
}

/** The more urgent of two status words. Either may be null, meaning "nothing yet". */
export function moreUrgent(a, b) {
    if (a === null || a === undefined)
        return b ?? null;
    if (b === null || b === undefined)
        return a;
    return statusInfo(a).urgency >= statusInfo(b).urgency ? a : b;
}

/**
 * The icon for "nothing to report": no sessions, or no report to show because something
 * went wrong. Deliberately not one of the status icons — a failing refresh must not look
 * like a session that needs you.
 */
export const NEUTRAL_ICON = 'recap-symbolic';
