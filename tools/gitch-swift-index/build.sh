#!/usr/bin/env bash
set -euo pipefail

# gitch-swift-index 빌드 — 앱 빌드(macos/build.sh)와 같은 까닭으로 SwiftPM 없이 swiftc 로 바로(일부 Command Line Tools 에서 SwiftPM 이 깨져 있음)
#   tools/gitch-swift-index/build.sh <출력 파일> [아키텍처…]   아키텍처를 주지 않으면 이 맥의 것, 여럿이면 유니버설
# 아키텍처마다 .build/swiftc/<아키텍처> 에 두고, 소스가 바뀔 때만 다시 컴파일한다.

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?사용법: build.sh <출력 파일> [아키텍처…]}"
shift
ARCHS=("$@")
[[ ${#ARCHS[@]} -gt 0 ]] || ARCHS=("$(uname -m)")
SRC="$ROOT/Sources/gitch-swift-index"

BINS=()
for arch in "${ARCHS[@]}"; do
    bin="$ROOT/.build/swiftc/$arch/gitch-swift-index"
    if [[ ! -f "$bin" || -n "$(find "$SRC" "$0" -newer "$bin" -print -quit)" ]]; then
        echo "▶ gitch-swift-index ($arch)…"
        mkdir -p "$(dirname "$bin")"
        sources=()
        while IFS= read -r -d '' f; do sources+=("$f"); done < <(find "$SRC" -name '*.swift' -print0 | sort -z)
        swiftc -O -swift-version 5 -target "$arch-apple-macos15.0" -module-name gitch_swift_index "${sources[@]}" -o "$bin"
    fi
    BINS+=("$bin")
done
mkdir -p "$(dirname "$OUT")"
lipo -create "${BINS[@]}" -output "$OUT"
