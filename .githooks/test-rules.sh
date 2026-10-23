#!/bin/sh
# rules.sh 를 시험한다(맥 BSD 도구와 리눅스 GNU 도구에서 같은 결과인지 CI 에서도 돌린다).
# sh .githooks/test-rules.sh
set -u
here=$(dirname "$0")
tmp=$(mktemp)
bad=0

# $1 = pass|fail, $2 = 메시지(printf 형식)
expect() {
  printf "$2" >"$tmp"
  if sh "$here/rules.sh" message "$tmp" 2>/dev/null; then got=pass; else got=fail; fi
  if [ "$got" != "$1" ]; then
    printf 'expected %s, got %s: %s\n' "$1" "$got" "$(head -1 "$tmp")" >&2
    bad=1
  fi
}

expect pass 'Windows: Split sources into Feature-Sliced Design layers\n\n- Body — with “quotes”, café and → arrows\n\nCo-Authored-By: 조문성 <x@example.com>\n'
expect pass 'Graph: Show avatars in the inspector\n'
expect pass 'Fix the narrow graph layout\n'
expect pass 'Windows: Translate `탐색기에서 보기` label\n'
expect pass 'Release 0.3.5 (line staging, side-by-side diff, conflict resolution, interactive rebase, undo, PR review, blame)\n'
expect pass 'README: Link https://example.com\n'
expect pass 'Merge branch '"'"'feature/x'"'"'\n'
expect pass '\n\nGraph: Leading blank lines are ignored\n# comment\n'
expect fail 'Windows: 탐색기에서 보기\n'
expect fail 'Graph: Fix colors\n\n- 한국어 본문\n'
expect fail 'グラフ: 修正\n'
expect fail 'Graph: Added avatars\n'
expect fail 'Fixes the crash\n'
expect fail 'wip\n'
expect fail 'fixup! Graph: Show avatars\n'
expect fail 'Windows:Typo\n'
expect fail 'Graph: End with a period.\n'
expect fail 'Graph: No blank line\nbody\n'
expect fail '# only a comment\n'
expect fail "A: $(printf '%098d' 0 | tr 0 a)\n"
expect pass "A: $(printf '%097d' 0 | tr 0 a)\n"

rm -f "$tmp"
[ $bad -eq 0 ] && echo "rules.sh: all checks behave as expected"
exit $bad
