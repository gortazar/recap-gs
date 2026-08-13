#!/bin/sh
# Install the recap GNOME Shell extension from its latest release.
#
#     curl -fsSL https://raw.githubusercontent.com/gortazar/recap-gs/main/install.sh | sh
#
# Downloads the packed extension from GitHub, verifies it against the checksum published
# beside it, and unpacks it into your extensions directory. Nothing is built, nothing needs
# root, and nothing outside ~/.local/share/gnome-shell/extensions is touched.
#
# Options, as environment variables:
#   VERSION=v0.2   install a particular release instead of the latest
#   PREFIX=...     install somewhere other than $XDG_DATA_HOME/gnome-shell/extensions
set -eu

REPO="${REPO:-gortazar/recap-gs}"
UUID="recap@recap-gs.patxi"
ASSET="$UUID.shell-extension.zip"
VERSION="${VERSION:-latest}"
PREFIX="${PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions}"

for tool in curl unzip; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "recap-gs: $tool is needed and was not found on PATH" >&2
        exit 1
    }
done

if [ "$VERSION" = "latest" ]; then
    base="https://github.com/$REPO/releases/latest/download"
else
    base="https://github.com/$REPO/releases/download/$VERSION"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "recap-gs: downloading $ASSET ($VERSION)"
curl -fsSL "$base/$ASSET" -o "$tmp/$ASSET" || {
    echo "recap-gs: could not download $base/$ASSET" >&2
    exit 1
}

# The checksum is published by the same workflow that built the zip. Its job is to catch a
# truncated or corrupted download, which is exactly the failure that otherwise shows up
# later as an extension that will not load.
if curl -fsSL "$base/$ASSET.sha256" -o "$tmp/$ASSET.sha256" 2>/dev/null; then
    if command -v sha256sum >/dev/null 2>&1; then
        ( cd "$tmp" && sha256sum -c "$ASSET.sha256" >/dev/null ) || {
            echo "recap-gs: the download does not match its published checksum" >&2
            exit 1
        }
        echo "recap-gs: checksum ok"
    fi
else
    echo "recap-gs: no checksum published for this release; continuing" >&2
fi

dest="$PREFIX/$UUID"
rm -rf "$dest"
mkdir -p "$dest"
unzip -q -o "$tmp/$ASSET" -d "$dest"

# The zip ships the compiled schema, but a schema compiled by a newer glib than yours is
# worth recompiling if the tool is here.
if command -v glib-compile-schemas >/dev/null 2>&1 && [ -d "$dest/schemas" ]; then
    glib-compile-schemas "$dest/schemas" 2>/dev/null || true
fi

echo "recap-gs: installed to $dest"

if command -v gnome-extensions >/dev/null 2>&1; then
    # Enabling only works once the shell has noticed the new directory, which on Wayland
    # means after a re-login. Try anyway: on X11, and on a second install, it works now.
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        echo "recap-gs: enabled"
    else
        echo "recap-gs: log out and back in, then run: gnome-extensions enable $UUID"
    fi
else
    echo "recap-gs: log out and back in, then enable it in the Extensions app"
fi

command -v recap >/dev/null 2>&1 || cat <<'EOF'

recap-gs shows what the `recap` command reports, and recap is not on your PATH yet.
Install it from https://github.com/gortazar/recap — until then the menu will say so.
EOF
