// Static guards for the rules the review checklist is made of, and for the one that keeps
// this suite honest: everything with a decision in it stays out of the compositor-only
// files, or it stops being testable here.

import { suite, test, assert } from './harness.js';
import { readFile, listFiles } from './util.js';

const LIB = listFiles('src', 'lib').filter(name => name.endsWith('.js'));
const SHELL_FILES = ['extension.js', 'prefs.js'];

suite('code hygiene', () => {
    test('there is a lib/ to speak of', () => {
        assert(LIB.length >= 5, `only found ${LIB.length} modules under src/lib`);
    });

    test('nothing under lib/ imports the shell, so all of it runs under plain gjs', () => {
        for (const name of LIB) {
            const source = readFile('src', 'lib', name);
            assert(!source.includes('resource:///org/gnome/shell'),
                `lib/${name} imports the shell`);
            assert(!source.includes('gi://St'), `lib/${name} imports St`);
            assert(!source.includes('gi://Clutter'), `lib/${name} imports Clutter`);
        }
    });

    test('the shell-side files use the modern ESM base classes', () => {
        const extension = readFile('src', 'extension.js');
        assert(extension.includes("from 'resource:///org/gnome/shell/extensions/extension.js'"),
            'extension.js does not import the Extension base class');
        assert(/export default class \w+ extends Extension/.test(extension),
            'extension.js does not export an Extension subclass');

        const prefs = readFile('src', 'prefs.js');
        assert(prefs.includes('ExtensionPreferences'),
            'prefs.js does not use ExtensionPreferences');
        assert(/export default class \w+ extends ExtensionPreferences/.test(prefs),
            'prefs.js does not export an ExtensionPreferences subclass');
    });

    test('nothing blocks the compositor on a subprocess or a file read', () => {
        // The synchronous spellings are the ones that freeze the desktop, and they are what
        // a reviewer greps for first.
        const forbidden = [
            'spawn_sync', 'spawn_command_line_sync', 'communicate_utf8(', 'communicate(',
            'load_contents(', 'GLib.spawn_async_with_pipes',
        ];
        for (const name of [...SHELL_FILES.map(f => ['src', f]), ...LIB.map(n => ['src', 'lib', n])]) {
            const source = readFile(...name);
            for (const needle of forbidden) {
                assert(!source.includes(needle),
                    `${name.join('/')} uses ${needle}, which blocks the main loop`);
            }
        }
    });

    test('no eval, and no global monkey-patching', () => {
        for (const name of [...SHELL_FILES.map(f => ['src', f]), ...LIB.map(n => ['src', 'lib', n])]) {
            const source = readFile(...name);
            assert(!/\beval\s*\(/.test(source), `${name.join('/')} calls eval`);
            assert(!/\bnew Function\s*\(/.test(source), `${name.join('/')} builds a function from a string`);
            assert(!/\.prototype\.\w+\s*=/.test(source),
                `${name.join('/')} patches a prototype, which outlives disable()`);
        }
    });

    test('every signal the indicator connects is disconnected when it is destroyed', () => {
        // The rule reviewers check by hand, checked here instead: a handler that outlives
        // disable() keeps the whole extension alive with it.
        const source = readFile('src', 'extension.js');
        const connected = [...source.matchAll(/this\.(_\w+Id) = ([\w.]+)\.connect\(/g)];
        assert(connected.length >= 3, `only found ${connected.length} stored signal handlers`);

        const teardown = source.slice(source.indexOf('_onDestroy()'));
        for (const [, field] of connected) {
            assert(teardown.includes(`disconnect(this.${field})`),
                `${field} is connected but never disconnected in _onDestroy`);
        }
    });

    test('the extension destroys its source and stops its schedule on the way out', () => {
        const teardown = readFile('src', 'extension.js');
        const onDestroy = teardown.slice(teardown.indexOf('_onDestroy()'));
        assert(onDestroy.includes('this._scheduler.stop()'), 'the schedule is never stopped');
        assert(onDestroy.includes('this._source.destroy()'), 'the source is never destroyed');
    });

    test('the packed stylesheet only styles this extension\'s own classes', () => {
        // A rule matching a shell class would restyle the rest of the desktop, which is a
        // rejection and a very confusing bug report.
        const css = readFile('src', 'stylesheet.css');
        for (const selector of css.matchAll(/^\s*([.#][\w-]+)/gm)) {
            assert(selector[1].startsWith('.recap-'),
                `stylesheet.css styles ${selector[1]}, which is not ours`);
        }
    });
});
