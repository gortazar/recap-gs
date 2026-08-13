import { suite, test, assert, assertEqual, assertDeepEqual } from './harness.js';
import { readFile } from './util.js';
import { PREFERENCE_GROUPS, preferenceKeys, splitRoots, joinRoots } from '../src/lib/preferences.js';
import { SCHEMA_ID } from './metadata.test.js';

function schemaKeys() {
    const xml = readFile('src', 'schemas', `${SCHEMA_ID}.gschema.xml`);
    return [...xml.matchAll(/<key name="([\w-]+)"/g)].map(m => m[1]).sort();
}

suite('preferences', () => {
    test('every setting the schema has is reachable in the window', () => {
        // A key nobody can change is a key that does not exist, as far as a user is
        // concerned.
        assertDeepEqual(preferenceKeys().sort(), schemaKeys());
    });

    test('no row invents a setting the schema does not have', () => {
        const known = new Set(schemaKeys());
        for (const key of preferenceKeys())
            assert(known.has(key), `the preferences window binds "${key}", which is not in the schema`);
    });

    test('every row says what it is for', () => {
        for (const group of PREFERENCE_GROUPS) {
            assert(group.title.length > 0, 'a group with no title');
            for (const row of group.rows) {
                assert(row.title.length > 0, `${row.key}: no title`);
                assert(['int', 'string', 'boolean', 'choice', 'paths'].includes(row.type),
                    `${row.key}: unknown row type ${row.type}`);
                if (row.type === 'choice')
                    assert(row.choices.length > 1, `${row.key}: a choice of one`);
            }
        }
    });

    test('the refresh interval is offered in a range the schema allows', () => {
        const row = PREFERENCE_GROUPS.flatMap(g => g.rows).find(r => r.key === 'refresh-interval');
        const xml = readFile('src', 'schemas', `${SCHEMA_ID}.gschema.xml`);
        const [, min, max] = xml.match(/<range min="(\d+)" max="(\d+)"\/>/);
        assert(row.min >= Number(min), `offers ${row.min}s, below the schema's minimum ${min}`);
        assert(row.max <= Number(max), `offers ${row.max}s, above the schema's maximum ${max}`);
    });

    test('prefs.js binds every row it is given', () => {
        // The window is built from the same description this suite checks, so it cannot
        // drift from the schema without one of these failing.
        const source = readFile('src', 'prefs.js');
        assert(source.includes('PREFERENCE_GROUPS'), 'prefs.js does not use the description');
        assert(source.includes('bind'), 'prefs.js never binds a setting');
    });
});

suite('project roots as text', () => {
    test('reads a colon-separated list, the way PATH is written', () => {
        assertDeepEqual(splitRoots('/home/me/git:/srv/work'), ['/home/me/git', '/srv/work']);
    });

    test('ignores the empty pieces a stray colon leaves behind', () => {
        assertDeepEqual(splitRoots(':/a::/b:'), ['/a', '/b']);
        assertDeepEqual(splitRoots(''), []);
        assertDeepEqual(splitRoots('   '), []);
    });

    test('trims what someone pasted with a space in front of it', () => {
        assertDeepEqual(splitRoots(' /a : /b '), ['/a', '/b']);
    });

    test('writes them back the same way round', () => {
        assertEqual(joinRoots(['/a', '/b']), '/a:/b');
        assertEqual(joinRoots([]), '');
        assertDeepEqual(splitRoots(joinRoots(['/a', '/b'])), ['/a', '/b']);
    });
});
