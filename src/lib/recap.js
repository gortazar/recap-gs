// How recap is asked, and what to make of how it answered.
//
// Both halves are pure: the argv is a value, and an outcome is a plain object the
// subprocess seam fills in. That is what lets the missing-binary, garbage-output, non-zero
// exit and timeout paths be tested without ever starting a process — and those are exactly
// the paths that never get exercised by hand, because on the machine you are developing on,
// recap is installed and works.

import { decodeDocument } from './document.js';
import { PROBLEM, failure } from './problem.js';

/**
 * The command line for one refresh.
 *
 * Filters are recap's own flags, passed straight through: this extension does no filtering
 * of its own, so there is only one place where "since 2 days" can mean something.
 */
export function buildArgv(settings = {}) {
    const path = trimmed(settings.path) || 'recap';
    // Never --smart: that is a paid API call, and a panel refreshing every 30 seconds is
    // the last place it belongs.
    const argv = [path, '--json'];

    const since = trimmed(settings.since);
    if (since !== '')
        argv.push('--since', since);

    const agent = trimmed(settings.agent);
    // "all agents" is the absence of the flag, not a value recap knows.
    if (agent !== '' && agent !== 'all')
        argv.push('--agent', agent);

    for (const root of Array.isArray(settings.roots) ? settings.roots : []) {
        const dir = trimmed(root);
        if (dir !== '')
            argv.push('--root', dir);
    }

    return argv;
}

/**
 * Turn one run of recap into a document or a problem.
 *
 * The outcome comes from the seam in source.js and is deliberately dumb:
 *   failedToStart, notFound, message — the process never ran
 *   cancelled, timedOut, timeoutSeconds — we gave up on it
 *   exitStatus, stdout, stderr — it ran
 *
 * A cancellation that is not a timeout returns `{ok: false, problem: null}`: the extension
 * was disabled, or this refresh was superseded by a newer one, and there is nobody to tell.
 */
export function classifyOutcome(outcome) {
    const o = outcome ?? {};

    if (o.cancelled) {
        if (!o.timedOut)
            return { ok: false, problem: null };
        return failure(PROBLEM.TIMED_OUT,
            'recap took too long',
            `recap did not answer within ${o.timeoutSeconds ?? 'the'} seconds and was ` +
            'stopped. The panel is showing the last report it managed.');
    }

    if (o.failedToStart) {
        if (o.notFound) {
            return failure(PROBLEM.NOT_INSTALLED,
                'recap is not installed',
                'This panel shows what recap reports. Install recap, or set the path to it ' +
                'in this extension\'s preferences.');
        }
        return failure(PROBLEM.NOT_RUN,
            'recap could not be started',
            String(o.message ?? 'The reason was not reported.'));
    }

    if (o.exitStatus !== 0) {
        const said = firstLine(o.stderr);
        return failure(PROBLEM.FAILED,
            'recap reported an error',
            said !== '' ? said : `recap exited with status ${o.exitStatus}.`);
    }

    return decodeDocument(typeof o.stdout === 'string' ? o.stdout : '');
}

/**
 * One line, because this ends up in a menu. recap's own errors put the useful sentence
 * first and the usage banner after it.
 */
function firstLine(text) {
    if (typeof text !== 'string')
        return '';
    for (const line of text.split('\n')) {
        if (line.trim() !== '')
            return line.trim();
    }
    return '';
}

function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
