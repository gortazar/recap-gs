// Packaging metadata is checked by a test because a mistake in it is invisible until the
// shell refuses to load the extension — or until extensions.gnome.org rejects the upload.

import { suite, test, assert, assertEqual } from './harness.js';
import { readJSON, readFile } from './util.js';

export const UUID = 'recap@recap-gs.patxi';
export const SCHEMA_ID = 'org.gnome.shell.extensions.recap';

suite('metadata.json', () => {
    test('carries every field extensions.gnome.org requires', () => {
        const meta = readJSON('src', 'metadata.json');
        for (const field of ['uuid', 'name', 'description', 'shell-version', 'url']) {
            assert(field in meta, `missing "${field}"`);
            const value = meta[field];
            const empty = Array.isArray(value) ? value.length === 0 : value === '';
            assert(!empty, `"${field}" is empty`);
        }
    });

    test('uuid matches the one the flake packs and the schema path assumes', () => {
        assertEqual(readJSON('src', 'metadata.json').uuid, UUID);
    });

    test('declares the shell versions pwgen supports', () => {
        // The answered open question says: the same versions as the sibling pwgen idea,
        // whose CI boots Fedora 40-44 plus rawhide.
        const versions = readJSON('src', 'metadata.json')['shell-version'];
        for (const v of ['46', '47', '48', '49', '50'])
            assert(versions.includes(v), `shell-version is missing ${v}`);
    });

    test('points at the settings schema this extension ships', () => {
        const meta = readJSON('src', 'metadata.json');
        assertEqual(meta['settings-schema'], SCHEMA_ID);
        const xml = readFile('src', 'schemas', `${SCHEMA_ID}.gschema.xml`);
        assert(xml.includes(`id="${SCHEMA_ID}"`), 'the schema XML declares a different id');
        assert(xml.includes(`path="/${SCHEMA_ID.replace(/\./g, '/')}/"`),
            'the schema path does not follow from its id');
    });
});
