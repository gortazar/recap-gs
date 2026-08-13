import { suite, test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { fixtureText } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { buildRows, ageLabel } from '../src/lib/rows.js';

function rowsOf(name, options = {}) {
    const result = decodeDocument(fixtureText(name));
    assert(result.ok, 'fixture did not decode');
    return buildRows(result.document, options);
}

function docOf(projects) {
    return { version: 1, liveness: 'process-table', projects };
}

suite('row model', () => {
    test('one row per project, in the order recap gave them', () => {
        const rows = rowsOf('every-status');
        assertDeepEqual(rows.map(r => r.name), [
            '-home-demo-projects-half-written-notes',
            'orchestrator', 'blog-pipeline', 'ansible-ascent', 'gnome-tasks', 'vacations',
        ]);
    });

    test('carries what a row shows: status, icon, agent and recap\'s own sentence', () => {
        const row = rowsOf('every-status').find(r => r.name === 'blog-pipeline');
        assertEqual(row.statusWord, 'waiting');
        assertEqual(row.iconName, 'recap-waiting-symbolic');
        assertEqual(row.agentLabel, 'Claude Code');
        assertEqual(row.recap,
            'Asked to "Work out why first-user source is coming back as direct" — answered, waiting for you.');
        assertEqual(row.dir, '/home/demo/projects/blog-pipeline');
    });

    test('names both agents when a project has been worked by both', () => {
        const rows = buildRows(docOf([
            { name: 'p', status: 'idle', agents: ['Claude Code', 'opencode'], sessions: [] },
        ]));
        assertEqual(rows[0].agentLabel, 'Claude Code + opencode');
    });

    test('a status word from a newer recap shows as unclear, not as a broken row', () => {
        const rows = buildRows(docOf([{ name: 'p', status: 'reticulating', sessions: [] }]));
        assertEqual(rows[0].statusWord, 'unclear');
        assertEqual(rows[0].iconName, 'recap-unclear-symbolic');
    });

    test('drops project entries that are not projects at all', () => {
        const rows = buildRows(docOf([null, 7, 'nope', { name: 'real', status: 'idle', sessions: [] }]));
        assertDeepEqual(rows.map(r => r.name), ['real']);
    });

    test('a project with no name still gets a row, because it still exists', () => {
        const rows = buildRows(docOf([{ status: 'running', sessions: [] }]));
        assertEqual(rows.length, 1);
        assert(rows[0].name.length > 0, 'a nameless project needs something to show');
    });

    test('a project whose sessions are missing is a row with nothing to resume', () => {
        const rows = buildRows(docOf([{ name: 'p', status: 'idle' }]));
        assertEqual(rows[0].sessionCount, 0);
        assertEqual(rows[0].resume, null);
    });

    test('hides finished projects when asked, and only then', () => {
        assertEqual(rowsOf('finished').some(r => r.statusWord === 'finished'), true);
        assertEqual(rowsOf('finished', { hideFinished: true }).some(r => r.statusWord === 'finished'), false);
    });

    test('hides idle projects when asked, and only then', () => {
        assertEqual(rowsOf('every-status').some(r => r.statusWord === 'idle'), true);
        assertEqual(rowsOf('every-status', { hideIdle: true }).some(r => r.statusWord === 'idle'), false);
    });

    test('never hides a project that wants you: waiting survives both filters', () => {
        const rows = rowsOf('every-status', { hideIdle: true, hideFinished: true });
        assert(rows.some(r => r.statusWord === 'waiting'), 'waiting was filtered out');
        assert(rows.some(r => r.statusWord === 'running'), 'running was filtered out');
    });
});

suite('row resume targets', () => {
    test('picks the session behind the project status, so the click resumes that one', () => {
        const rows = buildRows(docOf([{
            name: 'p',
            status: 'waiting',
            sessions: [
                { id: 'old', agent: 'Claude Code', status: 'idle', dir: '/w', last_activity: '2026-08-10T09:00:00Z' },
                { id: 'the-one', agent: 'Claude Code', status: 'waiting', dir: '/w', last_activity: '2026-08-10T10:00:00Z' },
            ],
        }]));
        assertEqual(rows[0].resume.id, 'the-one');
        assertEqual(rows[0].resume.dir, '/w');
        assertEqual(rows[0].resume.agent, 'Claude Code');
    });

    test('among sessions in that status, the most recent one wins', () => {
        const rows = buildRows(docOf([{
            name: 'p',
            status: 'waiting',
            sessions: [
                { id: 'older', agent: 'Claude Code', status: 'waiting', dir: '/w', last_activity: '2026-08-10T08:00:00Z' },
                { id: 'newer', agent: 'Claude Code', status: 'waiting', dir: '/w', last_activity: '2026-08-10T11:00:00Z' },
            ],
        }]));
        assertEqual(rows[0].resume.id, 'newer');
    });

    test('falls back to the most recent session when none matches the project status', () => {
        const rows = buildRows(docOf([{
            name: 'p',
            status: 'running',
            sessions: [
                { id: 'a', agent: 'opencode', status: 'idle', dir: '/w', last_activity: '2026-08-10T08:00:00Z' },
                { id: 'b', agent: 'opencode', status: 'idle', dir: '/w', last_activity: '2026-08-10T09:00:00Z' },
            ],
        }]));
        assertEqual(rows[0].resume.id, 'b');
    });

    test('will not offer to resume a session with no directory to resume it in', () => {
        // The idea text is explicit: it must be restored from the folder it was running in.
        // Without one there is nothing safe to do, so the row simply is not clickable.
        const rows = buildRows(docOf([{
            name: 'p', status: 'unclear',
            sessions: [{ id: 'a', agent: 'Claude Code', status: 'unclear' }],
        }]));
        assertEqual(rows[0].resume, null);
    });

    test('will not offer to resume a session with no id', () => {
        const rows = buildRows(docOf([{
            name: 'p', status: 'idle',
            sessions: [{ agent: 'Claude Code', status: 'idle', dir: '/w' }],
        }]));
        assertEqual(rows[0].resume, null);
    });

    test('falls back to the project directory when the session does not name one', () => {
        const rows = buildRows(docOf([{
            name: 'p', status: 'idle', dir: '/project',
            sessions: [{ id: 'a', agent: 'Claude Code', status: 'idle' }],
        }]));
        assertEqual(rows[0].resume.dir, '/project');
    });
});

suite('ages', () => {
    const now = Date.parse('2026-08-10T12:00:00Z');

    test('reads recap\'s timestamps and says how long ago in words', () => {
        assertEqual(ageLabel('2026-08-10T11:59:30Z', now), 'just now');
        assertEqual(ageLabel('2026-08-10T11:55:00Z', now), '5 minutes ago');
        assertEqual(ageLabel('2026-08-10T11:59:00Z', now), '1 minute ago');
        assertEqual(ageLabel('2026-08-10T09:00:00Z', now), '3 hours ago');
        assertEqual(ageLabel('2026-08-08T12:00:00Z', now), '2 days ago');
    });

    test('says nothing rather than something wrong when there is no timestamp', () => {
        assertEqual(ageLabel(undefined, now), '');
        assertEqual(ageLabel('not a date', now), '');
        assertEqual(ageLabel('', now), '');
    });

    test('does not claim the future when clocks disagree', () => {
        assertEqual(ageLabel('2026-08-10T12:05:00Z', now), 'just now');
    });

    test('a row carries the age of its last activity', () => {
        const rows = buildRows(docOf([
            { name: 'p', status: 'idle', last_activity: '2026-08-10T11:00:00Z', sessions: [] },
        ]), { now });
        assertEqual(rows[0].ageLabel, '1 hour ago');
    });
});
