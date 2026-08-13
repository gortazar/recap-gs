// Helpers shared by the test suites: locating the checkout and reading fixtures.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/**
 * The idea folder, derived from this file's own location rather than the working
 * directory, so the suite runs the same from anywhere and from the nix store.
 */
export function rootDir() {
    const here = GLib.filename_from_uri(import.meta.url)[0];
    return GLib.path_get_dirname(GLib.path_get_dirname(here));
}

export function readFile(...parts) {
    const path = GLib.build_filenamev([rootDir(), ...parts]);
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error(`could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

export function readJSON(...parts) {
    return JSON.parse(readFile(...parts));
}

/** The names of the files in a directory of the checkout, sorted. */
export function listFiles(...parts) {
    const dir = Gio.File.new_for_path(GLib.build_filenamev([rootDir(), ...parts]));
    const names = [];
    const iter = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = iter.next_file(null)) !== null)
        names.push(info.get_name());
    names.sort();
    return names;
}

/** Every committed `recap --json` fixture, by file name without the extension. */
export function fixtureNames() {
    return listFiles('tests', 'fixtures')
        .filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -'.json'.length));
}

export function fixture(name) {
    return readJSON('tests', 'fixtures', `${name}.json`);
}

export function fixtureText(name) {
    return readFile('tests', 'fixtures', `${name}.json`);
}
