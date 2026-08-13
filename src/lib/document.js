// Turning what recap printed into a document, or into a reason why not.
//
// The strictness here is deliberately uneven. The *envelope* — a version we know, and the
// lists version 1 guarantees — is checked hard, because getting that wrong means rendering
// a document whose shape we are guessing at. What is inside a project entry is not checked
// at all: one nonsense row is not a reason to show the user nothing, so it travels on and
// the row model copes with it.

import { SUPPORTED_SCHEMA_VERSION } from './contract.js';
import { PROBLEM, failure } from './problem.js';

/**
 * Decode the stdout of `recap --json`.
 *
 * Returns `{ok: true, document}` or `{ok: false, problem}`. It never throws: it is called
 * on a timer, from the compositor, on whatever a command on someone's PATH happened to
 * print.
 */
export function decodeDocument(text) {
    if (typeof text !== 'string' || text.trim() === '') {
        return failure(PROBLEM.NO_OUTPUT,
            'recap returned nothing',
            'recap ran but printed no report. Try running it in a terminal to see why.');
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return failure(PROBLEM.UNREADABLE_OUTPUT,
            'recap printed something unreadable',
            `Expected JSON from “recap --json”: ${e.message}`);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !Number.isInteger(parsed.version)) {
        return failure(PROBLEM.NOT_A_DOCUMENT,
            'that was not a recap report',
            'The command printed JSON, but not a recap document. Check that the configured ' +
            'path really points at recap.');
    }

    if (parsed.version !== SUPPORTED_SCHEMA_VERSION) {
        return failure(PROBLEM.UNSUPPORTED_VERSION,
            'this extension is out of date',
            `recap speaks report version ${parsed.version}; this extension understands ` +
            `version ${SUPPORTED_SCHEMA_VERSION}. Update the extension.`);
    }

    if (!Array.isArray(parsed.projects)) {
        return failure(PROBLEM.NOT_A_DOCUMENT,
            'that was not a recap report',
            `A version ${SUPPORTED_SCHEMA_VERSION} report always has a list of projects, ` +
            'and this one does not.');
    }

    return { ok: true, document: parsed };
}
