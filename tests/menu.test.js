import { suite, test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { fixtureText } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { buildMenu } from '../src/lib/menu.js';
import { PROBLEM, problem } from '../src/lib/problem.js';
import { Attention, KIND } from '../src/lib/attention.js';

const NOW = Date.parse('2026-08-10T12:00:00Z');

function stateOf(fixtureName, extra = {}) {
    const result = decodeDocument(fixtureText(fixtureName));
    assert(result.ok, 'fixture did not decode');
    return { document: result.document, problem: null, stale: false, updatedAt: NOW, ...extra };
}

const EMPTY_STATE = { document: null, problem: null, stale: false, updatedAt: 0 };

suite('menu model', () => {
    test('before the first refresh, the menu says it is looking', () => {
        const menu = buildMenu(EMPTY_STATE, {}, NOW);
        assertEqual(menu.rows.length, 0);
        assertEqual(menu.notes.length, 1);
        assertEqual(menu.notes[0].kind, 'loading');
        assertEqual(menu.summary.iconName, 'recap-symbolic');
    });

    test('a report becomes rows, and no notes', () => {
        const menu = buildMenu(stateOf('every-status'), {}, NOW);
        assertEqual(menu.rows.length, 6);
        assertEqual(menu.notes.length, 0);
        assertEqual(menu.summary.iconName, 'recap-waiting-symbolic');
    });

    test('an empty report says so in the menu, not with a blank menu', () => {
        const menu = buildMenu(stateOf('empty'), {}, NOW);
        assertEqual(menu.rows.length, 0);
        assertEqual(menu.notes.length, 1);
        assertEqual(menu.notes[0].kind, 'empty');
        assert(menu.notes[0].title.length > 0);
    });

    test('an empty report mentions the window it was asked about', () => {
        const withSince = buildMenu(stateOf('empty'), { since: '2d' }, NOW);
        assert(withSince.notes[0].title.includes('2d'),
            `expected the window in "${withSince.notes[0].title}"`);
        // Without one, recap's own default applies and we do not guess what it is.
        const without = buildMenu(stateOf('empty'), {}, NOW);
        assert(!without.notes[0].title.includes('undefined'), without.notes[0].title);
    });

    test('a problem with nothing to fall back on is the whole menu', () => {
        const state = {
            ...EMPTY_STATE,
            problem: problem(PROBLEM.NOT_INSTALLED, 'recap is not installed', 'Install it.'),
        };
        const menu = buildMenu(state, {}, NOW);
        assertEqual(menu.rows.length, 0);
        assertEqual(menu.notes.length, 1);
        assertEqual(menu.notes[0].kind, 'problem');
        assertEqual(menu.notes[0].title, 'recap is not installed');
        assertEqual(menu.notes[0].detail, 'Install it.');
        assertEqual(menu.summary.iconName, 'recap-symbolic');
    });

    test('a problem on top of an old report keeps the rows and dates them', () => {
        const state = stateOf('every-status', {
            problem: problem(PROBLEM.TIMED_OUT, 'recap took too long', 'It was stopped.'),
            stale: true,
            updatedAt: NOW - 5 * 60 * 1000,
        });
        const menu = buildMenu(state, {}, NOW);
        assertEqual(menu.rows.length, 6, 'a stale report is better than an empty menu');
        assertEqual(menu.notes.length, 1);
        assertEqual(menu.notes[0].kind, 'stale');
        assert(menu.notes[0].title.includes('5 minutes ago'),
            `expected the age of the report in "${menu.notes[0].title}"`);
        assertEqual(menu.notes[0].detail, 'recap took too long');
    });

    test('stale rows do not drive the panel, so a hang cannot raise a false alarm', () => {
        // The icon says "as far as I know", and what it knows is out of date.
        const state = stateOf('every-status', {
            problem: problem(PROBLEM.TIMED_OUT, 'recap took too long', 'It was stopped.'),
            stale: true,
            updatedAt: NOW - 5 * 60 * 1000,
        });
        assertEqual(buildMenu(state, {}, NOW).summary.iconName, 'recap-symbolic');
    });

    test('the hide preferences reach the rows', () => {
        const state = stateOf('every-status');
        assertEqual(buildMenu(state, { hideIdle: true }, NOW).rows.some(r => r.statusWord === 'idle'), false);
        assertEqual(buildMenu(state, {}, NOW).rows.some(r => r.statusWord === 'idle'), true);
    });

    test('a report whose rows are all hidden blames the filters, not recap', () => {
        const state = {
            document: {
                version: 1,
                liveness: 'process-table',
                projects: [{ name: 'p', status: 'idle', sessions: [] }],
            },
            problem: null, stale: false, updatedAt: NOW,
        };
        const menu = buildMenu(state, { hideIdle: true }, NOW);
        assertEqual(menu.rows.length, 0);
        assertEqual(menu.notes.length, 1);
        assertEqual(menu.notes[0].kind, 'hidden');
        assert(menu.notes[0].title.includes('1'), menu.notes[0].title);
    });

    test('the count in the panel follows the show-count preference', () => {
        assertEqual(buildMenu(stateOf('every-status'), { showCount: false }, NOW).summary.label, '');
        assertEqual(buildMenu(stateOf('every-status'), {}, NOW).summary.label, '1');
    });

    test('when recap could not check what is running, the menu says which unclear it means', () => {
        const menu = buildMenu(stateOf('no-liveness'), {}, NOW);
        assertEqual(menu.notes.length, 1);
        assertEqual(menu.notes[0].kind, 'liveness');
        assert(menu.notes[0].detail.toLowerCase().includes('running'),
            `expected an explanation, got "${menu.notes[0].detail}"`);
        assertEqual(menu.rows.length, 6, 'the rows are still worth showing');
    });
});

// ---------------------------------------------------------------------------------------
// 0.2: what an event does to the menu once it has been recorded.

function attentionWith(events, rows, at = NOW) {
    const attention = new Attention({ now: () => at });
    for (const event of events)
        attention.record(event, rows);
    return attention;
}

suite('menu with attention', () => {
    const state = () => stateOf('every-status');
    const rowsOf = () => buildMenu(state(), {}, NOW).rows;

    test('a flagged project is marked, and says what the agent said', () => {
        const rows = rowsOf();
        const attention = attentionWith([{
            kind: KIND.ASKING,
            cwd: '/home/demo/projects/blog-pipeline',
            message: 'Claude needs your permission to run git push',
        }], rows);

        const menu = buildMenu(state(), {}, NOW, attention);
        const flagged = menu.rows.find(row => row.name === 'blog-pipeline');
        assertEqual(flagged.attention.kind, KIND.ASKING);
        assertEqual(flagged.attention.message, 'Claude needs your permission to run git push');
        // Everything else is untouched.
        assertEqual(menu.rows.find(row => row.name === 'orchestrator').attention, null);
    });

    test('flagged projects come first, most urgent first, and the rest keep recap\'s order', () => {
        // The fourth open question was answered "yes, put flagged projects at the top".
        const rows = rowsOf();
        const attention = attentionWith([
            { kind: KIND.FINISHED, cwd: '/home/demo/projects/vacations' },
            { kind: KIND.ASKING, cwd: '/home/demo/projects/gnome-tasks' },
        ], rows);

        const menu = buildMenu(state(), {}, NOW, attention);
        assertEqual(menu.rows[0].name, 'gnome-tasks', 'the asking one should lead');
        assertEqual(menu.rows[1].name, 'vacations');
        // recap's own order, minus the two that were lifted out of it.
        assertDeepEqual(menu.rows.slice(2).map(row => row.name), [
            '-home-demo-projects-half-written-notes',
            'orchestrator', 'blog-pipeline', 'ansible-ascent',
        ]);
    });

    test('recap still owns what the row says', () => {
        // An event changes the emphasis, never the words: the status and the sentence are
        // recap's, whatever an agent shouted a moment ago.
        const rows = rowsOf();
        const attention = attentionWith([{
            kind: KIND.ASKING, cwd: '/home/demo/projects/vacations',
        }], rows);

        const flagged = buildMenu(state(), {}, NOW, attention).rows
            .find(row => row.name === 'vacations');
        assertEqual(flagged.statusWord, 'idle');
        assert(flagged.recap.startsWith('Asked to "Write the accrual rules'), flagged.recap);
    });

    test('attention outranks the polled summary while it is pending', () => {
        // The whole point: an event that lands 28 seconds before the next refresh shows now.
        const rows = rowsOf();
        const plain = buildMenu(state(), {}, NOW);
        assertEqual(plain.summary.iconName, 'recap-waiting-symbolic');
        assertEqual(plain.summary.label, '1');

        const attention = attentionWith([
            { kind: KIND.FINISHED, cwd: '/home/demo/projects/vacations' },
            { kind: KIND.FINISHED, cwd: '/home/demo/projects/orchestrator' },
        ], rows);
        const menu = buildMenu(state(), {}, NOW, attention);
        assertEqual(menu.summary.iconName, 'recap-finished-symbolic');
        assertEqual(menu.summary.label, '2', 'the count is how many projects are flagged');
        assertEqual(menu.summary.styleClass, 'recap-finished');
        assert(menu.summary.tooltip.toLowerCase().includes('finished'), menu.summary.tooltip);
    });

    test('an asking flag makes the panel urgent whatever else is going on', () => {
        const rows = rowsOf();
        const attention = attentionWith([
            { kind: KIND.FINISHED, cwd: '/home/demo/projects/vacations' },
            { kind: KIND.ASKING, cwd: '/home/demo/projects/orchestrator' },
        ], rows);
        const menu = buildMenu(state(), {}, NOW, attention);
        assertEqual(menu.summary.styleClass, 'recap-asking');
        assertEqual(menu.summary.label, '2');
    });

    test('a stale report does not suppress attention', () => {
        // Events do not come from recap, so recap being unwell says nothing about them.
        const rows = rowsOf();
        const attention = attentionWith([{ kind: KIND.ASKING, cwd: '/home/demo/projects/vacations' }], rows);
        const stale = stateOf('every-status', {
            problem: problem(PROBLEM.TIMED_OUT, 'recap took too long', 'It was stopped.'),
            stale: true,
            updatedAt: NOW - 5 * 60 * 1000,
        });
        const menu = buildMenu(stale, {}, NOW, attention);
        assertEqual(menu.summary.styleClass, 'recap-asking');
        assertEqual(menu.rows[0].name, 'vacations');
    });

    test('no attention leaves the panel exactly as 0.1 drew it', () => {
        const menu = buildMenu(state(), {}, NOW, new Attention({}));
        assertEqual(menu.summary.iconName, 'recap-waiting-symbolic');
        assertEqual(menu.summary.styleClass, '');
        assertEqual(menu.rows[0].name, '-home-demo-projects-half-written-notes');
    });

    test('an event nobody can place says so in a note of its own', () => {
        const rows = rowsOf();
        const attention = attentionWith([{ kind: KIND.ASKING, cwd: '/somewhere/else' }], rows);
        const menu = buildMenu(state(), {}, NOW, attention);
        const note = menu.notes.find(entry => entry.kind === 'fleet-attention');
        assert(note !== undefined, `expected a fleet note in ${JSON.stringify(menu.notes)}`);
        assertEqual(menu.summary.styleClass, 'recap-asking');
    });

    test('a flagged project hidden by a filter is not silently lost', () => {
        // Hiding idle projects must not hide the one that just asked you something.
        const rows = rowsOf();
        const attention = attentionWith([{ kind: KIND.ASKING, cwd: '/home/demo/projects/vacations' }], rows);
        const menu = buildMenu(state(), { hideIdle: true }, NOW, attention);
        assertEqual(menu.rows[0].name, 'vacations');
        assertEqual(menu.rows[0].attention.kind, KIND.ASKING);
    });
});
