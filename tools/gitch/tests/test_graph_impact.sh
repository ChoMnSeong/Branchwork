# shellcheck shell=bash
test_graph_cache_content_and_index() {
  gr_repo "$T/cache"
  echo 'import "./b";' | gr_put a.ts
  echo 'export const b=1;' | gr_put b.ts
  gr_commit
  gr_json files
  assert_eq "$(gr_q '.stats.cache.hit')" false
  gr_json files
  assert_eq "$(gr_q '.stats.cache.hit')" true
  echo 'import "./missing";' > a.ts
  gr_json files
  assert_eq "$(gr_q '.stats.cache.hit')" false
  gr_no_edge a.ts b.ts
  gr_json files
  assert_eq "$(gr_q '.stats.cache.hit')" true
  gr_json files --no-cache
  assert_eq "$(gr_q '.stats.cache // null')" null
}
test_graph_affected_deleted_and_transitive() {
  gr_repo "$T/impact"
  echo 'import "./b";' | gr_put a.ts
  echo 'import "./c";' | gr_put b.ts
  echo 'export const c=1;' | gr_put c.ts
  echo 'export const untouched=1;' | gr_put other.ts
  echo '{"name":"app"}' | gr_put package.json
  gr_commit
  rm c.ts
  gr_json affected --base HEAD
  assert_eq "$(gr_q '.stats.affected.files|join(",")')" a.ts,b.ts,c.ts
  assert_eq "$(gr_q '.stats.affected.modules|join(",")')" npm:app
  assert_eq "$(gr_q '.nodes[]|select(.id=="a.ts")|.affected')" true
  assert_eq "$(gr_q '.nodes[]|select(.id=="other.ts")|.affected//false')" false
}

test_graph_cache_does_not_trust_assume_unchanged_or_timestamps() {
  gr_repo "$T/cache-bytes"
  echo 'import "./b";' | gr_put a.ts
  echo 'export const b=1;' | gr_put b.ts
  echo 'export const c=1;' | gr_put c.ts
  gr_commit
  gr_json files; gr_edge a.ts b.ts
  cp -p a.ts "$T/original.ts"
  git update-index --assume-unchanged a.ts
  echo 'import "./c";' > a.ts
  touch -r "$T/original.ts" a.ts
  gr_json files
  assert_eq "$(gr_q '.stats.cache.hit')" false
  gr_edge a.ts c.ts; gr_no_edge a.ts b.ts
  gr_json files; assert_eq "$(gr_q '.stats.cache.hit')" true
  git update-index --no-assume-unchanged a.ts
  git add a.ts
  gr_json files; assert_eq "$(gr_q '.stats.cache.hit')" false
  gr_edge a.ts c.ts
}

test_graph_affected_staged_delete_restores_visible_base_edges() {
  gr_repo "$T/impact-delete"
  echo 'import "./b";' | gr_put a.ts
  echo 'import "./c";' | gr_put b.ts
  echo 'export const c=1;' | gr_put c.ts
  gr_commit
  git rm -q c.ts
  gr_json affected --base HEAD
  gr_node c.ts; gr_attr c.ts .deleted true; gr_attr c.ts .changed true
  gr_edge b.ts c.ts
  assert_eq "$(gr_q '.edges[]|select(.source=="b.ts" and .target=="c.ts")|.impactFromBase')" true
  assert_eq "$(gr_q '.edges[]|select(.source=="b.ts" and .target=="c.ts")|.baseCommit|length')" 40
  assert_eq "$(gr_q '.stats.affected.files|join(",")')" a.ts,b.ts,c.ts
}

test_graph_affected_new_staged_untracked_and_unknown_files() {
  gr_repo "$T/impact-new"
  echo 'import "./new";' | gr_put a.ts
  echo 'export const old=1;' | gr_put old.ts
  gr_commit
  echo 'import "./old";' | gr_put new.ts
  echo 'export const pending=1;' | gr_put staged.ts
  git add staged.ts
  echo 'opaque' | gr_put payload.unrecognized
  gr_json affected --base HEAD
  gr_edge a.ts new.ts
  gr_attr new.ts .untracked true
  gr_attr new.ts .changed true
  gr_attr staged.ts .changed true
  gr_attr payload.unrecognized .analysis unresolved
  assert_eq "$(gr_q '.stats.affected.files|join(",")')" a.ts,new.ts,payload.unrecognized,staged.ts
  assert_eq "$(gr_q '.stats.affected.unresolvedFiles|join(",")')" payload.unrecognized
  gr_json files
  gr_no_node new.ts
  gr_no_node payload.unrecognized
}

test_graph_affected_rename_and_cycles_terminate() {
  gr_repo "$T/impact-rename"
  echo 'import "./b";' | gr_put a.ts
  echo 'import "./a";' | gr_put b.ts
  gr_commit
  git mv b.ts moved.ts
  gr_json affected --base HEAD
  assert_eq "$(gr_q '.stats.affected.changedFiles|join(",")')" b.ts,moved.ts
  assert_eq "$(gr_q '.stats.affected.files|join(",")')" a.ts,b.ts,moved.ts
  gr_attr b.ts .deleted true
  gr_attr moved.ts .changed true
  gr_edge a.ts b.ts
  gr_edge moved.ts a.ts
}

test_graph_affected_nearest_workspace_modules_and_dependents() {
  gr_repo "$T/impact-workspace"
  echo '{"name":"root","workspaces":["packages/*"]}' | gr_put package.json
  echo '{"name":"a"}' | gr_put packages/a/package.json
  echo '{"name":"b","dependencies":{"a":"workspace:*"}}' | gr_put packages/b/package.json
  echo 'export const value=1;' | gr_put packages/a/core.ts
  echo 'export const independent=1;' | gr_put packages/b/main.ts
  gr_commit
  echo 'export const value=2;' > packages/a/core.ts
  gr_json affected --base HEAD
  assert_eq "$(gr_q '.stats.affected.modules|join(",")')" npm:a,npm:b
  assert_eq "$(gr_q '.stats.affected.files|join(",")')" packages/a/core.ts
}

test_graph_affected_deleted_manifest_uses_base_module_name() {
  gr_repo "$T/impact-manifest"
  echo '{"name":"root","workspaces":["packages/*"]}' | gr_put package.json
  echo '{"name":"actual-name"}' | gr_put packages/a/package.json
  echo 'export const value=1;' | gr_put packages/a/core.ts
  gr_commit
  git rm -q packages/a/package.json
  gr_json affected --base HEAD
  assert_eq "$(gr_q '.stats.affected.modules|join(",")')" npm:actual-name
  gr_attr packages/a/package.json .deleted true
  run gitch graph affected --base HEAD --format html --out "$T/impact-manifest.html" --no-open
  assert_ok
  [ -s "$T/impact-manifest.html" ] || fail '삭제 모듈을 담은 HTML 없음'
}

test_graph_inventory_never_splits_unsafe_filenames_or_reads_symlinks() {
  gr_repo "$T/impact space ' quote"
  echo 'export const safe=1;' | gr_put safe.ts
  echo 'import "outside-sentinel";' > "$T/outside.ts"
  ln -s "$T/outside.ts" linked.ts
  echo 'import "outside-sentinel";' | gr_put $'directory\n../outside.ts'
  echo 'export const bad=1;' | gr_put $'bad\tname.ts'
  gr_commit
  gr_json files
  gr_no_node linked.ts
  gr_no_node ../outside.ts
  gr_no_node pkg:npm/outside-sentinel
  assert_eq "$(gr_q '.stats.ignoredPaths')" 3
  assert_eq "$(gr_q '.stats.ignoredSymlinkPaths')" 1
  assert_eq "$(gr_q '[.diagnostics[]|select(.code=="UNSUPPORTED_PATH")]|length')" 1
  gr_json files --no-cache
  gr_no_node pkg:npm/outside-sentinel
  assert_eq "$(gr_q '.stats.ignoredPaths')" 3
  gr_json tree --files
  gr_no_node linked.ts
  gr_no_node ../outside.ts
  gr_attr safe.ts .bytes "$(wc -c < safe.ts | tr -d ' ')"
  assert_eq "$(gr_q '.stats.files')" 1
  assert_eq "$(gr_q '.stats.ignoredPaths')" 3
  echo 'export const safe=2;' > safe.ts
  gr_json affected --base HEAD
  gr_no_node pkg:npm/outside-sentinel
  gr_no_node ../outside.ts
  gr_attr safe.ts .changed true
}

test_graph_affected_preserves_spaces_quotes_and_backslash_names() {
  gr_repo "$T/impact-names"
  echo 'export const base=1;' | gr_put base.ts
  gr_commit
  local unusual='space quote '\''" $literal\name.ts'
  echo 'export const untracked=1;' | gr_put "$unusual"
  gr_json affected --base HEAD
  gr_node "$unusual"
  gr_attr "$unusual" .changed true
  gr_attr "$unusual" .untracked true
  assert_eq "$(gr_q '.stats.affected.changedFiles[0]')" "$unusual"
}

test_graph_affected_does_not_include_its_own_output() {
  gr_repo "$T/impact-output"
  echo 'export const base=1;' | gr_put base.ts
  gr_commit
  echo 'export const base=2;' > base.ts
  run gitch graph affected --base HEAD --json --out "$PWD/report.json" --no-open
  assert_ok
  run gitch graph affected --base HEAD --json --out "$PWD/report.json" --no-open
  assert_ok
  OUT=$(cat report.json)
  assert_json "$OUT"
  assert_eq "$(gr_q '.stats.affected.changedFiles|join(",")')" base.ts
  gr_no_node report.json
}
