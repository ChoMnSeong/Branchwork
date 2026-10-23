#!/usr/bin/env bash
set -euo pipefail
# Build Resources/AppIcon.icns from the shared 1024px source (assets/icon.png)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../assets/icon.png"
SET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
    sips -z $s $s "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$ROOT/Resources/AppIcon.icns"
rm -rf "$(dirname "$SET")"
echo "✅ $ROOT/Resources/AppIcon.icns"
