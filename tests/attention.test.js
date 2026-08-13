import { suite, test, assert, assertEqual } from './harness.js';
import { fixtureText } from './util.js';
import { decodeDocument } from '../src/lib/document.js';
import { buildRows } from '../src/lib/rows.js';
import { Attention, KIND, matchProject } from '../src/lib/attention.js';

const T0 = Date.parse('2026-08-14T12:00:00Z');

// A clock the test moves by hand: everything here is about *when* things arrived.
function clock(start = T0) {
    let now = start;
    return {
        now: () => now,
        advance(ms) {
            now += ms;
            return now;
        },
    };
}

function rowsOf(...dirs) {
    return dirs.map(dir => ({
        key: dir,
        name: dir.split('/').pop(),
        dir,
        dirs: [dir],
        statusWord: 'idle',
    }));
}

function asking(cwd, extra = {}) {
    return { kind: KIND.ASKING, cwd, message: '', ...extra };
}

function finished(cwd, extra = {}) {
    return { kind: KIND.FINISHED, cwd, message: '', ...extra };
}

suite('matching an event to a project', () => {
    const rows = rowsOf('/home/p/git/aideas', '/home/p/git/aideas-old', '/home/p/work');

    test('an event from a project directory matches that project', () => {
        assertEqual(matchProject('/home/p/git/aideas', rows)?.key, '/home/p/git/aideas');
    });

    test('an event from a subdirectory matches the project above it', () => {
        // An agent started in a subdirectory reports the subdirectory.
        assertEqual(matchProject('/home/p/git/aideas/ideas/recap-gs', rows)?.key, '/home/p/git/aideas');
    });

    test('a longer prefix wins, so a nested project takes its own events', () => {
        const nested = rowsOf('/home/p/git/aideas', '/home/p/git/aideas/ideas/recap-gs');
        assertEqual(matchProject('/home/p/git/aideas/ideas/recap-gs/src', nested)?.key,
            '/home/p/git/aideas/ideas/recap-gs');
    });

    test('a name that merely starts the same is not a match', () => {
        // The trap: /home/p/git/aideas-old must not match /home/p/git/aideas.
        assertEqual(matchProject('/home/p/git/aideas-old', rows)?.key, '/home/p/git/aideas-old');
        assertEqual(matchProject('/home/p/git/aideas-old/deep', rows)?.key, '/home/p/git/aideas-old');
    });

    test('matches a session directory that is not the project root', () => {
        // A worktree reports the worktree, and recap reports it as one of the project's
        // session directories.
        const rows2 = [{
            key: '/home/p/git/aideas',
            dir: '/home/p/git/aideas',
            dirs: ['/home/p/git/aideas', '/tmp/worktrees/recap-gs'],
            statusWord: 'running',
        }];
        assertEqual(matchProject('/tmp/worktrees/recap-gs/ideas', rows2)?.key, '/home/p/git/aideas');
    });

    test('a trailing slash is not a different directory', () => {
        assertEqual(matchProject('/home/p/work/', rows)?.key, '/home/p/work');
    });

    test('nothing sensible to match is no match, not a guess', () => {
        assertEqual(matchProject('/somewhere/else', rows), null);
        assertEqual(matchProject('', rows), null);
        assertEqual(matchProject(undefined, rows), null);
        assertEqual(matchProject('/home/p/work', []), null);
    });
});

suite('attention: raising it', () => {
    test('an event flags the project it came from', () => {
        const c = clock();
        const attention = new Attention({ now: c.now });
        const rows = rowsOf('/w/one', '/w/two');

        const result = attention.record(asking('/w/one/src'), rows);
        assertEqual(result.accepted, true);
        assertEqual(result.key, '/w/one');
        assertEqual(attention.count, 1);
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING);
        assertEqual(attention.flagFor('/w/one').at, T0);
        assertEqual(attention.flagFor('/w/two'), null);
    });

    test('it keeps the message the agent sent, so the row can say why', () => {
        const attention = new Attention({ now: clock().now });
        attention.record(asking('/w/one', { message: 'Claude needs your permission to run git push' }),
            rowsOf('/w/one'));
        assertEqual(attention.flagFor('/w/one').message,
            'Claude needs your permission to run git push');
    });

    test('an event matching no project raises attention for the fleet instead', () => {
        // Dropping it would lose a real event; guessing a row would put it on the wrong
        // project. Neither is acceptable, so it is attention without a row.
        const attention = new Attention({ now: clock().now });
        const result = attention.record(asking('/elsewhere'), rowsOf('/w/one'));
        assertEqual(result.accepted, true);
        assertEqual(result.key, null);
        assertEqual(attention.fleet.kind, KIND.ASKING);
        assertEqual(attention.count, 1);
    });

    test('asking beats finished, whichever order they arrive in', () => {
        const c = clock();
        const attention = new Attention({ now: c.now });
        const rows = rowsOf('/w/one');

        attention.record(finished('/w/one'), rows);
        c.advance(10_000);
        attention.record(asking('/w/one'), rows);
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING);

        c.advance(10_000);
        attention.record(finished('/w/one'), rows);
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING,
            'a finish must not downgrade a question you have not answered');
    });

    test('the summary is the most urgent flag, and how many there are', () => {
        const attention = new Attention({ now: clock().now });
        const rows = rowsOf('/w/one', '/w/two', '/w/three');
        attention.record(finished('/w/one'), rows);
        attention.record(finished('/w/two'), rows);
        assertEqual(attention.summary().kind, KIND.FINISHED);
        assertEqual(attention.summary().count, 2);

        attention.record(asking('/w/three'), rows);
        assertEqual(attention.summary().kind, KIND.ASKING);
        assertEqual(attention.summary().count, 3);
    });

    test('no attention is no summary at all', () => {
        assertEqual(new Attention({}).summary(), null);
    });
});

suite('attention: coalescing and the ceiling', () => {
    test('a repeat within a few seconds updates the flag without a second pulse', () => {
        const c = clock();
        const attention = new Attention({ now: c.now, coalesceMs: 4000 });
        const rows = rowsOf('/w/one');

        assertEqual(attention.record(asking('/w/one', { message: 'first' }), rows).accepted, true);
        c.advance(1000);
        const second = attention.record(asking('/w/one', { message: 'second' }), rows);

        assertEqual(second.accepted, false);
        assertEqual(second.reason, 'coalesced');
        // Still the newest thing it said, and the newest time: only the pulse is skipped.
        assertEqual(attention.flagFor('/w/one').message, 'second');
        assertEqual(attention.flagFor('/w/one').at, T0 + 1000);
    });

    test('a repeat after the window is a new event again', () => {
        const c = clock();
        const attention = new Attention({ now: c.now, coalesceMs: 4000 });
        const rows = rowsOf('/w/one');
        attention.record(asking('/w/one'), rows);
        c.advance(5000);
        assertEqual(attention.record(asking('/w/one'), rows).accepted, true);
    });

    test('two different projects in the same second are two events', () => {
        const attention = new Attention({ now: clock().now, coalesceMs: 4000 });
        const rows = rowsOf('/w/one', '/w/two');
        assertEqual(attention.record(asking('/w/one'), rows).accepted, true);
        assertEqual(attention.record(asking('/w/two'), rows).accepted, true);
    });

    test('a hook stuck in a loop cannot turn the panel into a strobe', () => {
        const c = clock();
        const attention = new Attention({ now: c.now, coalesceMs: 0, ceilingPerMinute: 10 });
        const rows = rowsOf('/w/one');

        let accepted = 0;
        for (let i = 0; i < 100; i++) {
            if (attention.record(asking('/w/one'), rows).accepted)
                accepted++;
            c.advance(100); // ten a second, for ten seconds
        }
        assertEqual(accepted, 10, 'the ceiling did not hold');
        // The flag is still up, and still current: only the noise was dropped.
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING);
    });

    test('the ceiling is per minute, not for ever', () => {
        const c = clock();
        const attention = new Attention({ now: c.now, coalesceMs: 0, ceilingPerMinute: 2 });
        const rows = rowsOf('/w/one');
        assertEqual(attention.record(asking('/w/one'), rows).accepted, true);
        assertEqual(attention.record(asking('/w/one'), rows).accepted, true);
        assertEqual(attention.record(asking('/w/one'), rows).accepted, false);
        c.advance(61_000);
        assertEqual(attention.record(asking('/w/one'), rows).accepted, true);
    });
});

suite('attention: clearing it', () => {
    test('opening the menu clears the flags on the rows it shows', () => {
        const attention = new Attention({ now: clock().now });
        const rows = rowsOf('/w/one', '/w/two');
        attention.record(asking('/w/one'), rows);
        attention.record(asking('/w/two'), rows);

        attention.acknowledgeVisible(rows.slice(0, 1));
        assertEqual(attention.flagFor('/w/one'), null);
        assertEqual(attention.flagFor('/w/two').kind, KIND.ASKING,
            'a row the menu did not show was not seen');
    });

    test('opening the menu clears fleet attention too, because you looked', () => {
        const attention = new Attention({ now: clock().now });
        attention.record(asking('/elsewhere'), rowsOf('/w/one'));
        attention.acknowledgeVisible(rowsOf('/w/one'));
        assertEqual(attention.fleet, null);
    });

    test('activating a row clears that row', () => {
        const attention = new Attention({ now: clock().now });
        const rows = rowsOf('/w/one', '/w/two');
        attention.record(asking('/w/one'), rows);
        attention.record(asking('/w/two'), rows);
        attention.acknowledge('/w/one');
        assertEqual(attention.flagFor('/w/one'), null);
        assertEqual(attention.flagFor('/w/two').kind, KIND.ASKING);
    });

    test('recap saying a project is no longer waiting clears an asking flag', () => {
        const attention = new Attention({ now: clock().now });
        const rows = rowsOf('/w/one');
        attention.record(asking('/w/one'), rows);

        attention.reconcile([{ ...rows[0], statusWord: 'waiting' }]);
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING, 'still waiting, still flagged');

        attention.reconcile([{ ...rows[0], statusWord: 'running' }]);
        assertEqual(attention.flagFor('/w/one'), null, 'it is working again; the question is answered');
    });

    test('reconciling does not clear a finished flag', () => {
        // "It finished" is news whatever recap says the session is doing now.
        const attention = new Attention({ now: clock().now });
        const rows = rowsOf('/w/one');
        attention.record(finished('/w/one'), rows);
        attention.reconcile([{ ...rows[0], statusWord: 'idle' }]);
        assertEqual(attention.flagFor('/w/one').kind, KIND.FINISHED);
    });

    test('a report that has lost the project keeps the flag rather than dropping it', () => {
        // recap unavailable, or the window moved: not evidence that the question went away.
        const attention = new Attention({ now: clock().now });
        attention.record(asking('/w/one'), rowsOf('/w/one'));
        attention.reconcile([]);
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING);
    });

    test('nothing clears on a timer', () => {
        // A question asked while you were away from the machine is still a question when
        // you come back.
        const c = clock();
        const attention = new Attention({ now: c.now });
        attention.record(asking('/w/one'), rowsOf('/w/one'));
        c.advance(8 * 60 * 60 * 1000);
        attention.reconcile(rowsOf('/w/one').map(r => ({ ...r, statusWord: 'waiting' })));
        assertEqual(attention.flagFor('/w/one').kind, KIND.ASKING);
        assertEqual(attention.count, 1);
    });

    test('clearing everything is what disable does', () => {
        const attention = new Attention({ now: clock().now });
        attention.record(asking('/w/one'), rowsOf('/w/one'));
        attention.record(asking('/elsewhere'), rowsOf('/w/one'));
        attention.clear();
        assertEqual(attention.count, 0);
        assertEqual(attention.summary(), null);
    });
});

suite('attention against a real report', () => {
    const document = decodeDocument(fixtureText('every-status')).document;

    test('an event from a recorded project directory finds its row', () => {
        const rows = buildRows(document);
        const attention = new Attention({ now: clock().now });
        const result = attention.record(asking('/home/demo/projects/blog-pipeline'), rows);
        assertEqual(result.key, '/home/demo/projects/blog-pipeline');
        assertEqual(attention.count, 1);
    });

    test('the row model carries the directories an event can be matched against', () => {
        const rows = buildRows(document);
        const row = rows.find(r => r.name === 'blog-pipeline');
        assert(row.dirs.includes('/home/demo/projects/blog-pipeline'),
            `expected the session directory in ${JSON.stringify(row.dirs)}`);
    });
});
