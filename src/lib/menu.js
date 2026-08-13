// What the menu contains, decided without a compositor.
//
// extension.js turns this into St widgets and nothing else, which is what keeps the
// interesting decisions — is this report too old to trust? is an empty list an answer or a
// failure? — under test in a plain gjs run.
//
// Every state of the world produces something to read. A menu that opens onto nothing tells
// the user that the extension is broken, when the truth is usually "recap is not installed"
// or "you have not run an agent today".

import { buildRows, ageLabel } from './rows.js';
import { summarise, summariseProblem, summariseAttention } from './summary.js';
import { KIND } from './attention.js';

/**
 * Build the menu from the source's state.
 *
 * `notes` are the lines that are not sessions: a problem, an explanation of an empty list,
 * or a warning that what is on screen is old. They are the reason this returns a structure
 * rather than just an array of rows.
 */
export function buildMenu(state, settings = {}, now = Date.now(), attention = null) {
    const { document = null, problem = null, stale = false, updatedAt = 0 } = state ?? {};
    const notes = [];

    if (document === null) {
        if (problem !== null) {
            notes.push({ kind: 'problem', title: problem.title, detail: problem.detail });
            return {
                rows: [],
                notes: withFleetNote(notes, attention),
                summary: summariseAttention(attention) ?? summariseProblem(problem),
            };
        }
        // Nothing has come back yet. Saying so is better than an empty list that looks like
        // an answer.
        notes.push({
            kind: 'loading',
            title: 'Asking recap…',
            detail: '',
        });
        return {
            rows: [],
            notes: withFleetNote(notes, attention),
            summary: summariseAttention(attention) ?? summariseProblem(null),
        };
    }

    const projectCount = Array.isArray(document.projects) ? document.projects.length : 0;
    const rows = flagged(buildRows(document, {
        hideFinished: settings.hideFinished,
        hideIdle: settings.hideIdle,
        now,
        // A project that just asked you something is never hidden by a filter meant for
        // quiet ones.
        keep: key => attention?.flagFor(key) != null,
    }), attention);

    if (stale || problem !== null) {
        const age = ageLabel(new Date(updatedAt).toISOString(), now);
        notes.push({
            kind: 'stale',
            title: age !== '' ? `Showing the report from ${age}` : 'Showing an older report',
            detail: problem?.title ?? '',
        });
    } else if (projectCount === 0) {
        notes.push({
            kind: 'empty',
            title: settings.since
                ? `No agent sessions in the last ${settings.since}`
                : 'No agent sessions to report',
            detail: '',
        });
    } else if (rows.length === 0) {
        // The report had something in it; the user's own filters took it away. Blaming
        // recap here would send someone debugging the wrong thing.
        notes.push({
            kind: 'hidden',
            title: `${projectCount} ${projectCount === 1 ? 'project' : 'projects'} hidden by your filters`,
            detail: 'Finished and idle sessions can be shown again in preferences.',
        });
    } else if (document.liveness === 'unavailable') {
        // recap could not read the process table, so it will not claim anything is running.
        // Without this line the menu looks like a fleet of mysteries.
        notes.push({
            kind: 'liveness',
            title: 'recap could not check what is running',
            detail: 'Sessions are shown as unclear because there was no way to tell which ' +
                'agents are still running.',
        });
    }

    // Attention outranks everything, including a stale report: an event did not come from
    // recap, so recap being unwell says nothing about whether a session just asked you a
    // question. Otherwise a stale report must not drive the panel — the icon means "as far
    // as I know", and an alarm raised by a report from ten minutes ago is worse than none.
    const summary = summariseAttention(attention) ??
        ((stale || problem !== null)
            ? summariseProblem(problem)
            : summarise(rows, { showCount: settings.showCount !== false }));

    return { rows, notes: withFleetNote(notes, attention), summary };
}


/**
 * Flagged rows first, the rest in recap's order.
 *
 * 0.1's rule was that recap owns the order and this extension only renders it. The answered
 * open question moves that boundary by exactly one step: attention floats a row to the top,
 * and everything below it is still recap's list in recap's order. Within the flagged rows,
 * asking comes before finished — the two are not equally urgent.
 */
function flagged(rows, attention) {
    if (attention === null || attention === undefined)
        return rows.map(row => ({ ...row, attention: null }));

    const marked = rows.map(row => ({ ...row, attention: attention.flagFor(row.key) }));
    const rank = row => {
        if (row.attention === null)
            return 2;
        return row.attention.kind === KIND.ASKING ? 0 : 1;
    };
    // A stable sort, which is what keeps recap's order intact underneath.
    return marked
        .map((row, index) => ({ row, index }))
        .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
        .map(entry => entry.row);
}

/**
 * An event that matched no project has nowhere to be a row, so it gets a line of its own
 * rather than being dropped or guessed onto somebody else's project.
 */
function withFleetNote(notes, attention) {
    const fleet = attention?.fleet ?? null;
    if (fleet === null)
        return notes;
    return [{
        kind: 'fleet-attention',
        title: fleet.kind === KIND.ASKING
            ? 'An agent asked for you, somewhere else'
            : 'An agent finished, somewhere else',
        detail: fleet.message !== ''
            ? fleet.message
            : 'It reported a directory that is not in this report.',
    }, ...notes];
}
