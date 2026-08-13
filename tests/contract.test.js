import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import { suite, test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { listFiles, rootDir } from './util.js';
import {
    SUPPORTED_SCHEMA_VERSION, STATUS_WORDS, UNCLEAR, statusInfo, iconNameFor, moreUrgent,
} from '../src/lib/contract.js';

suite('contract', () => {
    test('supports recap JSON schema version 1', () => {
        assertEqual(SUPPORTED_SCHEMA_VERSION, 1);
    });

    test('knows exactly the six status words recap emits', () => {
        // recap's README pins this list as a guarantee of schema version 1. If it ever
        // grows a seventh, this test is where the two ideas notice.
        assertDeepEqual([...STATUS_WORDS].sort(),
            ['finished', 'idle', 'interrupted', 'running', 'unclear', 'waiting']);
    });

    test('gives every status a symbolic icon, a label and recap emoji', () => {
        for (const word of STATUS_WORDS) {
            const info = statusInfo(word);
            assertEqual(info.word, word);
            assert(info.iconName.endsWith('-symbolic'), `${word}: not a symbolic icon name`);
            assert(info.label.length > 0, `${word}: no label`);
            assert(info.emoji.length > 0, `${word}: no emoji to match recap's own output`);
        }
    });

    test('uses the same emoji recap prints, so panel and terminal agree', () => {
        assertEqual(statusInfo('running').emoji, '🟢');
        assertEqual(statusInfo('waiting').emoji, '🟡');
        assertEqual(statusInfo('idle').emoji, '⚪');
        assertEqual(statusInfo('interrupted').emoji, '🔴');
        assertEqual(statusInfo('finished').emoji, '✅');
        assertEqual(statusInfo('unclear').emoji, '❓');
    });

    test('treats a status it has never heard of as unclear rather than throwing', () => {
        // A newer recap emitting a new word must not break the panel: recap stays the
        // authority, and "I do not know what that is" is itself unclear.
        assertEqual(statusInfo('reticulating').word, UNCLEAR);
        assertEqual(iconNameFor('reticulating'), iconNameFor(UNCLEAR));
        assertEqual(statusInfo(undefined).word, UNCLEAR);
    });

    test('ranks waiting above everything, because it is the one needing you', () => {
        assertEqual(moreUrgent('waiting', 'running'), 'waiting');
        assertEqual(moreUrgent('running', 'waiting'), 'waiting');
        assertEqual(moreUrgent('running', 'interrupted'), 'running');
        assertEqual(moreUrgent('interrupted', 'unclear'), 'interrupted');
        assertEqual(moreUrgent('unclear', 'idle'), 'unclear');
        assertEqual(moreUrgent('idle', 'finished'), 'idle');
        assertEqual(moreUrgent(null, 'finished'), 'finished');
        assertEqual(moreUrgent(null, null), null);
    });

    test('every shipped icon is an image the shell can actually load', () => {
        // Learned the hard way: an SVG whose <svg> element is pushed past the first few
        // lines by a comment fails format detection outright, and the panel shows a blank
        // where the icon should be — with nothing in the log that names the file.
        for (const name of listFiles('src', 'icons')) {
            const path = GLib.build_filenamev([rootDir(), 'src', 'icons', name]);
            try {
                GdkPixbuf.Pixbuf.new_from_file_at_size(path, 16, 16);
            } catch (e) {
                throw new Error(`icons/${name} will not load: ${e.message}`);
            }
        }
    });

    test('ships an SVG for every status icon it names', () => {
        // Symbolic icons under a stranger's icon theme are a gamble: five distinguishable
        // ones are not guaranteed to exist. These are ours, so they always do.
        const shipped = listFiles('src', 'icons');
        for (const word of STATUS_WORDS) {
            const name = `${iconNameFor(word)}.svg`;
            assert(shipped.includes(name), `no icons/${name} for status ${word}`);
        }
    });
});
