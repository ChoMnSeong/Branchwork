#!/usr/bin/env bash
set -euo pipefail
# 앱 아이콘 생성: makeicon.swift(CoreGraphics) → 1024 PNG → iconset → AppIcon.icns
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/Resources"
swift "$ROOT/Tools/makeicon.swift" "$RES/icon_1024.png"
SET="$RES/AppIcon.iconset"
rm -rf "$SET" && mkdir -p "$SET"
for s in 16 32 128 256 512; do
    sips -z $s $s "$RES/icon_1024.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d "$RES/icon_1024.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$RES/AppIcon.icns"
rm -rf "$SET"
echo "✅ $RES/AppIcon.icns"
