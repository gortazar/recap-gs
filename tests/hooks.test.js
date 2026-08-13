// The shim and the installer, run for real.
//
// Both are shell scripts that touch somebody's own configuration and run inside somebody's
// agent, so they are tested by running them: against a private bus with a stand-in service
// on the other end, and against a throwaway HOME.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEqual } from './harness.js';
import { rootDir } from './util.js';
import { EventService } from '../src/lib/eventService.js';

const SHIM = GLib.build_filenamev([rootDir(), 'bin', 'recap-gs-notify']);
const INSTALLER = GLib.build_filenamev([rootDir(), 'hooks', 'install-hooks.sh']);
const bus = GLib.getenv('DBUS_SESSION_BUS_ADDRESS');

/** Run a command with something on stdin; resolve with what it did. */
function run(argv, options = {}) {
    const { stdin = '', env = null, cwd = null } = options;
    return new Promise((resolve, reject) => {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE,
        });
        if (cwd !== null)
            launcher.set_cwd(cwd);
        for (const [key, value] of Object.entries(env ?? {}))
            launcher.setenv(key, value, true);

        const proc = launcher.spawnv(argv);
        proc.communicate_utf8_async(stdin, null, (subprocess, result) => {
            try {
                const [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                resolve({ status: subprocess.get_exit_status(), stdout, stderr });
            } catch (e) {
                reject(e);
            }
        });
    });
}

function tempHome() {
    const home = GLib.dir_make_tmp('recap-gs-hooks-XXXXXX');
    return {
        home,
        env: () => ({
            HOME: home,
            XDG_CONFIG_HOME: `${home}/.config`,
            RECAP_GS_BIN_DIR: `${home}/bin`,
            // The installer must not find a recap-gs-notify already on PATH, or it will
            // report the one belonging to whoever is running the suite.
            PATH: '/usr/bin:/bin',
        }),
        read(...parts) {
            const path = GLib.build_filenamev([home, ...parts]);
            const [ok, bytes] = GLib.file_get_contents(path);
            assert(ok, `could not read ${path}`);
            return new TextDecoder().decode(bytes);
        },
        exists(...parts) {
            return GLib.file_test(GLib.build_filenamev([home, ...parts]), GLib.FileTest.EXISTS);
        },
        write(contents, ...parts) {
            const path = GLib.build_filenamev([home, ...parts]);
            GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
            GLib.file_set_contents(path, new TextEncoder().encode(contents));
        },
    };
}

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

suite('the shim', () => {
    test('exists, and is executable', () => {
        assert(GLib.file_test(SHIM, GLib.FileTest.IS_EXECUTABLE), `${SHIM} is not executable`);
    });

    test('does nothing, successfully, when the extension is not running', async () => {
        // The common case for anyone who has the hooks installed and the extension disabled,
        // and it happens on every single turn of their agent.
        const result = await run([SHIM, 'asking'], { stdin: '{"cwd":"/w"}' });
        assertEqual(result.status, 0);
        assertEqual(result.stdout, '');
        assertEqual(result.stderr, '');
    });

    test('exits 0 with no arguments, no stdin, and nothing to talk to', async () => {
        const bare = await run([SHIM]);
        assertEqual(bare.status, 0);
        const empty = await run([SHIM, 'finished'], { stdin: '' });
        assertEqual(empty.status, 0);
    });

    test('is quick even with nobody listening', async () => {
        // A hook that takes a second makes the agent it is attached to feel slow.
        const started = GLib.get_monotonic_time();
        await run([SHIM, 'asking'], { stdin: '{"cwd":"/w"}' });
        const elapsedMs = (GLib.get_monotonic_time() - started) / 1000;
        assert(elapsedMs < 3000, `took ${Math.round(elapsedMs)}ms with no service running`);
    });

    if (bus !== null) {
        test('delivers the kind and the payload, untouched', async () => {
            const seen = [];
            const service = new EventService({ onEvent: (kind, payload) => seen.push([kind, payload]) });
            service.start();
            await sleep(200);

            const payload = '{"cwd":"/home/demo/projects/blog-pipeline","message":"needs you"}';
            const result = await run([SHIM, 'asking'], { stdin: payload });
            assertEqual(result.status, 0);
            await sleep(200);

            assertEqual(seen.length, 1, `service saw ${JSON.stringify(seen)}`);
            assertEqual(seen[0][0], 'asking');
            assertEqual(seen[0][1], payload);

            service.stop();
            await sleep(100);
        });

        test('sends an empty object rather than nothing when stdin is empty', async () => {
            const seen = [];
            const service = new EventService({ onEvent: (kind, payload) => seen.push(payload) });
            service.start();
            await sleep(200);

            await run([SHIM, 'finished'], { stdin: '' });
            await sleep(200);
            assertEqual(seen[0], '{}');

            service.stop();
            await sleep(100);
        });
    }
});

suite('the hook installer', () => {
    test('prints what it would add without touching anything', async () => {
        const home = tempHome();
        const result = await run(['bash', INSTALLER, '--print'], { env: home.env() });
        assertEqual(result.status, 0);
        assert(result.stdout.includes('recap-gs-notify asking'), result.stdout);
        assert(result.stdout.includes('recap-gs-notify finished'), result.stdout);
        assert(!home.exists('.claude', 'settings.json'), '--print wrote to settings.json');
    });

    test('refuses to change anything unasked when nobody can answer', async () => {
        // Piped into, rather than run at a terminal: the answered question says confirm
        // first, and a script that cannot ask must not assume.
        const home = tempHome();
        const result = await run(['bash', INSTALLER], { env: home.env() });
        assert(result.status !== 0, 'should have refused');
        assert(!home.exists('.claude', 'settings.json'), 'it wrote anyway');
        assert(result.stderr.includes('--yes'), result.stderr);
    });

    test('installs both Claude Code hooks and the opencode plugin', async () => {
        const home = tempHome();
        const result = await run(['bash', INSTALLER, '--yes'], { env: home.env() });
        assertEqual(result.status, 0, result.stderr);

        const settings = JSON.parse(home.read('.claude', 'settings.json'));
        assertEqual(settings.hooks.Notification[0].hooks[0].command, 'recap-gs-notify asking');
        assertEqual(settings.hooks.Notification[0].hooks[0].type, 'command');
        assertEqual(settings.hooks.Stop[0].hooks[0].command, 'recap-gs-notify finished');

        assert(home.exists('.config', 'opencode', 'plugin', 'recap-gs.js'),
            'the opencode plugin was not installed');
        assert(home.exists('bin', 'recap-gs-notify'), 'the shim was not installed');
    });

    test('running it twice leaves one entry, not two', async () => {
        const home = tempHome();
        await run(['bash', INSTALLER, '--yes'], { env: home.env() });
        await run(['bash', INSTALLER, '--yes'], { env: home.env() });

        const settings = JSON.parse(home.read('.claude', 'settings.json'));
        assertEqual(settings.hooks.Notification.length, 1);
        assertEqual(settings.hooks.Stop.length, 1);
    });

    test('leaves hooks somebody else wrote exactly where they were', async () => {
        const home = tempHome();
        home.write(JSON.stringify({
            model: 'opus',
            hooks: {
                Notification: [{ hooks: [{ type: 'command', command: 'notify-send hello' }] }],
                PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] }],
            },
        }, null, 2), '.claude', 'settings.json');

        await run(['bash', INSTALLER, '--yes'], { env: home.env() });
        const settings = JSON.parse(home.read('.claude', 'settings.json'));

        assertEqual(settings.model, 'opus', 'an unrelated setting was lost');
        assertEqual(settings.hooks.PreToolUse[0].hooks[0].command, 'my-guard');
        assertEqual(settings.hooks.Notification.length, 2, 'the existing Notification hook was lost');
        assertEqual(settings.hooks.Notification[0].hooks[0].command, 'notify-send hello');
        assertEqual(settings.hooks.Notification[1].hooks[0].command, 'recap-gs-notify asking');
    });

    test('backs the settings file up before touching it', async () => {
        const home = tempHome();
        home.write('{"model": "opus"}', '.claude', 'settings.json');
        await run(['bash', INSTALLER, '--yes'], { env: home.env() });
        assert(home.exists('.claude', 'settings.json.recap-gs.bak'), 'no backup was made');
        assertEqual(JSON.parse(home.read('.claude', 'settings.json.recap-gs.bak')).model, 'opus');
    });

    test('will not touch a settings file it cannot parse', async () => {
        // Rewriting a file somebody is midway through editing is how you lose their config.
        const home = tempHome();
        home.write('{ this is not json', '.claude', 'settings.json');
        const result = await run(['bash', INSTALLER, '--yes'], { env: home.env() });
        assert(result.status !== 0, 'should have refused');
        assertEqual(home.read('.claude', 'settings.json'), '{ this is not json');
    });

    test('uninstalling takes ours out and leaves theirs in', async () => {
        const home = tempHome();
        home.write(JSON.stringify({
            hooks: { Stop: [{ hooks: [{ type: 'command', command: 'make lint' }] }] },
        }), '.claude', 'settings.json');

        await run(['bash', INSTALLER, '--yes'], { env: home.env() });
        await run(['bash', INSTALLER, '--yes', '--uninstall'], { env: home.env() });

        const settings = JSON.parse(home.read('.claude', 'settings.json'));
        assertEqual(settings.hooks.Stop.length, 1);
        assertEqual(settings.hooks.Stop[0].hooks[0].command, 'make lint');
        assertEqual(settings.hooks.Notification, undefined,
            'an event we added and then removed should be gone entirely');
        assert(!home.exists('.config', 'opencode', 'plugin', 'recap-gs.js'),
            'the opencode plugin outlived the uninstall');
    });

    test('uninstalling something that was never installed is not an error', async () => {
        const home = tempHome();
        const result = await run(['bash', INSTALLER, '--yes', '--uninstall'], { env: home.env() });
        assertEqual(result.status, 0, result.stderr);
    });
});
