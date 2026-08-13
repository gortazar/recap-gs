import { suite, test, assert, assertEqual } from './harness.js';
import { readFile } from './util.js';
import { decodeEvent, IGNORED, MAX_PAYLOAD_BYTES } from '../src/lib/events.js';
import { KIND } from '../src/lib/attention.js';

function hook(name) {
    return readFile('tests', 'fixtures', 'hooks', `${name}.json`);
}

function ignoredReason(kind, payload) {
    const result = decodeEvent(kind, payload);
    assert(!result.ok, `expected it to be ignored, got ${JSON.stringify(result)}`);
    return result.reason;
}

suite('decoding an agent event', () => {
    test('a Claude Code Notification becomes an asking event', () => {
        const result = decodeEvent('asking', hook('claude-notification'));
        assert(result.ok, JSON.stringify(result));
        assertEqual(result.event.kind, KIND.ASKING);
        assertEqual(result.event.cwd, '/home/demo/projects/blog-pipeline');
        assertEqual(result.event.message, 'Claude needs your permission to use Bash');
        assertEqual(result.event.sessionId, 'bbbb2222');
        assertEqual(result.event.agent, 'Claude Code');
    });

    test('a Claude Code Stop becomes a finished event', () => {
        const result = decodeEvent('finished', hook('claude-stop'));
        assert(result.ok, JSON.stringify(result));
        assertEqual(result.event.kind, KIND.FINISHED);
        assertEqual(result.event.cwd, '/home/demo/projects/orchestrator');
        // Stop carries no message, and inventing one would put words in the agent's mouth.
        assertEqual(result.event.message, '');
    });

    test('an opencode session.idle becomes a finished event', () => {
        const result = decodeEvent('finished', hook('opencode-session-idle'));
        assert(result.ok, JSON.stringify(result));
        assertEqual(result.event.kind, KIND.FINISHED);
        assertEqual(result.event.cwd, '/home/demo/projects/vacations');
        assertEqual(result.event.agent, 'opencode');
        assertEqual(result.event.sessionId, 'ses_5vY3');
    });

    test('the working directory is the one field it cannot do without', () => {
        // Without a cwd there is no row to flag; fleet attention would be a guess dressed
        // up as a fact.
        assertEqual(ignoredReason('asking', '{"session_id": "x"}'), IGNORED.NO_CWD);
        assertEqual(ignoredReason('asking', '{"cwd": ""}'), IGNORED.NO_CWD);
        assertEqual(ignoredReason('asking', '{"cwd": 7}'), IGNORED.NO_CWD);
        assertEqual(ignoredReason('asking', '{"cwd": "relative/path"}'), IGNORED.NO_CWD);
    });

    test('a kind it does not know is ignored, not an error', () => {
        // A newer shim talking to an older extension must be harmless.
        assertEqual(ignoredReason('exploded', hook('claude-stop')), IGNORED.UNKNOWN_KIND);
        assertEqual(ignoredReason('', hook('claude-stop')), IGNORED.UNKNOWN_KIND);
        assertEqual(ignoredReason(null, hook('claude-stop')), IGNORED.UNKNOWN_KIND);
        assertEqual(ignoredReason(42, hook('claude-stop')), IGNORED.UNKNOWN_KIND);
    });

    test('a payload that is not JSON is ignored', () => {
        assertEqual(ignoredReason('asking', 'not json at all'), IGNORED.NOT_JSON);
        assertEqual(ignoredReason('asking', '{"cwd": "/w"'), IGNORED.NOT_JSON);
        assertEqual(ignoredReason('asking', ''), IGNORED.NOT_JSON);
    });

    test('a payload that is JSON but not an object is ignored', () => {
        assertEqual(ignoredReason('asking', '[1,2,3]'), IGNORED.NOT_AN_OBJECT);
        assertEqual(ignoredReason('asking', '"a string"'), IGNORED.NOT_AN_OBJECT);
        assertEqual(ignoredReason('asking', 'null'), IGNORED.NOT_AN_OBJECT);
        assertEqual(ignoredReason('asking', '42'), IGNORED.NOT_AN_OBJECT);
    });

    test('an enormous payload is refused before it is parsed', () => {
        // This arrives over D-Bus from a process we do not control. Parsing a megabyte of
        // JSON on the compositor's main loop is the denial of service, not the fix for it.
        const huge = `{"cwd": "/w", "message": "${'x'.repeat(1024 * 1024)}"}`;
        assertEqual(ignoredReason('asking', huge), IGNORED.TOO_LARGE);
        assert(MAX_PAYLOAD_BYTES < 1024 * 1024, 'the cap should be well under a megabyte');
    });

    test('a truncated payload is ignored rather than half-read', () => {
        const whole = hook('claude-notification');
        assertEqual(ignoredReason('asking', whole.slice(0, whole.length / 2)), IGNORED.NOT_JSON);
    });

    test('a long message is kept but clipped, so one row cannot fill the menu', () => {
        const message = 'y'.repeat(1000);
        const result = decodeEvent('asking', JSON.stringify({ cwd: '/w', message }));
        assert(result.ok);
        assert(result.event.message.length < 300,
            `message is ${result.event.message.length} characters long`);
        assert(result.event.message.startsWith('yyy'));
    });

    test('control characters and markup in a message are text, not instructions', () => {
        // It ends up in a label, and it came from outside. Newlines and tabs would break the
        // row's layout; nothing here is ever interpreted.
        const result = decodeEvent('asking', JSON.stringify({
            cwd: '/w',
            message: 'line one\nline two\ttabbed\u0000<b>bold</b>',
        }));
        assert(result.ok);
        assertEqual(result.event.message, 'line one line two tabbed <b>bold</b>');
    });

    test('fields it has never heard of are ignored, not a reason to refuse', () => {
        const result = decodeEvent('asking', JSON.stringify({
            cwd: '/w', message: 'hi', hook_event_name: 'Notification', future_field: {},
        }));
        assert(result.ok);
        assertEqual(result.event.cwd, '/w');
    });

    test('the agent is named by what sent it, and guessed at only as a fallback', () => {
        const claude = decodeEvent('asking', JSON.stringify({ cwd: '/w', transcript_path: '/x.jsonl' }));
        assertEqual(claude.event.agent, 'Claude Code');
        const named = decodeEvent('finished', JSON.stringify({ cwd: '/w', agent: 'opencode' }));
        assertEqual(named.event.agent, 'opencode');
        const anonymous = decodeEvent('finished', JSON.stringify({ cwd: '/w' }));
        assertEqual(anonymous.event.agent, '');
    });

    test('never throws, whatever comes over the bus', () => {
        const inputs = [null, undefined, 42, {}, '', '{', '\u0000', 'null', '[]'];
        for (const kind of ['asking', 'finished', null, 7]) {
            for (const payload of inputs)
                decodeEvent(kind, payload);
        }
    });
});
