// What an agent said, turned into an event — or into a named reason for ignoring it.
//
// Everything here runs on the compositor's main loop, on a string that arrived over D-Bus
// from a process this extension does not control and cannot vouch for. So:
//
//   - it never throws: an ignored event is a return value, not an exception in a bus
//     handler, where it would take a piece of the desktop with it;
//   - it is capped before it is parsed, because parsing a megabyte of JSON on the main loop
//     is the denial of service, not a defence against one;
//   - nothing it extracts is ever executed, spawned, or interpolated into a command. The
//     message becomes the text of a label and nothing else.
//
// The payload is the agent's own hook JSON, passed through by the shim untouched. That is
// deliberate: the shim needs no jq, no parsing and no knowledge of any agent's schema, so
// the one place that has to understand these formats is this file, where it is tested.

import { KIND } from './attention.js';

/** Why an event was ignored. Each one is a case with a test. */
export const IGNORED = Object.freeze({
    UNKNOWN_KIND: 'unknown-kind',
    TOO_LARGE: 'too-large',
    NOT_JSON: 'not-json',
    NOT_AN_OBJECT: 'not-an-object',
    NO_CWD: 'no-cwd',
});

/**
 * The most payload that will be looked at. Comfortably more than any hook sends — Claude
 * Code's is a few hundred bytes — and small enough that parsing it is free.
 */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** A message longer than this is clipped: one row must not be able to fill the menu. */
const MAX_MESSAGE = 200;

/**
 * Decode one event.
 *
 * Returns `{ok: true, event}` or `{ok: false, reason}`, where `event` is
 * `{kind, cwd, message, sessionId, agent}` — the fields the attention model uses and nothing
 * else.
 */
export function decodeEvent(kind, payload) {
    if (kind !== KIND.ASKING && kind !== KIND.FINISHED)
        return ignored(IGNORED.UNKNOWN_KIND);

    if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_BYTES)
        return ignored(typeof payload === 'string' ? IGNORED.TOO_LARGE : IGNORED.NOT_JSON);

    let parsed;
    try {
        parsed = JSON.parse(payload);
    } catch (e) {
        void e;
        return ignored(IGNORED.NOT_JSON);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return ignored(IGNORED.NOT_AN_OBJECT);

    // An absolute path or nothing. A relative one cannot be matched against anything recap
    // reported, and resolving it against some current directory would be inventing a fact.
    const cwd = typeof parsed.cwd === 'string' ? parsed.cwd.trim() : '';
    if (cwd === '' || !cwd.startsWith('/'))
        return ignored(IGNORED.NO_CWD);

    return {
        ok: true,
        event: {
            kind,
            cwd,
            message: cleanMessage(parsed.message),
            sessionId: text(parsed.session_id),
            agent: agentOf(parsed),
        },
    };
}

function ignored(reason) {
    return { ok: false, reason };
}

/**
 * Who sent it. Named if the payload says so — our opencode plugin does — and otherwise
 * inferred only from something specific: a `transcript_path` is Claude Code's, and no other
 * hook we know sends one. Anything else stays unnamed rather than guessed.
 */
function agentOf(parsed) {
    const named = text(parsed.agent);
    if (named !== '')
        return named;
    if (text(parsed.transcript_path) !== '')
        return 'Claude Code';
    return '';
}

/**
 * A message from outside, on its way to a label. Newlines and tabs would break the row's
 * layout, and everything else is left exactly as the agent wrote it — including anything
 * that looks like markup, because a label shows text and interprets nothing.
 */
function cleanMessage(value) {
    const message = text(value)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
