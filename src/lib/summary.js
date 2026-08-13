// What the top bar says without being opened.
//
// One button has to stand for a whole fleet, so the worst state wins: if anything is
// waiting for you, the panel says waiting, and the count is how many. That is the question
// the indicator exists to answer — "is anything blocked on me?" — and it is answerable at a
// glance only if it is the thing that outranks everything else.
//
// The counts are of projects, which is what a row is. recap already collapses a project's
// sessions to the busiest one, and re-deriving a session-level count here would be this
// extension inventing a number recap did not report.

import { NEUTRAL_ICON, STATUS_WORDS, statusInfo, moreUrgent } from './contract.js';

/**
 * Summarise the rows for the panel button.
 *
 * Returns `{iconName, label, tooltip}` — label is the short text beside the icon, empty
 * when there is nothing worth crowding the top bar with.
 */
export function summarise(rows, options = {}) {
    const { showCount = true } = options;

    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            iconName: NEUTRAL_ICON,
            label: '',
            tooltip: 'No agent sessions',
        };
    }

    const counts = new Map();
    let worst = null;
    for (const row of rows) {
        const word = statusInfo(row.statusWord).word;
        counts.set(word, (counts.get(word) ?? 0) + 1);
        worst = moreUrgent(worst, word);
    }

    const parts = [];
    for (const word of STATUS_WORDS) {
        const n = counts.get(word);
        if (n)
            parts.push(`${n} ${statusInfo(word).label.toLowerCase()}`);
    }

    return {
        iconName: statusInfo(worst).iconName,
        label: showCount ? String(counts.get(worst)) : '',
        tooltip: parts.join(', '),
    };
}

/** The panel when there is no report to show. Neutral, and never an alarm. */
export function summariseProblem(problem) {
    return {
        iconName: NEUTRAL_ICON,
        label: '',
        tooltip: problem?.title ?? 'recap is unavailable',
    };
}
