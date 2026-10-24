# shellcheck shell=bash
# Support claims and source evidence must remain truthful.
test_graph_evidence_and_unresolved() {
  gr_repo "$T/evidence"
  printf '\nimport { b } from "./b";\nimport "./missing";\n' | gr_put a.ts
  echo 'export const b = 1' | gr_put b.ts
  echo 'class Widget {}' | gr_put Widget.cs
  gr_commit
  gr_json --json
  assert_eq "$(gr_q '.schemaVersion')" 1
  assert_eq "$(gr_q '.nodes[] | select(.id == "Widget.cs") | .analysis')" file-detection
  assert_eq "$(gr_q '.edges[] | select(.target == "b.ts") | .evidence[0].line')" 2
  assert_eq "$(gr_q '.edges[] | select(.target == "b.ts") | .method')" static-import
  assert_eq "$(gr_q '.diagnostics[0].file + ":" + (.diagnostics[0].line|tostring)')" a.ts:3
  assert_eq "$(gr_q '.diagnostics[0].code')" UNRESOLVED_IMPORT
}
test_graph_evidence_heuristic_lines() {
  gr_repo "$T/evidence-swift"
  printf 'struct A {\n let value: B\n}\n' | gr_put A.swift
  echo 'struct B {}' | gr_put B.swift
  gr_commit
  gr_json files
  assert_eq "$(gr_q '.edges[] | select(.target == "B.swift") | .evidence[0].line')" 2
  assert_eq "$(gr_q '.edges[] | select(.target == "B.swift") | .confidence')" heuristic
}
test_graph_json_file_output_keeps_stdout_machine_readable() {
  gr_repo "$T/evidence-output"
  echo 'import "./b";' | gr_put a.ts
  echo 'export const b = 1' | gr_put b.ts
  gr_commit
  gr_json files --json --out "$T/files.json"
  assert_eq "$(gr_q '.tool')" 'gitch graph'
  assert_eq "$(jq -r .schemaVersion "$T/files.json")" 1
  gr_json diff --base HEAD --json --out "$T/diff.json"
  assert_eq "$(gr_q '.diff.head')" worktree
  mkdir -p .gitch
  printf '[files]\nforbid a.ts -> b.ts\n' > .gitch/graph.rules
  run gitch g check --json --out "$T/check.json"
  assert_rc 1
  assert_json "$OUT"
  assert_eq "$(gr_q '.ok')" false
}
