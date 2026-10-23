#!/bin/bash
# gitch 테스트 실행기
#   실제 ~/.gitconfig, ~/.ssh, ~/.claude 는 건드리지 않습니다 (테스트마다 임시 HOME + 가짜 ssh/gh/원격 저장소).
#   사용: tests/run.sh [-k 이름일부] [테스트파일...]
HERE=$(cd "$(dirname "$0")" && pwd -P)
ROOT=$(cd "$HERE/.." && pwd -P)
GITSW_SRC="${GITSW_SRC:-$ROOT/gitch}"
TMP_BASE="${GITSW_TEST_TMP:-${TMPDIR:-/tmp}}"
TMP_BASE=${TMP_BASE%/}
ORIG_PATH="$PATH"
export GITSW_SRC ROOT TMP_BASE ORIG_PATH

FILTER=""; files=()
while [ $# -gt 0 ]; do
  case "$1" in -k) shift; FILTER="$1" ;; *) files+=("$1") ;; esac
  shift
done
[ ${#files[@]} -eq 0 ] && files=("$HERE"/test_*.sh)

# shellcheck source=tests/lib.sh
. "$HERE/lib.sh"
for f in "${files[@]}"; do
  # shellcheck disable=SC1090
  . "$f"
done

pass=0; fail=0; failed=()
start=$(date +%s)
for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  if [ -n "$FILTER" ]; then case "$t" in *"$FILTER"*) ;; *) continue ;; esac; fi
  out=$( (t_setup && "$t") 2>&1 ); rc=$?
  if [ $rc -eq 0 ]; then
    pass=$((pass+1)); printf '  ✔ %s\n' "$t"
  else
    fail=$((fail+1)); failed+=("$t")
    printf '  ✘ %s\n' "$t"
    printf '%s\n' "$out" | tail -30 | sed 's/^/      /'
  fi
done
echo ""
echo "통과 $pass / 실패 $fail  ($(( $(date +%s) - start ))초)"
[ $fail -eq 0 ] || { printf '실패: %s\n' "${failed[*]}"; exit 1; }
