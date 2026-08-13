#!/usr/bin/env -S gjs -m
//
// Trim the full-screen captures the smoke-test driver takes down to the part a reader cares
// about. The shell screenshots a whole 1280x1024 virtual monitor; an indicator 20 pixels
// wide in the corner of that is not a screenshot of anything.
//
//     gjs -m ci/crop.js screenshots
//
// The regions are fixed because the layout is: the panel is at the top, our indicator is the
// last thing in it, and the menu opens directly underneath. Anything that moves them will be
// obvious in the result, which is the point of committing the images.

import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

const CROPS = [
    // The indicator itself, doubled: it is small on purpose, and small in a README is
    // useless.
    { name: 'panel.png', x: 1000, y: 0, width: 280, height: 34, scale: 2 },
    // The open menu, with the indicator it hangs from still in frame.
    { name: 'menu.png', x: 700, y: 0, width: 580, height: 500, scale: 1 },
    // preferences.png is left alone: it is a window, and a window in its desktop is a fair
    // picture of a window.
];

const dir = ARGV[0];
if (!dir) {
    printerr('usage: gjs -m ci/crop.js <screenshots-dir>');
    imports.system.exit(2);
}

for (const crop of CROPS) {
    const path = GLib.build_filenamev([dir, crop.name]);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        printerr(`no ${path} to crop`);
        imports.system.exit(1);
    }

    const full = GdkPixbuf.Pixbuf.new_from_file(path);
    const width = Math.min(crop.width, full.get_width() - crop.x);
    const height = Math.min(crop.height, full.get_height() - crop.y);
    let out = full.new_subpixbuf(crop.x, crop.y, width, height);
    if (crop.scale !== 1) {
        out = out.scale_simple(width * crop.scale, height * crop.scale,
            GdkPixbuf.InterpType.BILINEAR);
    }
    out.savev(path, 'png', [], []);
    print(`cropped ${crop.name} to ${out.get_width()}x${out.get_height()}`);
}
