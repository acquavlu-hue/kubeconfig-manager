#!/usr/bin/env bash
set -euo pipefail

output=${1:?Uso: bash scripts/bundle-ffmpeg-source.sh <archivio.tar.gz>}
electron_version=45.2.3
ffmpeg_revision=9db86ce5b5b454dfc96c435f9f0723012980c37f
locked_electron=$(node -p 'require("./package-lock.json").packages["node_modules/electron"].version')
if [[ "$locked_electron" != "$electron_version" ]]; then
  echo "Verifica la revisione e le patch FFmpeg per Electron $locked_electron prima della release." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/source/electron" "$work/source/ffmpeg"

curl --fail --silent --show-error --location --retry 3 --max-time 120 \
  "https://codeload.github.com/electron/electron/tar.gz/refs/tags/v$electron_version" \
  --output "$work/electron.tar.gz"
curl --fail --silent --show-error --location --retry 3 --max-time 120 \
  "https://chromium.googlesource.com/chromium/third_party/ffmpeg/+archive/$ffmpeg_revision.tar.gz" \
  --output "$work/ffmpeg.tar.gz"

tar -xzf "$work/electron.tar.gz" -C "$work/source/electron" --strip-components 1
tar -xzf "$work/ffmpeg.tar.gz" -C "$work/source/ffmpeg"
test -s "$work/source/ffmpeg/COPYING.LGPLv2.1"

patches="$work/source/electron/patches/ffmpeg"
while IFS= read -r patch; do
  if [[ -n "$patch" ]]; then
    git -C "$work/source/ffmpeg" apply "$patches/$patch"
  fi
done < "$patches/.patches"

cat > "$work/source/README.txt" <<EOF
FFmpeg source for Electron $electron_version

The ffmpeg directory contains Chromium FFmpeg revision $ffmpeg_revision
with the Electron patch queue applied in the order in electron/patches/ffmpeg/.patches.
The electron directory contains the matching upstream Electron tag, including the
DEPS file, patches, build instructions and GN arguments for the standard release
build in build/args/release.gn and build/args/all.gn.

Upstream build instructions
https://github.com/electron/electron/blob/v$electron_version/docs/development/build-instructions-gn.md
EOF

tar -czf "$output" -C "$work/source" README.txt electron ffmpeg
