#!/usr/bin/env bash
set -euo pipefail

# Branchwork 맥 앱 빌드 (swiftc, 비샌드박스)
#   macos/build.sh           → macos/build/Branchwork.app (이 맥의 아키텍처, 개발 인증서가 있으면 그걸로 서명)
#   macos/build.sh install   → 빌드 후 /Applications 로 설치
#   macos/build.sh release   → macos/dist/ 에 배포용 zip·dmg (Apple Silicon + Intel 유니버설, ad-hoc 서명)

BIN="Branchwork"
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
BUILD="$ROOT/build"
BUNDLE="$BUILD/$BIN.app"
CONTENTS="$BUNDLE/Contents"
MODE="${1:-}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$ROOT/Resources/Info.plist")"

if [[ "$MODE" == "release" ]]; then ARCHS=(arm64 x86_64); else ARCHS=("$(uname -m)"); fi

[ -f "$ROOT/Resources/AppIcon.icns" ] || "$ROOT/Tools/makeicon.sh"

# SwiftPM 없이 swiftc 로 바로 빌드한다(일부 Command Line Tools 에서 SwiftPM·SwiftUI 매크로가 깨져 있음).
ST_SRC="$ROOT/Vendor/SwiftTerm/Sources"
SWIFT_FLAGS=(-O -parse-as-library -swift-version 5)

build_arch() {
    local arch="$1"
    local target="$arch-apple-macos15.0"
    local st="$ROOT/.build/swiftterm/$arch"
    local obj="$ROOT/.build/swiftc/$arch"
    # 터미널 에뮬레이터 SwiftTerm(MIT, Vendor/SwiftTerm)은 정적 라이브러리로 따로 빌드해 두고, 소스가 바뀔 때만 다시 만든다.
    if [[ ! -f "$st/libSwiftTerm.a" || -n "$(find "$ST_SRC" -name '*.swift' -newer "$st/libSwiftTerm.a" -print -quit)" ]]; then
        echo "▶ SwiftTerm ($arch, 처음 한 번 1분쯤)…"
        mkdir -p "$st"
        find "$ST_SRC" -name '*.swift' -print0 | xargs -0 swiftc "${SWIFT_FLAGS[@]}" -target "$target" \
            -module-name SwiftTerm -emit-module -emit-module-path "$st/SwiftTerm.swiftmodule" \
            -emit-library -static -o "$st/libSwiftTerm.a"
    fi
    echo "▶ swiftc ($arch)…"
    mkdir -p "$obj"
    local sources=()
    while IFS= read -r -d '' f; do sources+=("$f"); done < <(find "$ROOT/Sources" -name '*.swift' -print0 | sort -z)
    swiftc "${SWIFT_FLAGS[@]}" -target "$target" -I "$st" -L "$st" -lSwiftTerm \
        -module-name "$BIN" "${sources[@]}" -o "$obj/$BIN"
}

BINS=()
for arch in "${ARCHS[@]}"; do
    build_arch "$arch"
    BINS+=("$ROOT/.build/swiftc/$arch/$BIN")
done

rm -rf "$BUILD"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
lipo -create "${BINS[@]}" -output "$CONTENTS/MacOS/$BIN"
cp "$ROOT/Resources/Info.plist" "$CONTENTS/Info.plist"
cp "$ROOT/Resources/AppIcon.icns" "$CONTENTS/Resources/AppIcon.icns"
# 화면 번역(한국어 글자가 키, <언어>.lproj/Localizable.strings)
cp -R "$ROOT/Resources/Localizations/"*.lproj "$CONTENTS/Resources/"
cp "$REPO/LICENSE" "$CONTENTS/Resources/LICENSE.txt"
cp "$ROOT/Vendor/SwiftTerm/LICENSE" "$CONTENTS/Resources/SwiftTerm-LICENSE.txt"

# 서명: 고정 인증서(Apple Development 등)가 있으면 그걸로 서명한다.
# ad-hoc(-)은 빌드마다 서명이 바뀌어 macOS 키체인이 매번 '다른 앱'으로 보고 접근 허용을 다시 묻는다.
# 다른 인증서를 쓰려면 BRANCHWORK_SIGN_IDENTITY="인증서 이름" ./build.sh
# 배포본(release)은 개인 개발 인증서를 넣지 않고 ad-hoc 으로 서명한다(Developer ID 가 있으면 환경 변수로 지정).
if [[ "$MODE" == "release" ]]; then
    IDENTITY="${BRANCHWORK_SIGN_IDENTITY:-}"
else
    IDENTITY="${BRANCHWORK_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|Developer ID Application/ {print $2; exit}')}"
fi
sign() {
    if [[ -n "$IDENTITY" ]]; then
        codesign --force --sign "$IDENTITY" "$1"
    else
        codesign --force --sign - "$1"
    fi
}
echo "▶ 서명: ${IDENTITY:-ad-hoc}"
sign "$BUNDLE"
echo "✅ 빌드 완료: $BUNDLE ($(lipo -archs "$CONTENTS/MacOS/$BIN"))"

case "$MODE" in
install)
    DEST="/Applications/$BIN.app"
    rm -rf "$DEST"
    cp -R "$BUNDLE" "$DEST"
    sign "$DEST"
    echo "✅ 설치 완료: $DEST"
    echo "   실행:  open \"$DEST\""
    ;;
release)
    DIST="$ROOT/dist"
    NAME="$BIN-$VERSION-macOS"
    mkdir -p "$DIST"
    rm -f "$DIST/$NAME".*
    ditto -c -k --keepParent "$BUNDLE" "$DIST/$NAME.zip"
    STAGE="$(mktemp -d)"
    cp -R "$BUNDLE" "$STAGE/"
    ln -s /Applications "$STAGE/Applications"
    hdiutil create -quiet -volname "$BIN $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DIST/$NAME.dmg"
    rm -rf "$STAGE"
    (cd "$DIST" && shasum -a 256 "$NAME.zip" "$NAME.dmg" > "$NAME.sha256")
    echo "✅ 배포 파일:"
    ls -lh "$DIST/$NAME".*
    ;;
*)
    echo "   실행:  open \"$BUNDLE\""
    echo "   설치:  $0 install"
    ;;
esac
