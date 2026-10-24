# shellcheck shell=bash
# 변경 이력은 현재 추적 파일의 정체성을 유지하고, 근거/한계를 함께 보고해야 한다.

ghist_repo() {
  mkdir -p "$1" && cd "$1" || fail "cd $1"
  git init -q .
  git config user.name history && git config user.email history@example.com
}
ghist_commit() {
  git add -A && GIT_COMMITTER_DATE="$1" git commit -q -m "$2" || fail "이력 fixture 커밋 실패"
}
ghist_json() {
  run gitch graph changes --json "$@"
  assert_ok "changes $*"
  assert_json "$OUT"
}
ghist_q() { printf '%s' "$OUT" | jq -r "$1"; }
ghist_expect() { assert_eq "$(ghist_q "$1")" "$2" "history: $1"; }

ghist_renames() {
  ghist_repo "$T/history"
  mkdir -p legacy src
  printf 'line one\nline two\nline three\n' > 'legacy/old name.ts'
  echo helper > 'src/helper file.ts'
  ghist_commit '2020-01-01T00:00:00+00:00' initial
  echo before >> 'legacy/old name.ts'; echo before >> 'src/helper file.ts'
  ghist_commit '2020-01-02T00:00:00+00:00' 'before "rename"'
  git mv 'legacy/old name.ts' 'src/new name.ts'
  ghist_commit '2020-01-03T00:00:00+00:00' rename
  echo after >> 'src/new name.ts'; echo after >> 'src/helper file.ts'
  ghist_commit '2020-01-04T00:00:00+00:00' after
}

test_graph_history_follows_renames_with_spaces_and_scope() {
  ghist_renames
  ghist_json src --min 1
  ghist_expect '.nodes | length' 2
  ghist_expect '.nodes[] | select(.id == "src/new name.ts") | .changes' 4
  ghist_expect '.nodes[] | select(.id == "src/helper file.ts") | .changes' 3
  ghist_expect '.edges[0].weight' 3
  ghist_expect '.edges[0].commitCount' 3
  ghist_expect '.edges[0].method' git-history
  ghist_expect '.edges[0].commits | length' 3
  ghist_expect '.edges[0].commits[1].subject' 'before "rename"'
  ghist_expect '.edges[0].commits[1].date | sub("\\+00:00$"; "Z")' '2020-01-02T00:00:00Z'
  ghist_expect '.edges[0].commits | all(.sha | test("^[0-9a-f]{40,64}$"))' true
  ghist_expect '.stats.followedRenames' 1
  ghist_expect '.stats.historyFrom | sub("\\+00:00$"; "Z")' '2020-01-01T00:00:00Z'
  ghist_expect '.stats.historyTo | sub("\\+00:00$"; "Z")' '2020-01-04T00:00:00Z'
  ghist_expect '.stats.analyzedFrom | sub("\\+00:00$"; "Z")' '2020-01-01T00:00:00Z'
  ghist_expect '.stats.historyTruncated' false
  ghist_expect '.stats.shallowHistory' false
  ghist_json src --since 2020-01-02T12:00:00+00:00 --min 1
  ghist_expect '.stats.commits' 2
  ghist_expect '.edges[0].weight' 1
}

test_graph_history_commit_limit_reports_actual_truncation() {
  ghist_renames
  ghist_json --max-commits 2 --min 1
  ghist_expect '.stats.commits' 2
  ghist_expect '.stats.historyTruncated' true
  ghist_expect '.stats.historyFrom | sub("\\+00:00$"; "Z")' '2020-01-03T00:00:00Z'
  ghist_expect '.stats.historyTo | sub("\\+00:00$"; "Z")' '2020-01-04T00:00:00Z'
  ghist_expect '.edges[0].weight' 1
  ghist_expect '.edges[0].commits | length' 1
  ghist_expect '.nodes[] | select(.id == "src/new name.ts") | .changes' 2
  ghist_json --max-commits 4 --min 1
  ghist_expect '.stats.commits' 4
  ghist_expect '.stats.historyTruncated' false
}

test_graph_history_large_rename_preserves_older_lineage() {
  ghist_repo "$T/history-large"
  mkdir -p src
  printf 'line one\nline two\nline three\n' > 'old name.ts'
  echo helper > 'src/helper file.ts'; echo third > src/third.ts
  ghist_commit '2020-01-01T00:00:00+00:00' initial
  echo before >> 'old name.ts'; echo before >> 'src/helper file.ts'
  ghist_commit '2020-01-02T00:00:00+00:00' before
  git mv 'old name.ts' 'src/new name.ts'
  echo broad >> 'src/helper file.ts'; echo broad >> src/third.ts
  ghist_commit '2020-01-03T00:00:00+00:00' 'large rename'
  echo after >> 'src/new name.ts'; echo after >> 'src/helper file.ts'
  ghist_commit '2020-01-04T00:00:00+00:00' after
  ghist_json src --max-files 2 --min 1
  ghist_expect '.stats.skippedLargeCommits' 2
  ghist_expect '.stats.analyzedCommits' 2
  ghist_expect '.stats.followedRenames' 1
  ghist_expect '.edges[0].weight' 2
  ghist_expect '.edges[0].commits | map(.subject) | join(",")' after,before
  ghist_expect '.stats.analyzedFrom | sub("\\+00:00$"; "Z")' '2020-01-02T00:00:00Z'
}

test_graph_history_recreated_paths_do_not_inherit_deleted_file() {
  ghist_repo "$T/history-recreated"
  echo old > a.ts; echo helper > b.ts
  ghist_commit '2020-01-01T00:00:00+00:00' initial
  git rm -q a.ts
  ghist_commit '2020-01-02T00:00:00+00:00' delete
  echo unrelated > a.ts; echo recreated >> b.ts
  ghist_commit '2020-01-03T00:00:00+00:00' recreate
  ghist_json --min 1
  ghist_expect '.edges[0].weight' 1
  ghist_expect '.edges[0].commits[0].subject' recreate
  ghist_expect '.nodes[] | select(.id == "a.ts") | .changes' 1
  ghist_expect '.nodes[] | select(.id == "b.ts") | .changes' 2
  ghist_expect '.stats.analyzedCommits' 2
}

test_graph_history_reverts_remain_observed_changes() {
  ghist_repo "$T/history-revert"
  echo initial > a.ts; echo initial > b.ts
  ghist_commit '2020-01-01T00:00:00+00:00' initial
  echo feature >> a.ts; echo feature >> b.ts
  ghist_commit '2020-01-02T00:00:00+00:00' feature
  GIT_COMMITTER_DATE='2020-01-03T00:00:00+00:00' git revert --no-edit HEAD >/dev/null || fail 'revert fixture'
  ghist_json --min 1
  ghist_expect '.edges[0].weight' 3
  ghist_expect '.edges[0].commits[0].subject' 'Revert "feature"'
  ghist_expect '.nodes | all(.changes == 3)' true
}

test_graph_history_provenance_is_bounded_without_losing_counts() {
  ghist_repo "$T/history-bounded"
  local i
  for i in {1..23}; do
    echo "$i" >> a.ts; echo "$i" >> b.ts
    ghist_commit "2020-01-$(printf '%02d' "$i")T00:00:00+00:00" "change $i"
  done
  ghist_json --min 1
  ghist_expect '.edges[0].weight' 23
  ghist_expect '.edges[0].commitCount' 23
  ghist_expect '.edges[0].commits | length' 20
  ghist_expect '.edges[0].commitsTruncated' true
  ghist_expect '.edges[0].commits[0].subject' 'change 23'
  ghist_expect '.edges[0].commits[19].subject' 'change 4'
  ghist_expect '.stats.provenanceLimit' 20
}

test_graph_history_shallow_clone_reports_local_history_limit() {
  ghist_repo "$T/history-source"
  echo initial > a.ts; echo initial > b.ts
  ghist_commit '2020-01-01T00:00:00+00:00' initial
  echo changed >> a.ts; echo changed >> b.ts
  ghist_commit '2020-01-02T00:00:00+00:00' changed
  git clone -q --depth 1 "file://$T/history-source" "$T/history-shallow" || fail 'shallow fixture clone'
  cd "$T/history-shallow" || fail 'shallow fixture cd'
  ghist_json --max-commits 1 --min 1
  ghist_expect '.stats.commits' 1
  ghist_expect '.stats.historyTruncated' false
  ghist_expect '.stats.shallowHistory' true
  ghist_expect '.edges[0].weight' 1
}
