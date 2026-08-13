// The row model: a recap document turned into the list the menu draws.
//
// Everything here is derived from what recap said. Nothing is judged: the status on a row is
// the status recap reported, the sentence is the sentence recap wrote. What this module does
// decide is presentation — which session a click would resume, how an age reads, and which
// rows the user asked not to see.

import { statusInfo } from './contract.js';

/**
 * Build the menu's rows from a decoded document.
 *
 * Options:
 *   hideFinished, hideIdle — the two preferences for a quieter menu.
 *   now — milliseconds since the epoch, for the ages. Injectable so the tests are not
 *         about the clock.
 *
 * Order is recap's order, which is by recency: the panel and the terminal should list the
 * same projects the same way round.
 */
export function buildRows(document, options = {}) {
    const { hideFinished = false, hideIdle = false, now = Date.now() } = options;
    const projects = Array.isArray(document?.projects) ? document.projects : [];

    const rows = [];
    for (const project of projects) {
        // A project entry that is not an object cannot be drawn at all — there is no name to
        // show and nothing to click. Dropping it keeps the rest of the list intact.
        if (project === null || typeof project !== 'object' || Array.isArray(project))
            continue;

        const info = statusInfo(project.status);
        if (hideFinished && info.word === 'finished')
            continue;
        if (hideIdle && info.word === 'idle')
            continue;

        const sessions = Array.isArray(project.sessions) ? project.sessions : [];
        const dir = stringOr(project.dir, '');
        const name = stringOr(project.name, '') || dir || '(unnamed project)';

        rows.push({
            // Stable enough to match a row across refreshes: the directory if there is one,
            // the name otherwise.
            key: dir || name,
            name,
            dir,
            statusWord: info.word,
            statusLabel: info.label,
            iconName: info.iconName,
            emoji: info.emoji,
            recap: stringOr(project.recap, ''),
            agentLabel: agentLabel(project.agents),
            sessionCount: sessions.length,
            ageLabel: ageLabel(project.last_activity, now),
            resume: resumeTarget(project, sessions),
        });
    }
    return rows;
}

/**
 * Which session a click on this row resumes.
 *
 * The one that is in the state the project is in, because that is the session the row is
 * telling you about — the waiting one, when the row says waiting. Ties go to the most
 * recently active. Returns null when there is nothing that could be resumed safely.
 */
function resumeTarget(project, sessions) {
    const candidates = sessions.filter(s =>
        s !== null && typeof s === 'object' && stringOr(s.id, '') !== '');
    if (candidates.length === 0)
        return null;

    const word = statusInfo(project.status).word;
    const matching = candidates.filter(s => statusInfo(s.status).word === word);
    const pool = matching.length > 0 ? matching : candidates;

    let best = pool[0];
    for (const s of pool) {
        if (timestamp(s.last_activity) > timestamp(best.last_activity))
            best = s;
    }

    // The idea is explicit that a session must be resumed from the directory it was running
    // in. Without one there is nothing safe to do, so the row is simply not clickable.
    const dir = stringOr(best.dir, '') || stringOr(project.dir, '');
    if (dir === '')
        return null;

    return {
        id: best.id,
        agent: stringOr(best.agent, ''),
        dir,
        status: statusInfo(best.status).word,
    };
}

function agentLabel(agents) {
    if (!Array.isArray(agents))
        return '';
    return agents.filter(a => typeof a === 'string' && a !== '').join(' + ');
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in words. An unparseable or missing timestamp says nothing at all: a wrong
 * age is worse than no age, and recap marks these fields optional.
 */
export function ageLabel(iso, now = Date.now()) {
    const then = timestamp(iso);
    if (then === 0)
        return '';

    // Clocks disagree, and a panel claiming a session will be active in four minutes is
    // just a bug on show.
    const ago = Math.max(0, now - then);
    if (ago < MINUTE)
        return 'just now';
    if (ago < HOUR)
        return plural(Math.floor(ago / MINUTE), 'minute');
    if (ago < DAY)
        return plural(Math.floor(ago / HOUR), 'hour');
    return plural(Math.floor(ago / DAY), 'day');
}

function plural(n, unit) {
    return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

function timestamp(iso) {
    if (typeof iso !== 'string' || iso === '')
        return 0;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
}

function stringOr(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
