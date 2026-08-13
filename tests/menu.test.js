import { suite, test, assert, assertEqual } from './harness.js';
import { fixtureText } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { buildMenu } from '../src/lib/menu.js';
import { PROBLEM, problem } from '../src/lib/problem.js';

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
