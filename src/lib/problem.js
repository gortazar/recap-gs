// Everything that can go wrong between "time to refresh" and "here are your sessions",
// named.
//
// The point of naming them is the menu: "recap is not installed — install it and this
// panel starts working" and "recap printed something I cannot read" are different problems
// with different answers, and a panel that renders both as a blank list, or as a stack
// trace in the journal, is no use to anyone. Nothing in here throws, and nothing notifies:
// a failing refresh every 30 seconds must stay quiet.

export const PROBLEM = Object.freeze({
    /** recap is not installed, or not where we were told to look. */
    NOT_INSTALLED: 'not-installed',
    /** recap ran and exited non-zero. */
    FAILED: 'failed',
    /** recap did not finish inside its timeout and was cancelled. */
    TIMED_OUT: 'timed-out',
    /** recap could not be started at all — not a missing binary, something else. */
    NOT_RUN: 'not-run',
    /** recap exited successfully and printed nothing. */
    NO_OUTPUT: 'no-output',
    /** What recap printed is not JSON. */
    UNREADABLE_OUTPUT: 'unreadable-output',
    /** It is JSON, but not a recap document. */
    NOT_A_DOCUMENT: 'not-a-document',
    /** It is a recap document of a schema version this extension was not written against. */
    UNSUPPORTED_VERSION: 'unsupported-version',
});

/**
 * Build a problem. `title` is the line the menu shows; `detail` is the sentence under it,
 * which should say what to do about it wherever there is anything to do.
 */
export function problem(kind, title, detail) {
    return Object.freeze({ kind, title, detail });
}

/** A convenience for the common `{ok: false}` shape. */
export function failure(kind, title, detail) {
    return { ok: false, problem: problem(kind, title, detail) };
}
