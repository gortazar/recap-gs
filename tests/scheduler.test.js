import { suite, test, assert, assertEqual } from './harness.js';
import { Scheduler } from '../src/lib/scheduler.js';

function fakeTimers() {
    const timers = new Map();
    let next = 1;
    return {
        set(seconds, fn) {
            timers.set(next, { seconds, fn });
            return next++;
        },
        clear(id) {
            assert(timers.has(id), `cleared timer ${id}, which was not pending`);
            timers.delete(id);
        },
        fire() {
            assertEqual(timers.size, 1, 'expected exactly one pending timer');
            const [id, timer] = [...timers.entries()][0];
            timers.delete(id);
            timer.fn();
        },
        get pending() {
            return timers.size;
        },
        get seconds() {
            assertEqual(timers.size, 1, 'expected exactly one pending timer');
            return [...timers.values()][0].seconds;
        },
    };
}

function makeScheduler(options = {}) {
    const timers = fakeTimers();
    const ticks = [];
    const scheduler = new Scheduler({
        intervalSeconds: 30,
        setTimer: timers.set.bind(timers),
        clearTimer: timers.clear.bind(timers),
        onTick: () => ticks.push(Date.now()),
        ...options,
    });
    return { scheduler, timers, ticks };
}

suite('refresh schedule', () => {
    test('starting refreshes at once — an empty panel for 30 seconds is a broken one', () => {
        const { scheduler, ticks } = makeScheduler();
        scheduler.start();
        assertEqual(ticks.length, 1);
        scheduler.stop();
    });

    test('then refreshes on the configured interval, over and over', () => {
        const { scheduler, timers, ticks } = makeScheduler();
        scheduler.start();
        assertEqual(timers.seconds, 30);
        timers.fire();
        assertEqual(ticks.length, 2);
        timers.fire();
        assertEqual(ticks.length, 3);
        assertEqual(timers.pending, 1, 'the schedule should keep going');
        scheduler.stop();
    });

    test('stopping leaves no timer behind', () => {
        const { scheduler, timers } = makeScheduler();
        scheduler.start();
        scheduler.stop();
        assertEqual(timers.pending, 0);
    });

    test('stopping twice is not an error', () => {
        const { scheduler } = makeScheduler();
        scheduler.start();
        scheduler.stop();
        scheduler.stop();
    });

    test('starting twice does not double the refresh rate', () => {
        const { scheduler, timers, ticks } = makeScheduler();
        scheduler.start();
        scheduler.start();
        assertEqual(timers.pending, 1, 'two schedules are running at once');
        assertEqual(ticks.length, 1, 'the second start refreshed again for no reason');
        scheduler.stop();
    });

    test('a new interval takes effect without waiting for the old one', () => {
        const { scheduler, timers } = makeScheduler();
        scheduler.start();
        scheduler.setInterval(5);
        assertEqual(timers.seconds, 5);
        assertEqual(timers.pending, 1, 'the old timer is still pending');
        scheduler.stop();
    });

    test('a new interval on a stopped schedule does not start it', () => {
        const { scheduler, timers } = makeScheduler();
        scheduler.setInterval(5);
        assertEqual(timers.pending, 0);
    });

    test('does not refresh while suppressed, but keeps its schedule', () => {
        // Polling behind a lock screen spends battery on a report nobody can see.
        let locked = true;
        const { scheduler, timers, ticks } = makeScheduler({ isSuppressed: () => locked });
        scheduler.start();
        assertEqual(ticks.length, 0, 'refreshed while suppressed');
        assertEqual(timers.pending, 1, 'the schedule stopped instead of skipping');

        timers.fire();
        assertEqual(ticks.length, 0);

        locked = false;
        timers.fire();
        assertEqual(ticks.length, 1, 'did not resume when the suppression lifted');
        scheduler.stop();
    });

    test('refreshes the moment it is woken, and starts the interval over', () => {
        // What the menu does when it is opened: the answer on screen should be about now,
        // and the next scheduled refresh should not land a second later.
        const { scheduler, timers, ticks } = makeScheduler();
        scheduler.start();
        assertEqual(ticks.length, 1);
        scheduler.wake();
        assertEqual(ticks.length, 2);
        assertEqual(timers.pending, 1);
        assertEqual(timers.seconds, 30);
        scheduler.stop();
    });

    test('waking a stopped schedule still refreshes, but does not start it', () => {
        const { scheduler, timers, ticks } = makeScheduler();
        scheduler.wake();
        assertEqual(ticks.length, 1, 'an opened menu should refresh even so');
        assertEqual(timers.pending, 0, 'waking must not start a schedule of its own');
    });

    test('waking while suppressed refreshes anyway', () => {
        // If something asked for this — an opened menu — there is somebody looking at it.
        const { scheduler, ticks } = makeScheduler({ isSuppressed: () => true });
        scheduler.wake();
        assertEqual(ticks.length, 1);
    });
});
