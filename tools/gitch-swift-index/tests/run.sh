#!/usr/bin/env bash
set -euo pipefail

# gitch-swift-index 확인 — tests/fixture(작은 SwiftPM 예제)를 임시 폴더에 복사해 swift build 로 인덱스를 만들고,
# 도우미가 tests/expected.tsv 의 쌍을 내는지, 인덱스를 찾는 곳 · 오래된 인덱스 경고 · 종료 코드가 맞는지 본다.
#   tools/gitch-swift-index/tests/run.sh [도우미]   주지 않으면 build.sh 로 이 맥 아키텍처용을 만든다(CI 는 앱 번들 안의 것을 준다)
# swift(Xcode 또는 Command Line Tools)와 libIndexStore 가 필요하다. 실제 DerivedData 는 읽지 않는다(--derived-data 로 임시 폴더).

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gitch-swift-index-test.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

if [[ $# -gt 0 ]]; then
    HELPER="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
else
    HELPER="$TMP/gitch-swift-index"
    "$TOOL/build.sh" "$HELPER"
fi

passed=0
failed=0
ok() {
    passed=$((passed + 1))
    echo "✔ $1"
}
bad() {
    failed=$((failed + 1))
    echo "✘ $1"
    [[ -z "${2:-}" ]] || printf '%s\n' "$2" | sed 's/^/    /'
}
# 도우미 실행 → $TMP/out · $TMP/err · $rc
run() {
    rc=0
    "$HELPER" "$@" > "$TMP/out" 2> "$TMP/err" || rc=$?
}
same_pairs() {
    diff -u "$HERE/expected.tsv" "$TMP/out" > "$TMP/diff" && return 0
    cat "$TMP/diff" "$TMP/err"
    return 1
}

# 예제 저장소: Generated.swift 는 빌드에 들어가지만 추적하지 않는다(쌍에 나오면 안 됨)
repo="$TMP/repo"
cp -R "$HERE/fixture" "$repo"
git -C "$repo" init -q
git -C "$repo" add .
printf 'enum Generated {\n    static let banner = "Total:"\n}\n' > "$repo/Sources/App/Generated.swift"
echo "▶ swift build (예제)…"
swift build --package-path "$repo" > "$TMP/build.log" 2>&1 || {
    cat "$TMP/build.log"
    exit 1
}
nodd="$TMP/no-derived-data"

run --repo "$repo" --derived-data "$nodd"
if [[ $rc == 0 ]] && out=$(same_pairs) && [[ ! -s "$TMP/err" ]]; then ok "SwiftPM 인덱스(.build)에서 기대한 쌍"; else bad "SwiftPM 인덱스 (종료 코드 $rc)" "$out"; fi

run --repo "$repo/Sources/App" --derived-data "$nodd"
if [[ $rc == 0 ]] && out=$(same_pairs); then ok "하위 폴더를 줘도 뿌리 기준 경로"; else bad "하위 폴더 (종료 코드 $rc)" "$out"; fi

run --repo "$repo" --derived-data "$nodd" --covered "$TMP/covered"
want=$(cd "$repo" && git ls-files 'Sources/*.swift' | LC_ALL=C sort)
if [[ $rc == 0 ]] && [[ "$(LC_ALL=C sort "$TMP/covered")" == "$want" ]]; then ok "--covered: 인덱스에 든 추적 파일(Package.swift · Generated.swift 빼고)"
else bad "--covered (종료 코드 $rc)" "$(diff <(echo "$want") <(LC_ALL=C sort "$TMP/covered"))"; fi

touch -t 203001010000 "$repo/Sources/App/Report.swift"
run --repo "$repo" --derived-data "$nodd"
if [[ $rc == 0 ]] && out=$(same_pairs) && grep -q '경고:.*1개.*Sources/App/Report.swift' "$TMP/err"; then ok "고친 파일이 인덱스보다 새로우면 경고(쌍은 그대로)"
else bad "오래된 인덱스 경고 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi
touch -t 200001010000 "$repo/Sources/App/Report.swift"

# gitch graph files 가 이 쌍을 정확한 연결(kind ref)로 쓰고 Swift 끼리 짐작하지 않는지 — 이 저장소의 gitch 로, 임시 HOME 에서
gitch="$(cd "$TOOL/../gitch" && pwd)/gitch"
mkdir -p "$TMP/home"
rc=0
(cd "$repo" && HOME="$TMP/home" GITCH_SWIFT_INDEX="$HELPER" "$gitch" graph files --format json) > "$TMP/graph.json" 2> "$TMP/err" || rc=$?
# 하나도 없으면 grep 이 1 로 끝난다(set -e · pipefail)
count() { { grep -o "$1" "$2" || true; } | wc -l | tr -d ' '; }
refs=$(count '"kind":"ref"' "$TMP/graph.json")
guesses=$(count '"heuristic":true' "$TMP/graph.json")
if [[ $rc == 0 && $refs == "$(wc -l < "$HERE/expected.tsv" | tr -d ' ')" && $guesses == 0 ]] && grep -q 'gitch-swift-index' "$TMP/graph.json"
then ok "gitch graph files: 정확한 연결(kind ref) ${refs}개, 짐작 0"; else bad "gitch graph files (종료 코드 $rc, ref $refs, 짐작 $guesses)" "$(cat "$TMP/err")"; fi

# 빌드 뒤 새로 만든 추적 파일은 인덱스에 없다 — gitch 는 --covered 목록 밖의 파일만 이름으로 짐작한다
printf 'struct Later {\n    let report: Report\n}\n' > "$repo/Sources/App/Later.swift"
git -C "$repo" add Sources/App/Later.swift
rc=0
(cd "$repo" && HOME="$TMP/home" GITCH_SWIFT_INDEX="$HELPER" "$gitch" graph files --format json) > "$TMP/graph.json" 2> "$TMP/err" || rc=$?
refs=$(count '"kind":"ref"' "$TMP/graph.json")
guesses=$(count '"heuristic":true' "$TMP/graph.json")
if [[ $rc == 0 && $refs == "$(wc -l < "$HERE/expected.tsv" | tr -d ' ')" && $guesses == 1 ]] &&
    grep -q '"source":"Sources/App/Later.swift","target":"Sources/App/Report.swift"' "$TMP/graph.json"
then ok "인덱스에 없는 추적 파일만 짐작(Later.swift → Report.swift)"; else bad "인덱스에 없는 파일 (종료 코드 $rc, ref $refs, 짐작 $guesses)" "$(cat "$TMP/err")"; fi
git -C "$repo" rm -q --cached Sources/App/Later.swift
rm "$repo/Sources/App/Later.swift"

# 성공해도 표준오류 첫 줄(오래된 인덱스 경고)은 gitch 가 notes 에 적는다
touch -t 203001010000 "$repo/Sources/App/Report.swift"
rc=0
(cd "$repo" && HOME="$TMP/home" GITCH_SWIFT_INDEX="$HELPER" "$gitch" graph files --format json) > "$TMP/graph.json" 2> "$TMP/err" || rc=$?
if [[ $rc == 0 ]] && grep -q '오래됐습니다(예: Sources/App/Report.swift)' "$TMP/graph.json"; then ok "오래된 인덱스 경고가 gitch graph 의 notes 에"
else bad "notes 의 경고 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi
touch -t 200001010000 "$repo/Sources/App/Report.swift"

# Xcode: DerivedData/<이름-해시>/info.plist 의 WorkspacePath 가 이 저장소 안인 것만
mv "$repo/.build" "$TMP/spm-build"
store="$TMP/spm-build/$(cd "$TMP/spm-build" && find . -path '*/debug/index/store' -type d | sed -n '1s|^\./||p')"
# $1 DerivedData 폴더 · $2 WorkspacePath · $3 그 폴더의 인덱스
plist() {
    mkdir -p "$1/Index.noindex"
    ln -s "$3" "$1/Index.noindex/DataStore"
    cat > "$1/info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>WorkspacePath</key>
    <string>$2</string>
</dict>
</plist>
EOF
}
dd="$TMP/DerivedData"
mkdir -p "$TMP/other-store"
plist "$dd/Shapes-abcdefghijklmnop" "$repo/Shapes.xcworkspace" "$store"
plist "$dd/Other-qrstuvwxyzabcdef" "$TMP/other/Other.xcworkspace" "$TMP/other-store"
run --repo "$repo" --derived-data "$dd" --verbose
if [[ $rc == 0 ]] && out=$(same_pairs) && [[ "$(grep -c '인덱스: ' "$TMP/err")" == 1 ]] && grep -q 'Shapes-abcdefghijklmnop/Index.noindex/DataStore$' "$TMP/err"
then ok "DerivedData: WorkspacePath 가 저장소 안인 폴더만"; else bad "DerivedData (종료 코드 $rc)" "$out$(cat "$TMP/err")"; fi

# Xcode 가 쓰는 중이면 덜 써진 유닛이 있다: 건너뛰고 경고, 하나도 못 읽으면 그 까닭으로 실패
cp -R "$store" "$TMP/cut-store"
: > "$(find "$TMP/cut-store" -path '*/units/main.swift.o-*' | head -1)"
run --repo "$repo" --store "$TMP/cut-store"
if [[ $rc == 0 ]] && grep -q '경고: 인덱스 1곳을 읽지 못해' "$TMP/err" && [[ -s "$TMP/out" ]] && ! grep -q '^Sources/App/main.swift' "$TMP/out"
then ok "덜 써진 유닛은 건너뛰고 경고"; else bad "덜 써진 유닛 (종료 코드 $rc)" "$(cat "$TMP/err" "$TMP/out")"; fi
find "$TMP/cut-store" -path '*/units/*' -type f -exec sh -c ': > "$1"' _ {} \;
run --repo "$repo" --store "$TMP/cut-store"
if [[ $rc == 1 ]] && [[ "$(head -1 "$TMP/err")" == *"읽지 못했습니다"* ]]; then ok "하나도 못 읽으면 종료 코드 1 + 까닭"; else bad "모두 덜 써짐 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi

mkdir -p "$repo/DerivedData/Index.noindex"
ln -s "$store" "$repo/DerivedData/Index.noindex/DataStore"
run --repo "$repo" --derived-data "$nodd"
if [[ $rc == 0 ]] && out=$(same_pairs); then ok "저장소 안 DerivedData(xcodebuild -derivedDataPath)"; else bad "저장소 안 DerivedData (종료 코드 $rc)" "$out"; fi
rm -rf "$repo/DerivedData"

mkdir -p "$repo/.build/index-build/arm64-apple-macosx/debug/index"
ln -s "$store" "$repo/.build/index-build/arm64-apple-macosx/debug/index/store"
run --repo "$repo" --derived-data "$nodd"
if [[ $rc == 0 ]] && out=$(same_pairs); then ok "SourceKit-LSP 의 .build/index-build"; else bad "SourceKit-LSP 인덱스 (종료 코드 $rc)" "$out"; fi
rm -rf "$repo/.build"

run --repo "$repo" --derived-data "$nodd"
if [[ $rc == 3 ]] && grep -q '인덱스가 없습니다' "$TMP/err" && [[ ! -s "$TMP/out" ]]; then ok "인덱스가 없으면 종료 코드 3"; else bad "인덱스 없음 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi

mkdir -p "$TMP/empty-store"
run --repo "$repo" --store "$TMP/empty-store"
if [[ $rc == 3 ]]; then ok "저장소 파일이 없는 인덱스도 종료 코드 3"; else bad "빈 인덱스 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi

run --repo "$repo" --store "$TMP/missing-store"
if [[ $rc != 0 && $rc != 3 ]] && [[ "$(head -1 "$TMP/err")" == *missing-store* ]]; then ok "열 수 없는 인덱스는 다른 종료 코드 + 표준오류 첫 줄에 까닭"
else bad "열 수 없는 인덱스 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi

mkdir -p "$TMP/not-a-repo"
run --repo "$TMP/not-a-repo"
if [[ $rc != 0 && $rc != 3 ]] && grep -q 'git' "$TMP/err"; then ok "git 저장소가 아니면 실패"; else bad "git 저장소 아님 (종료 코드 $rc)" "$(cat "$TMP/err")"; fi

echo "통과 $passed · 실패 $failed"
[[ $failed == 0 ]]
