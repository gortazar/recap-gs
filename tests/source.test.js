import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEqual } from './harness.js';
import { fixtureText, rootDir } from './util.js';
import { RecapSource, spawnRecap } from '../src/lib/source.js';
import { classifyOutcome } from '../src/lib/recap.js';
import { PROBLEM } from '../src/lib/problem.js';

// A seam that answers with whatever the test says, whenever the test says so.
function fakeSpawn(reply) {
    const calls = [];
    const spawn = (argv, cancellable) => {
        calls.push({ argv, cancellable });
        return reply(argv, cancellable);
    };
    spawn.calls = calls;
    return spawn;
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// A stand-in for GLib.timeout_add_seconds that lets the test decide when time passes.
function fakeTimers() {
    const timers = new Map();
    let next = 1;
    return {
        set(seconds, fn) {
            timers.set(next, { seconds, fn });
            return next++;
        },
        clear(id) {
            assert(timers.has(id), `cleared timer ${id} twice`);
            timers.delete(id);
        },
        fire(id) {
            const timer = timers.get(id);
            assert(timer, `no timer ${id} to fire`);
            timers.delete(id);
            timer.fn();
        },
        fireAll() {
            for (const id of [...timers.keys()])
                this.fire(id);
        },
        get pending() {
            return timers.size;
        },
        get only() {
            assertEqual(timers.size, 1, 'expected exactly one pending timer');
            return [...timers.keys()][0];
        },
    };
}

suite('the recap source', () => {
    test('runs the argv the settings ask for', async () => {
        const spawn = fakeSpawn(() => Promise.resolve({ exitStatus: 0, stdout: fixtureText('empty') }));
        const source = new RecapSource({ spawn });
        await source.refresh({ path: '/usr/bin/recap', since: '2d' });
        assertEqual(spawn.calls.length, 1);
        assertEqual(spawn.calls[0].argv.join(' '), '/usr/bin/recap --json --since 2d');
        source.destroy();
    });

    test('a good run becomes the current document', async () => {
        const source = new RecapSource({
            spawn: fakeSpawn(() => Promise.resolve({ exitStatus: 0, stdout: fixtureText('every-status') })),
        });
        const state = await source.refresh({});
        assertEqual(state.document.projects.length, 6);
        assertEqual(state.problem, null);
        assertEqual(state.stale, false);
        source.destroy();
    });

    test('a bad run keeps the last good document and marks it stale', async () => {
        let reply = () => Promise.resolve({ exitStatus: 0, stdout: fixtureText('every-status') });
        const source = new RecapSource({ spawn: fakeSpawn(() => reply()) });
        await source.refresh({});

        reply = () => Promise.resolve({ exitStatus: 1, stdout: '', stderr: 'recap: broke' });
        const state = await source.refresh({});

        // Six projects that were true a minute ago beat an empty menu, as long as the menu
        // admits they are a minute old.
        assertEqual(state.document.projects.length, 6);
        assertEqual(state.stale, true);
        assertEqual(state.problem.kind, PROBLEM.FAILED);
        source.destroy();
    });

    test('a good run after a bad one is fresh again', async () => {
        let reply = () => Promise.resolve({ exitStatus: 1, stdout: '', stderr: 'recap: broke' });
        const source = new RecapSource({ spawn: fakeSpawn(() => reply()) });
        await source.refresh({});
        assertEqual(source.state.problem.kind, PROBLEM.FAILED);

        reply = () => Promise.resolve({ exitStatus: 0, stdout: fixtureText('empty') });
        const state = await source.refresh({});
        assertEqual(state.problem, null);
        assertEqual(state.stale, false);
        source.destroy();
    });

    test('a timeout cancels the run and says so', async () => {
        const timers = fakeTimers();
        const pending = deferred();
        let cancelledWith = null;
        const source = new RecapSource({
            timeoutSeconds: 7,
            setTimer: timers.set.bind(timers),
            clearTimer: timers.clear.bind(timers),
            spawn: fakeSpawn((argv, cancellable) => {
                cancellable.connect(() => {
                    cancelledWith = cancellable;
                    pending.reject({ cancelled: true });
                });
                return pending.promise;
            }),
        });

        const refresh = source.refresh({});
        timers.fire(timers.only); // time passes
        const state = await refresh;

        assert(cancelledWith !== null, 'the cancellable should have been triggered');
        assertEqual(state.problem.kind, PROBLEM.TIMED_OUT);
        assert(state.problem.detail.includes('7'), 'should say how long it waited');
        source.destroy();
    });

    test('a run that answers in time leaves no timer behind', async () => {
        const timers = fakeTimers();
        const source = new RecapSource({
            setTimer: timers.set.bind(timers),
            clearTimer: timers.clear.bind(timers),
            spawn: fakeSpawn(() => Promise.resolve({ exitStatus: 0, stdout: fixtureText('empty') })),
        });
        await source.refresh({});
        assertEqual(timers.pending, 0, 'the timeout timer outlived the run');
        source.destroy();
    });

    test('will not run two refreshes at once', async () => {
        // The timer and an opened menu can easily coincide. Spawning recap twice over is
        // wasteful at best, and the two answers would race to be the one on screen.
        const pending = deferred();
        const spawn = fakeSpawn(() => pending.promise);
        const source = new RecapSource({ spawn });

        const first = source.refresh({});
        const second = source.refresh({});
        assertEqual(spawn.calls.length, 1, 'the second refresh spawned recap again');

        pending.resolve({ exitStatus: 0, stdout: fixtureText('empty') });
        const [a, b] = await Promise.all([first, second]);
        assertEqual(a, b, 'both callers should get the same answer');
        source.destroy();
    });

    test('destroy cancels the run in flight', async () => {
        const pending = deferred();
        let cancelled = false;
        const source = new RecapSource({
            spawn: fakeSpawn((argv, cancellable) => {
                cancellable.connect(() => {
                    cancelled = true;
                    pending.reject({ cancelled: true });
                });
                return pending.promise;
            }),
        });

        const refresh = source.refresh({});
        source.destroy();
        const state = await refresh;

        assert(cancelled, 'destroying the source should cancel the run');
        // Nobody is left to be told: the extension is going away.
        assertEqual(state.problem, null);
    });

    test('destroy leaves no timer behind either', async () => {
        const timers = fakeTimers();
        const pending = deferred();
        const source = new RecapSource({
            setTimer: timers.set.bind(timers),
            clearTimer: timers.clear.bind(timers),
            spawn: fakeSpawn((argv, cancellable) => {
                cancellable.connect(() => pending.reject({ cancelled: true }));
                return pending.promise;
            }),
        });
        const refresh = source.refresh({});
        source.destroy();
        await refresh;
        assertEqual(timers.pending, 0, 'the timeout timer outlived the source');
    });

    test('a refresh after destroy does nothing at all', async () => {
        const spawn = fakeSpawn(() => Promise.resolve({ exitStatus: 0, stdout: fixtureText('empty') }));
        const source = new RecapSource({ spawn });
        source.destroy();
        await source.refresh({});
        assertEqual(spawn.calls.length, 0, 'a destroyed source spawned a process');
    });
});

// The seam itself, against real processes. Everything above tests what the extension does
// with an answer; this tests that the answers are the shape the extension expects — the
// part no fake can vouch for.
suite('the real subprocess seam', () => {
    const fixturePath = GLib.build_filenamev([rootDir(), 'tests', 'fixtures', 'empty.json']);

    async function outcomeOf(argv) {
        const cancellable = new Gio.Cancellable();
        try {
            return await spawnRecap(argv, cancellable);
        } catch (outcome) {
            return outcome;
        }
    }

    test('reads a real report off a real process', async () => {
        const outcome = await outcomeOf(['/bin/sh', '-c', `cat ${fixturePath}`]);
        const result = classifyOutcome(outcome);
        assert(result.ok, JSON.stringify(result));
        assertEqual(result.document.version, 1);
    });

    test('a binary that is not there is the not-installed problem', async () => {
        const outcome = await outcomeOf(['recap-that-is-not-installed-xyzzy', '--json']);
        assertEqual(classifyOutcome(outcome).problem.kind, PROBLEM.NOT_INSTALLED);
    });

    test('a process that fails reports its stderr', async () => {
        const outcome = await outcomeOf(['/bin/sh', '-c', 'echo "recap: no store here" >&2; exit 2']);
        const problem = classifyOutcome(outcome).problem;
        assertEqual(problem.kind, PROBLEM.FAILED);
        assertEqual(problem.detail, 'recap: no store here');
    });

    test('a hung process is killed, not just abandoned', async () => {
        // Cancelling communicate_utf8_async stops us listening; it does not stop the child.
        // A recap invoked every 30 seconds that never exits would pile up processes for as
        // long as the session lasts.
        const marker = GLib.build_filenamev([GLib.dir_make_tmp('recap-gs-XXXXXX'), 'still-running']);
        const cancellable = new Gio.Cancellable();
        const run = spawnRecap(['/bin/sh', '-c', `sleep 30; touch ${marker}`], cancellable);
        cancellable.cancel();

        const outcome = await run.then(() => null, o => o);
        assert(outcome !== null, 'a cancelled run should not resolve');
        assertEqual(outcome.cancelled, true);

        // The child was killed, so it never reached the touch. Give it a moment either way.
        await sleep(300);
        assert(!GLib.file_test(marker, GLib.FileTest.EXISTS), 'the child survived cancellation');
    });
});

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}
