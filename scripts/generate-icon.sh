#!/usr/bin/env bash
#
# Builds build/icon.icns from build/icon.svg.
#
# Uses rsvg-convert for rasterising and macOS's own iconutil for the .icns
# container. Run after editing the SVG:
#
#   ./scripts/generate-icon.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

SVG="build/icon.svg"
ICONSET="build/icon.iconset"
OUT="build/icon.icns"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert is required (brew install librsvg)" >&2
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# macOS expects these exact names and sizes.
render() {
  local size="$1" name="$2"
  rsvg-convert -w "$size" -h "$size" -o "$ICONSET/$name" "$SVG"
}

render 16   icon_16x16.png
render 32   icon_16x16@2x.png
render 32   icon_32x32.png
render 64   icon_32x32@2x.png
render 128  icon_128x128.png
render 256  icon_128x128@2x.png
render 256  icon_256x256.png
render 512  icon_256x256@2x.png
render 512  icon_512x512.png
render 1024 icon_512x512@2x.png

iconutil --convert icns --output "$OUT" "$ICONSET"
rm -rf "$ICONSET"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
