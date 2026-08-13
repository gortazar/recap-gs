// The bus surface, against a real bus.
//
// Not a fake: the thing worth checking here is that a `gdbus call` from outside reaches the
// handler and that the name goes away again on stop(), and no stand-in can vouch for either.
// The suite needs a session bus — the nix check and `nix run .#tests` both run it under
// `dbus-run-session`, and so should you:
//
//     dbus-run-session -- gjs -m tests/run.js

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEqual } from './harness.js';
import {
    EventService, BUS_NAME, OBJECT_PATH, INTERFACE_NAME, INTERFACE_XML,
} from '../src/lib/eventService.js';

const bus = GLib.getenv('DBUS_SESSION_BUS_ADDRESS');

/** Call Event() the way the shim does: from outside, over the bus, and wait for the reply. */
function callEvent(kind, payload) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            BUS_NAME, OBJECT_PATH, INTERFACE_NAME, 'Event',
            new GLib.Variant('(ss)', [kind, payload]),
            null, Gio.DBusCallFlags.NONE, 3000, null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function nameHasOwner() {
    const reply = Gio.DBus.session.call_sync(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'NameHasOwner', new GLib.Variant('(s)', [BUS_NAME]),
        null, Gio.DBusCallFlags.NONE, 3000, null);
    return reply.deepUnpack()[0];
}

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Wait for a condition the bus daemon will satisfy in its own time. */
async function eventually(predicate, what) {
    for (let i = 0; i < 50; i++) {
        if (predicate())
            return;
        await sleep(20);
    }
    throw new Error(`timed out waiting for ${what}`);
}

suite('the event interface', () => {
    test('is one method taking two strings and returning nothing', () => {
        // The shape is the public promise. If this test has to change, so does the version
        // in docs/event-interface.md and every shim already installed.
        assertEqual(BUS_NAME, 'org.gnome.Shell.Extensions.RecapGs');
        assertEqual(OBJECT_PATH, '/org/gnome/Shell/Extensions/RecapGs');
        assert(INTERFACE_XML.includes('<method name="Event">'), 'no Event method');
        assert(INTERFACE_XML.includes('type="s" name="kind" direction="in"'), 'no kind arg');
        assert(INTERFACE_XML.includes('type="s" name="payload" direction="in"'), 'no payload arg');
        assert(!INTERFACE_XML.includes('direction="out"'), 'Event should return nothing');
    });
});

if (bus === null) {
    suite('the event service (skipped: no session bus)', () => {
        test('run the suite under dbus-run-session to exercise the bus', () => {
            throw new Error(
                'no DBUS_SESSION_BUS_ADDRESS: run `dbus-run-session -- gjs -m tests/run.js`');
        });
    });
} else {
    suite('the event service', () => {
        test('a call from outside reaches the handler, argument for argument', async () => {
            const seen = [];
            const service = new EventService({ onEvent: (kind, payload) => seen.push([kind, payload]) });
            service.start();
            await eventually(() => nameHasOwner(), 'the bus name to be owned');

            await callEvent('asking', '{"cwd":"/w"}');
            assertEqual(seen.length, 1);
            assertEqual(seen[0][0], 'asking');
            assertEqual(seen[0][1], '{"cwd":"/w"}');

            service.stop();
        });

        test('the payload is passed through exactly, not re-encoded on the way', async () => {
            const seen = [];
            const service = new EventService({ onEvent: (kind, payload) => seen.push(payload) });
            service.start();
            await eventually(() => nameHasOwner(), 'the bus name to be owned');

            const payload = '{"cwd":"/w","message":"quotes \\" and — dashes and \\u00e9"}';
            await callEvent('asking', payload);
            assertEqual(seen[0], payload);

            service.stop();
        });

        test('a handler that throws does not fail the caller', async () => {
            // The caller is a hook inside somebody's agent. It can do nothing with our
            // failure, and an exception escaping a bus handler takes the shell with it.
            const service = new EventService({
                onEvent: () => {
                    throw new Error('deliberate');
                },
            });
            service.start();
            await eventually(() => nameHasOwner(), 'the bus name to be owned');

            await callEvent('asking', '{"cwd":"/w"}'); // rejects the test if it throws
            service.stop();
        });

        test('stopping gives the name back', async () => {
            const service = new EventService({});
            service.start();
            await eventually(() => nameHasOwner(), 'the bus name to be owned');
            service.stop();
            await eventually(() => !nameHasOwner(), 'the bus name to be released');
        });

        test('stopping unexports the object, so a stale call finds nothing', async () => {
            const seen = [];
            const service = new EventService({ onEvent: () => seen.push(1) });
            service.start();
            await eventually(() => nameHasOwner(), 'the bus name to be owned');
            service.stop();
            await eventually(() => !nameHasOwner(), 'the bus name to be released');

            let failed = false;
            await callEvent('asking', '{"cwd":"/w"}').catch(() => {
                failed = true;
            });
            assert(failed, 'a call after stop() should find nobody home');
            assertEqual(seen.length, 0);
        });

        test('five rounds of start and stop leave nothing owned', async () => {
            // The same discipline the indicator's teardown has: what matters is not that it
            // works once, but that it is symmetric.
            const service = new EventService({});
            for (let i = 0; i < 5; i++) {
                service.start();
                await eventually(() => nameHasOwner(), `the name to be owned in round ${i + 1}`);
                service.stop();
                await eventually(() => !nameHasOwner(), `the name to be released in round ${i + 1}`);
            }
            assertEqual(service.isRunning, false);
        });

        test('starting twice does not own the name twice', async () => {
            const service = new EventService({});
            service.start();
            service.start();
            await eventually(() => nameHasOwner(), 'the bus name to be owned');
            service.stop();
            await eventually(() => !nameHasOwner(), 'one stop() to undo both starts');
        });

        test('stopping without starting is not an error', () => {
            new EventService({}).stop();
        });
    });
}
