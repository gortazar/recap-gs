#!/usr/bin/env bash
# Is the release really there, and is it the one this tree describes?
#
#   tools/check-release.sh [--version 0.5] [--repo gortazar/recap-gs]
#
# Asks GitHub for the newest `v*` release, downloads its artefact, and checks that it
# exists, carries its checksum, matches its published digest, and — the part a tag cannot
# tell you — that the `metadata.json` *inside the zip* says the version this tree says.
# Read-only, unauthenticated, and safe to run from anywhere.
#
# This exists because the release path fails silently. The workflow runs on a tag push after
# a merge, and nobody watches it; a tag can say v0.5 while the asset inside says something
# else, and the only person who finds out is whoever installed it. This is the one command
# that answers "did it publish, and is it what we think?".
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${RECAP_GS_REPO:-gortazar/recap-gs}"
ASSET="recap@recap-gs.patxi.shell-extension.zip"
VERSION=""

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
        --repo) REPO="${2:?--repo needs a value}"; shift 2 ;;
        -h | --help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

command -v jq >/dev/null || { echo "jq is not on PATH (run inside nix develop)" >&2; exit 2; }
command -v unzip >/dev/null || { echo "unzip is not on PATH (run inside nix develop)" >&2; exit 2; }

# The version this tree is, read from the one file that owns it. Not from STATUS.md, which
# lives in another repository, and not from a git tag, which is the thing being checked.
[ -n "$VERSION" ] || VERSION="$(jq -r '."version-name" // empty' src/metadata.json)"
[ -n "$VERSION" ] || { echo "src/metadata.json has no version-name, and no --version given" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

pass=0
fail=0
warn=0
ok() { printf '  ok    %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf '  FAIL  %s\n' "$*"; fail=$((fail + 1)); }
caution() { printf '  warn  %s\n' "$*"; warn=$((warn + 1)); }

echo "checking the newest v* release of $REPO, against version $VERSION"
echo

# --- the API ------------------------------------------------------------------------------
#
# A rate-limited unauthenticated API returns 403 with a perfectly well-formed body holding no
# releases, which reads exactly like "this project has never released anything". Telling the
# two apart is the difference between "go and fix the workflow" and "wait forty minutes", so
# the status code is captured rather than thrown away by `curl -f`.
status="$(curl -sSL -o "$WORK/releases.json" -w '%{http_code}' \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases?per_page=50" || echo 000)"

case "$status" in
    200) ;;
    403 | 429)
        remaining="$(jq -r '.message // "rate limited"' "$WORK/releases.json" 2>/dev/null || echo 'rate limited')"
        echo "  the GitHub API refused this request: HTTP $status" >&2
        echo "  $remaining" >&2
        echo >&2
        echo "This is NOT evidence that the release is missing — an unauthenticated API that" >&2
        echo "has run out of quota answers the same shape as a project with no releases." >&2
        echo "Wait for the window to reset, or run with a token in the environment." >&2
        exit 2 ;;
    404)
        echo "no such repository: $REPO (or it is private, which this cannot see)" >&2
        exit 2 ;;
    000)
        echo "could not reach the GitHub API at all" >&2
        exit 2 ;;
    *)
        echo "the GitHub API answered HTTP $status, which this script does not understand" >&2
        exit 2 ;;
esac

jq -e 'type == "array"' "$WORK/releases.json" >/dev/null 2>&1 || {
    echo "the GitHub API did not return a list of releases" >&2
    exit 2
}

total="$(jq -r 'length' "$WORK/releases.json")"
if [ "$total" -eq 0 ]; then
    echo "  FAIL  $REPO has published no releases at all"
    echo
    echo "The release is not what this tree describes. Actions:"
    echo "  https://github.com/$REPO/actions/workflows/release.yml"
    exit 1
fi

# Newest first, which is the order the API returns and the order install.sh relies on.
# Drafts are not installable and prereleases are not what install.sh fetches, so neither
# counts as the release this tree describes.
newest="$(jq -r --arg asset "$ASSET" '
    [ .[] | select(.draft == false and .prerelease == false and (.tag_name | startswith("v"))) ]
    | .[0] // empty
    | { tag: .tag_name,
        url: (.assets[]? | select(.name == $asset) | .browser_download_url) // "",
        digest: (.assets[]? | select(.name == $asset) | .digest) // "" }
    | @json' "$WORK/releases.json")"

[ -n "$newest" ] || { echo "  FAIL  no published, non-draft v* release found"; exit 1; }

TAG="$(printf '%s' "$newest" | jq -r '.tag')"
ZIP_URL="$(printf '%s' "$newest" | jq -r '.url')"
DIGEST="$(printf '%s' "$newest" | jq -r '.digest')"

# --- the tag ------------------------------------------------------------------------------

if [ "$TAG" = "v$VERSION" ]; then
    ok "the newest release is $TAG, the version this tree says"
else
    bad "the newest release is $TAG, but this tree says version $VERSION"
    echo "        (either the release for $VERSION has not published yet, or a later"
    echo "         version was released and this tree is behind)"
fi

# --- the artefact -------------------------------------------------------------------------

if [ -z "$ZIP_URL" ]; then
    bad "$TAG carries no $ASSET — there is nothing to install"
else
    ok "it carries $ASSET"

    if curl -fsSL --retry 2 -o "$WORK/asset.zip" "$ZIP_URL"; then
        ok "the artefact downloads"
        actual="$(sha256sum "$WORK/asset.zip" | cut -d' ' -f1)"

        case "$DIGEST" in
            sha256:*)
                if [ "${DIGEST#sha256:}" = "$actual" ]; then
                    ok "it matches the digest GitHub reports"
                else
                    bad "it does NOT match the digest GitHub reports (${DIGEST#sha256:} vs $actual)"
                fi ;;
            *) caution "GitHub reported no digest for the asset" ;;
        esac

        # The whole point of this script. A tag is a label anybody can move; this is the
        # version in the bytes a user would actually install.
        if unzip -p "$WORK/asset.zip" metadata.json >"$WORK/metadata.json" 2>/dev/null; then
            inside="$(jq -r '."version-name" // empty' "$WORK/metadata.json")"
            if [ -z "$inside" ]; then
                bad "the artefact's metadata.json has no version-name — it cannot say what it is"
            elif [ "$inside" = "$VERSION" ]; then
                ok "the artefact's metadata.json says version-name $inside"
            else
                bad "the artefact says version-name $inside, but the tag and this tree say $VERSION"
            fi

            url="$(jq -r '.url // empty' "$WORK/metadata.json")"
            if [ "$url" = "https://github.com/$REPO" ]; then
                ok "its homepage link points at $REPO"
            else
                bad "its homepage link is $url, not https://github.com/$REPO"
            fi
        else
            bad "the artefact has no metadata.json — it is not a Shell extension"
        fi

        if curl -fsSL --retry 2 -o "$WORK/asset.sha256" "$ZIP_URL.sha256" 2>/dev/null; then
            if [ "$(cut -d' ' -f1 <"$WORK/asset.sha256")" = "$actual" ]; then
                ok "<asset>.sha256 is published and correct"
            else
                bad "<asset>.sha256 is published and WRONG"
            fi
        else
            bad "no <asset>.sha256 — install.sh asks for this, and would install unverified"
        fi
    else
        bad "the artefact does not download from $ZIP_URL"
    fi
fi

echo
printf '%s passed, %s failed, %s warned\n' "$pass" "$fail" "$warn"
if [ "$fail" -gt 0 ]; then
    echo
    echo "The release is not what this tree describes. Actions:"
    echo "  https://github.com/$REPO/actions/workflows/release.yml"
    exit 1
fi
echo "The published release is installable and is what this tree describes."
