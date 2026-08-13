#!/usr/bin/env bash
# Install this working tree into the local extensions directory, for trying it in a real
# shell. Copies rather than symlinks: the shell reads a compiled schema, which has to sit
# next to the sources, and a symlinked tree makes it too easy to edit the installed copy by
# accident.
set -euo pipefail

uuid="recap@recap-gs.patxi"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"

rm -rf "$dest"
mkdir -p "$dest"
cp -r "$here/src/." "$dest/"
glib-compile-schemas "$dest/schemas"

echo "installed to $dest"
echo
echo "On X11:    Alt+F2, r, Enter — then: gnome-extensions enable $uuid"
echo "On Wayland: log out and back in, or try it in a nested shell:"
echo "  dbus-run-session -- gnome-shell --nested --wayland"
