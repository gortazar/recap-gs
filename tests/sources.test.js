import { suite, test, assert, assertEqual } from './harness.js';
import {
    SOURCE, TERMINAL_WM_CLASSES, isTerminalWindow,
    DEFAULT_NOTIFICATION_APPS, matchesNotificationApp, notificationEvent,
} from '../src/lib/sources.js';
import { TERMINALS } from '../src/lib/resume.js';
import { Attention, KIND } from '../src/lib/attention.js';

suite('secondary sources: terminal windows', () => {
    test('knows the terminals it already knows how to open', () => {
        // One list of terminals, not two that drift: a terminal worth resuming a session in
        // is a terminal whose bell is worth listening to.
        for (const terminal of TERMINALS) {
            assert(TERMINAL_WM_CLASSES.some(wmClass =>
                wmClass.toLowerCase().includes(terminal.name.toLowerCase()) ||
                terminal.name.toLowerCase().includes(wmClass.toLowerCase())),
            `no wm_class for the ${terminal.name} this extension can launch`);
        }
    });

    test('matches however the compositor happens to capitalise it', () => {
        // The same terminal reports a different capitalisation under X11 and Wayland, and
        // comparing exactly is how a filter silently matches nothing at all.
        assert(isTerminalWindow('org.gnome.Console'));
        assert(isTerminalWindow('org.gnome.console'));
        assert(isTerminalWindow('ALACRITTY'));
        assert(isTerminalWindow(' kitty '));
    });

    test('does not treat everything with a window as a terminal', () => {
        assert(!isTerminalWindow('firefox'));
        assert(!isTerminalWindow('org.gnome.Nautilus'));
        assert(!isTerminalWindow(''));
        assert(!isTerminalWindow(null));
        assert(!isTerminalWindow(undefined));
    });
});

suite('secondary sources: notifications', () => {
    test('listens to the agents by default and to nothing else', () => {
        assert(matchesNotificationApp(DEFAULT_NOTIFICATION_APPS, 'Claude Code'));
        assert(matchesNotificationApp(DEFAULT_NOTIFICATION_APPS, 'opencode'));
        assert(!matchesNotificationApp(DEFAULT_NOTIFICATION_APPS, 'Fractal'));
    });

    test('matches whole names, not substrings', () => {
        // "code" in the list must not swallow every notification Visual Studio Code sends.
        assert(!matchesNotificationApp(['code'], 'Visual Studio Code'));
        assert(matchesNotificationApp(['code'], 'Code'));
    });

    test('an empty or missing app name matches nothing', () => {
        assert(!matchesNotificationApp(DEFAULT_NOTIFICATION_APPS, ''));
        assert(!matchesNotificationApp(DEFAULT_NOTIFICATION_APPS, null));
        assert(!matchesNotificationApp(null, 'opencode'));
    });

    test('a notification is an agent asking for you, in its own words', () => {
        const event = notificationEvent('Claude Code', 'Waiting for your input');
        assertEqual(event.kind, KIND.ASKING);
        assertEqual(event.message, 'Claude Code — Waiting for your input');
        assertEqual(event.cwd, '', 'a notification cannot name a project');
    });

    test('a notification with only a title still says something', () => {
        assertEqual(notificationEvent('Claude Code', '').message, 'Claude Code');
        assertEqual(notificationEvent('', '').message, '');
    });

    test('a source that cannot name a project raises fleet attention, not a wrong row', () => {
        const attention = new Attention({ now: () => 0 });
        const rows = [{ key: '/w/one', dir: '/w/one', dirs: ['/w/one'], statusWord: 'idle' }];
        const result = attention.record(notificationEvent('opencode', 'needs you'), rows);
        assertEqual(result.key, null);
        assertEqual(attention.fleet.kind, KIND.ASKING);
        assertEqual(attention.flagFor('/w/one'), null);
    });
});

suite('secondary sources: the list of them', () => {
    test('there are exactly three, and each has a settings key', () => {
        assertEqual(Object.keys(SOURCE).length, 3);
        assertEqual(SOURCE.DBUS, 'dbus');
        assertEqual(SOURCE.NOTIFICATIONS, 'notifications');
        assertEqual(SOURCE.TERMINAL_BELL, 'terminal-bell');
    });
});
