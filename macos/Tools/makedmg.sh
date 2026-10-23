#!/usr/bin/env bash
set -euo pipefail
# 배포용 dmg: 열면 배경 그림(빛 줄기·안내 문구) 위에 앱과 Applications 바로가기가 나란히 보인다.
#   Tools/makedmg.sh <앱.app> "<볼륨 이름>" <출력.dmg>
# 창 모양(.DS_Store)은 Finder 에 직접 맞추게 한다. 다른 도구로 쓴 배경 설정은 macOS 26 Finder 가 읽지 못했다.
# 아이콘 자리(가운데 x 160 · 480, y 160)는 Tools/dmgbackground.swift 의 빛 줄기와 맞춘다.
# 설치한 뒤 디스크 정리(꺼내기·응용 프로그램 폴더로 옮기기)는 앱이 연다: Sources/App/InstallerDisk.swift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$1"
VOL="$2"
OUT="$3"
NAME="$(basename "$APP")"
WORK="$ROOT/.build/dmg"

# 같은 이름의 볼륨이 이미 열려 있으면 Finder 가 어느 쪽인지 헷갈린다
if [ -e "/Volumes/$VOL" ]; then
    echo "❌ /Volumes/$VOL 가 이미 열려 있습니다. 꺼낸 뒤 다시 실행하세요." >&2
    exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage/.background"
swiftc -O "$ROOT/Tools/dmgbackground.swift" -o "$WORK/dmgbackground"
"$WORK/dmgbackground" "$WORK"
tiffutil -cathidpicheck "$WORK/background.png" "$WORK/background@2x.png" -out "$WORK/stage/.background/background.tiff" 2>/dev/null
cp -R "$APP" "$WORK/stage/"
ln -s /Applications "$WORK/stage/Applications"

hdiutil create -quiet -volname "$VOL" -srcfolder "$WORK/stage" -fs HFS+ -format UDRW -ov "$WORK/rw.dmg"
hdiutil attach -quiet -noautoopen "$WORK/rw.dmg"
MOUNT="/Volumes/$VOL"
trap 'hdiutil detach -quiet "$MOUNT" 2>/dev/null || true' EXIT

# 창 안쪽 640×400(제목 막대 32 포함한 높이 432), 툴바·사이드바·상태바 없이 아이콘 128
osascript <<EOF
tell application "Finder"
    tell disk "$VOL"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {200, 120, 840, 552}
        set opts to icon view options of container window
        set arrangement of opts to not arranged
        set icon size of opts to 128
        set text size of opts to 13
        set shows item info of opts to false
        set shows icon preview of opts to true
        -- 배경 그림 바탕색(dmgbackground.swift 의 night #1C2436). 그림이 어두우니 색도 어둡게 맞춰 둔다
        set background color of opts to {7196, 9252, 13878}
        set background picture of opts to file ".background:background.tiff"
        set position of item "$NAME" of container window to {160, 160}
        set position of item "Applications" of container window to {480, 160}
        update without registering applications
        delay 1
        close
    end tell
end tell
EOF

# Finder 가 .DS_Store 를 다 쓸 때까지 기다린다
for _ in $(seq 1 20); do
    [ -s "$MOUNT/.DS_Store" ] && break
    sleep 0.5
done
[ -s "$MOUNT/.DS_Store" ] || { echo "❌ Finder 가 창 설정(.DS_Store)을 쓰지 않았습니다." >&2; exit 1; }
sleep 1
rm -rf "$MOUNT/.fseventsd"
sync
hdiutil detach -quiet "$MOUNT"
trap - EXIT

rm -f "$OUT"
hdiutil convert -quiet "$WORK/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$OUT"
rm -rf "$WORK"
