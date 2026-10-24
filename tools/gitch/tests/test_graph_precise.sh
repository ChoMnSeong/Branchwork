# shellcheck shell=bash
test_graph_precise_imports_and_symbols() {
  gr_repo "$T/scip"
  python3 "$ROOT/tests/scip_fixtures.py" "$PWD" || fail 'SCIP fixture'
  gr_commit
  gr_json files --precise
  gr_edge ts/client.ts ts/engine.ts reference
  gr_edge python/client.py python/engine.py reference
  gr_edge java/Client.java java/Engine.java reference
  gr_no_edge ts/client.ts ts/unrelated.ts
  assert_eq "$(gr_q '.nodes[] | select(.id=="java/Client.java") | .analysis')" compiler-index
  assert_eq "$(gr_q '[.edges[] | select(.source=="java/Client.java" and .kind=="type-ref")]|length')" 0
  assert_eq "$(gr_q '.edges[] | select(.source=="java/Client.java" and .kind=="reference") | .evidence[0].line')" 2
  gr_json files --index "$PWD/index.scip" --lang ts
  assert_eq "$(gr_q '[.edges[] | select(.kind=="reference" and (.source|startswith("ts/")|not))]|length')" 0
  echo '// stale' >> ts/client.ts
  gr_json files --index "$PWD/index.scip"
  assert_eq "$(gr_q '[.edges[] | select(.source=="ts/client.ts" and .kind=="reference")]|length')" 0
  assert_eq "$(gr_q '[.diagnostics[]|select(.code=="scip-stale-document")]|length')" 1
}

test_graph_precise_errors_are_one_json_diagnostic() {
  gr_repo "$T/scip-error"
  echo 'const x = 1;' | gr_put a.ts
  echo 'corrupt-index' > index.scip
  gr_commit
  gitch g --index index.scip --json > "$T/stdout" 2> "$T/stderr"; local rc=$?
  assert_eq "$rc" 1
  [ ! -s "$T/stdout" ] || fail 'invalid index polluted stdout'
  jq -e '.schemaVersion == 1 and .error.code == "GITCH_ERROR"' "$T/stderr" >/dev/null || fail 'error stream is not one JSON object'
}
test_graph_precise_requires_supported_python_without_polluting_stdout() {
  gr_repo "$T/scip-runtime"
  echo 'const x = 1;' | gr_put a.ts
  echo '{}' > index.scip
  gr_commit
  local name rc
  for name in python3 python; do
    printf '#!/bin/sh\nexit 1\n' > "$T/fakebin/$name"
    chmod +x "$T/fakebin/$name"
  done
  gitch g --precise --json > "$T/stdout" 2> "$T/stderr"; rc=$?
  assert_eq "$rc" 1
  [ ! -s "$T/stdout" ] || fail 'unsupported runtime polluted stdout'
  jq -se 'length == 1 and .[0].schemaVersion == 1 and (.[0].error.message | contains("Python 3.8"))' "$T/stderr" >/dev/null || fail 'runtime error is not a single structured diagnostic'
}
