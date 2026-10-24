# shellcheck shell=bash
# gitch graph — 구조 그래프 (files · modules · changes · tree / json · html · dot · svg · png)

gr_repo() {   # $1 폴더 — 빈 저장소를 만들고 들어간다 (커밋 작성자는 임시 값)
  mkdir -p "$1" && cd "$1" || fail "cd $1"
  git init -q .
  git config user.name t && git config user.email t@example.com
}
gr_put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }   # $1 경로, 내용은 표준입력
gr_commit() { git add -A && git commit -q -m "${1:-c}" || fail "커밋 실패"; }
gr_json() { run gitch graph "$@"; assert_ok "gitch graph $*"; assert_json "$OUT" "gitch graph $* 출력이 JSON 이 아님"; }
gr_q() { printf '%s' "$OUT" | jq -r "$1"; }
gr_edge() {   # $1 시작 $2 끝 [$3 종류] — 마지막 JSON(OUT)에 그 연결이 있어야
  printf '%s' "$OUT" | jq -e --arg s "$1" --arg t "$2" --arg k "${3:-}" \
    '.edges | any(.source == $s and .target == $t and ($k == "" or .kind == $k))' >/dev/null \
    || fail "연결 없음: $1 → $2 ${3:+($3)}\n--- 연결:\n$(gr_q '.edges[] | "\(.source) → \(.target) (\(.kind))"')"
}
gr_no_edge() {
  printf '%s' "$OUT" | jq -e --arg s "$1" --arg t "$2" '.edges | any(.source == $s and .target == $t) | not' >/dev/null \
    || fail "있으면 안 되는 연결: $1 → $2"
}
gr_node() { printf '%s' "$OUT" | jq -e --arg n "$1" '.nodes | any(.id == $n)' >/dev/null || fail "노드 없음: $1\n--- 노드:\n$(gr_q '.nodes[].id')"; }
gr_no_node() { printf '%s' "$OUT" | jq -e --arg n "$1" '.nodes | any(.id == $n) | not' >/dev/null || fail "있으면 안 되는 노드: $1"; }
gr_attr() {   # $1 노드 $2 jq 식(노드 기준) $3 기대값
  local v; v=$(printf '%s' "$OUT" | jq -r --arg n "$1" ".nodes[] | select(.id == \$n) | $2")
  assert_eq "$v" "$3" "$1 의 $2"
}

test_graph_files_typescript() {
  gr_repo "$T/ts"
  gr_put tsconfig.json <<'EOF'
{
  // 주석이 있는 tsconfig
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } }
}
EOF
  gr_put src/a.ts <<'EOF'
import { b } from "./b";
import type { C } from '../lib';
import {
  d1,
  d2,
} from "./d";
export * from "./e.js";
import React from "react";
import sub from "@scope/pkg/sub";
import alias from "@/util/alias";
import "./side";
import u from "./untracked";
const lazy = () => import("./lazy");
const r = require("./req");
const s = "import x from './not-a-dep'";
// import z from "./commented";
/*
import y from "./commented";
*/
EOF
  echo 'export const b = 1' | gr_put src/b.ts
  echo 'export type C = 1' | gr_put lib/index.ts
  echo 'export const d1 = 1, d2 = 2' | gr_put src/d.tsx
  echo 'export const e = 1' | gr_put src/e.ts
  echo 'export default 1' | gr_put src/util/alias.ts
  echo 'export default 1' | gr_put src/lazy.tsx
  echo 'module.exports = 1' | gr_put src/req.js
  echo 'console.log(1)' | gr_put src/side.mjs
  echo 'export default 1' | gr_put src/not-a-dep.ts
  echo 'export default 1' | gr_put src/commented.ts
  gr_commit
  echo 'export default 1' > src/untracked.ts            # 추적하지 않는 파일은 보지 않는다
  gr_json
  assert_eq "$(gr_q '.tool + " " + .relation + " " + (.directed | tostring)')" "gitch graph files true"
  gr_edge src/a.ts src/b.ts import
  gr_edge src/a.ts lib/index.ts import
  gr_edge src/a.ts src/d.tsx import
  gr_edge src/a.ts src/e.ts reexport
  gr_edge src/a.ts pkg:npm/react import
  gr_edge src/a.ts pkg:npm/@scope/pkg import
  gr_edge src/a.ts src/util/alias.ts import
  gr_edge src/a.ts src/side.mjs import
  gr_edge src/a.ts src/lazy.tsx dynamic-import
  gr_edge src/a.ts src/req.js require
  gr_no_edge src/a.ts src/not-a-dep.ts
  gr_no_edge src/a.ts src/commented.ts
  gr_no_node src/untracked.ts
  gr_attr src/a.ts .lines 19
  gr_attr src/a.ts .group ts
  assert_eq "$(gr_q '.stats.unresolved')" "1" "찾지 못한 상대 경로 import"
  assert_eq "$(gr_q '.edges[] | select(.source == "src/a.ts" and .target == "src/util/alias.ts") | .via[0]')" "@/util/alias"
  gr_json --no-external
  gr_no_node pkg:npm/react
  gr_edge src/a.ts src/b.ts import
}

test_graph_files_python() {
  gr_repo "$T/py"
  : | gr_put pkg/__init__.py
  gr_put pkg/a.py <<'EOF'
"""설명 안의 글은 import 가 아니다
import fake_in_docstring
"""
import os
import pkg.b as bb
from . import c
from .sub import d
from .sub.e import thing
from pkg import f
from pkg.g import (
    x,
    y,
)
import numpy as np
EOF
  for f in b c f g sub/d sub/e; do echo 'x = 1' | gr_put "pkg/$f.py"; done
  : | gr_put pkg/sub/__init__.py
  echo 'from pkg.a import main' | gr_put scripts/run.py
  gr_commit
  gr_json files
  gr_edge pkg/a.py pkg/b.py import
  gr_edge pkg/a.py pkg/c.py import
  gr_edge pkg/a.py pkg/sub/d.py import
  gr_edge pkg/a.py pkg/sub/e.py import
  gr_edge pkg/a.py pkg/f.py import
  gr_edge pkg/a.py pkg/g.py import
  gr_edge pkg/a.py pkg:pypi/os import
  gr_edge pkg/a.py pkg:pypi/numpy import
  gr_edge scripts/run.py pkg/a.py import
  gr_no_node pkg:pypi/fake_in_docstring
  gr_no_node pkg:pypi/pkg
  gr_attr pkg/a.py .group python
}

test_graph_files_go() {
  gr_repo "$T/go"
  printf 'module example.com/app\n\ngo 1.22\n\nrequire github.com/spf13/cobra v1.8.0\n' | gr_put go.mod
  gr_put main.go <<'EOF'
package main

import (
	"fmt"

	"example.com/app/internal/store"
	cli "github.com/spf13/cobra/doc"
)

func main() { fmt.Println(store.X, cli.X) }
EOF
  printf 'package store\n\nimport "example.com/app/internal/util"\n\nvar X = util.Y\n' | gr_put internal/store/store.go
  printf 'package store\n\nimport "testing"\n' | gr_put internal/store/store_test.go
  printf 'package util\n\nvar Y = 1\n' | gr_put internal/util/util.go
  gr_commit
  gr_json
  gr_edge main.go internal/store/ import
  gr_edge internal/store/store.go internal/util/ import
  gr_edge main.go pkg:golang/fmt import
  gr_edge main.go pkg:golang/github.com/spf13/cobra import
  gr_edge internal/store/ internal/store/store.go contains
  gr_no_edge internal/store/ internal/store/store_test.go
  gr_attr internal/store/ .kind folder
  gr_attr internal/store/ .importPath example.com/app/internal/store
}

test_graph_files_rust() {
  gr_repo "$T/rs"
  printf '[package]\nname = "demo-app"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n' | gr_put Cargo.toml
  gr_put src/lib.rs <<'EOF'
pub mod net;
mod store;
#[cfg(test)]
mod tests;
use crate::store::Db;
use serde::Serialize;
EOF
  printf 'mod http;\npub struct Client;\nuse super::store::Db;\n' | gr_put src/net/mod.rs
  gr_put src/net/http.rs <<'EOF'
use crate::{
    store::Db,
    net::Client as C,
};
EOF
  printf 'pub struct Db;\nmod inner {\n    use super::Db;\n}\n' | gr_put src/store.rs
  printf 'use super::*;\n' | gr_put src/tests.rs
  printf 'use demo_app::store::Db;\n' | gr_put tests/it.rs
  gr_commit
  gr_json
  gr_edge src/lib.rs src/net/mod.rs mod
  gr_edge src/lib.rs src/store.rs mod
  gr_edge src/lib.rs src/tests.rs mod
  gr_edge src/lib.rs src/store.rs use
  gr_edge src/lib.rs pkg:cargo/serde use
  gr_edge src/net/mod.rs src/net/http.rs mod
  gr_edge src/net/mod.rs src/store.rs use
  gr_edge src/net/http.rs src/store.rs use
  gr_edge src/net/http.rs src/net/mod.rs use
  gr_edge src/tests.rs src/lib.rs use
  gr_edge tests/it.rs src/store.rs use
  gr_no_edge src/store.rs src/lib.rs                   # 인라인 mod 안의 super:: 는 그 파일 자신
  gr_no_node pkg:cargo/demo_app
}

test_graph_files_kotlin_java() {
  gr_repo "$T/jvm"
  gr_put app/src/main/kotlin/com/example/app/Main.kt <<'EOF'
package com.example.app

import com.example.core.Repo
import com.example.core.util.*
import kotlinx.coroutines.flow.Flow

fun main() {
    val r = Repo()
    Helper.run("Hidden in a string")
}
EOF
  printf 'package com.example.app\n\nobject Helper {\n    fun run(s: String) {}\n}\n' | gr_put app/src/main/kotlin/com/example/app/Helper.kt
  printf 'package com.example.core\n\nclass Repo\n\nprivate class Hidden\n' | gr_put core/src/main/kotlin/com/example/core/Repo.kt
  printf 'package com.example.core.util\n\nfun String.shout() = uppercase()\n' | gr_put core/src/main/kotlin/com/example/core/util/Strings.kt
  printf 'package com.example.core;\n\nimport java.util.List;\n\npublic class Legacy {\n    Repo repo;\n}\n' | gr_put core/src/main/java/com/example/core/Legacy.java
  gr_commit
  gr_json
  gr_edge app/src/main/kotlin/com/example/app/Main.kt core/src/main/kotlin/com/example/core/Repo.kt import
  gr_edge app/src/main/kotlin/com/example/app/Main.kt core/src/main/kotlin/com/example/core/util/Strings.kt import
  gr_edge app/src/main/kotlin/com/example/app/Main.kt pkg:maven/kotlinx.coroutines.flow import
  gr_edge app/src/main/kotlin/com/example/app/Main.kt app/src/main/kotlin/com/example/app/Helper.kt type-ref
  gr_edge core/src/main/java/com/example/core/Legacy.java core/src/main/kotlin/com/example/core/Repo.kt type-ref
  gr_edge core/src/main/java/com/example/core/Legacy.java pkg:maven/java.util import
  assert_eq "$(gr_q '[.edges[] | select(.kind == "type-ref") | .heuristic] | all')" "true" "같은 패키지 추정 연결은 heuristic"
  case "$(gr_q '.notes | join(" ")')" in *Kotlin/Java*) ;; *) fail "Kotlin/Java 추정 안내가 없음" ;; esac
}

test_graph_files_swift_heuristic() {
  gr_repo "$T/swift"
  gr_put Sources/Core/Model.swift <<'EOF'
import Foundation

public struct Model {}
private struct Secret {}
@MainActor final class Store {}
EOF
  gr_put Sources/Core/Helpers.swift <<'EOF'
/*
 Store 는 주석 안이라 세지 않는다
*/
let text = "Store in a string"
// Store in a comment
extension Model {}
EOF
  gr_put Sources/App/main.swift <<'EOF'
import Core
@testable import Foundation

let s = Store()
let x: Secret? = nil
let msg = """
Model in a multiline string
"""
EOF
  gr_commit
  gr_json
  gr_edge Sources/Core/Helpers.swift Sources/Core/Model.swift type-ref
  gr_edge Sources/App/main.swift Sources/Core/Model.swift type-ref
  assert_eq "$(gr_q '.edges[] | select(.source == "Sources/Core/Helpers.swift" and .kind == "type-ref") | .via | join(",")')" "Model" "주석 · 문자열 속 이름은 빼고"
  assert_eq "$(gr_q '.edges[] | select(.source == "Sources/App/main.swift" and .kind == "type-ref") | .via | join(",")')" "Store" "private 타입 · 여러 줄 문자열은 빼고"
  assert_eq "$(gr_q '.edges[] | select(.kind == "type-ref") | .heuristic' | sort -u)" "true"
  gr_edge Sources/App/main.swift module:Core import
  gr_edge Sources/App/main.swift module:Foundation import
  gr_attr module:Core .local Sources/Core
  [ "$(gr_q '.stats.heuristicEdges')" -ge 2 ] || fail "heuristicEdges 가 2 이상이어야"
  case "$(gr_q '.notes | join(" ")')" in *Swift*) ;; *) fail "Swift 추정 안내가 없음" ;; esac
}

gr_spm_fixture() {   # Package.swift + 타깃 폴더(실제 swift package describe 도 되게)
  gr_put Package.swift <<'EOF'
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Demo",
    products: [
        .library(name: "Core", targets: ["Core"]),
        .plugin(name: "Gen", targets: ["Gen"]),
    ],
    dependencies: [.package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0")],
    targets: [
        .target(name: "Core"),  // .target(name: "Fake") 는 주석
        .executableTarget(
            name: "App",
            dependencies: ["Core", .product(name: "ArgumentParser", package: "swift-argument-parser")]
        ),
        .testTarget(name: "CoreTests", dependencies: [.target(name: "Core")], path: "Tests/CoreTests"),
        .plugin(name: "Gen", capability: .buildTool()),
    ]
)
EOF
  echo 'public struct Core {}' | gr_put Sources/Core/Core.swift
  echo 'import Core' | gr_put Sources/App/main.swift
  echo 'import XCTest' | gr_put Tests/CoreTests/CoreTests.swift
  printf 'import PackagePlugin\n@main struct Gen: BuildToolPlugin {\n    func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] { [] }\n}\n' | gr_put Plugins/Gen/Gen.swift
}

gr_spm_check() {
  gr_edge swift:App swift:Core depends
  gr_edge swift:App pkg:swiftpm/ArgumentParser depends
  gr_edge swift:CoreTests swift:Core depends
  gr_node swift:Gen
  gr_no_node swift:Fake
  gr_attr swift:App .type executable
  gr_attr swift:CoreTests .path Tests/CoreTests
  gr_attr swift:Core .path Sources/Core
  assert_eq "$(gr_q '.edges[] | select(.source == "swift:App" and .target == "swift:Core") | .scope')" "target"
}

test_graph_modules_swiftpm_tuist() {
  gr_repo "$T/spm"
  gr_spm_fixture
  gr_put Projects/App/Project.swift <<'EOF'
import ProjectDescription

let project = Project(
    name: "App",
    targets: [
        .target(
            name: "App",
            destinations: .iOS,
            product: .app,
            bundleId: "com.example.app",
            dependencies: [
                .target(name: "AppUI"),
                .project(target: "Core", path: "../Core"),
                .external(name: "Alamofire"),
                .sdk(name: "StoreKit", type: .framework),
            ]
        ),
        .target(name: "AppUI", destinations: .iOS, product: .framework, bundleId: "com.example.ui"),
    ]
)
EOF
  gr_put Projects/Core/Project.swift <<'EOF'
import ProjectDescription
import ProjectDescriptionHelpers

let project = Project.module(name: "Core", dependencies: [.external(name: "Logging")])
EOF
  gr_commit
  GITSW_SWIFT_DESCRIBE=0 gr_json modules
  gr_spm_check
  gr_edge tuist:App tuist:AppUI depends
  gr_edge tuist:App tuist:Core depends
  gr_edge tuist:App pkg:swiftpm/Alamofire depends
  gr_edge tuist:App pkg:sdk/StoreKit depends
  gr_edge tuist:Core pkg:swiftpm/Logging depends
  gr_attr tuist:App .type app
  gr_attr tuist:AppUI .type framework
  # swift 가 있으면 swift package describe 의 JSON 으로도 같은 결과
  if command -v swift >/dev/null 2>&1; then
    gr_json modules
    gr_spm_check
  fi
}

test_graph_modules_workspaces() {
  gr_repo "$T/mono"
  gr_put package.json <<'EOF'
{
  "name": "root",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
EOF
  gr_put packages/ui/package.json <<'EOF'
{
  "name": "@acme/ui",
  "dependencies": {
    "@acme/utils": "workspace:*",
    "react": "^18.3.0"
  }
}
EOF
  gr_put packages/utils/package.json <<'EOF'
{
  "name": "@acme/utils",
  "version": "1.0.0",
  "author": {
    "name": "Someone"
  }
}
EOF
  printf '[workspace]\nmembers = ["crates/*"]\n\n[workspace.dependencies]\nshared = { path = "crates/shared" }\nserde = "1"\n' | gr_put Cargo.toml
  gr_put crates/app/Cargo.toml <<'EOF'
[package]
name = "app"

[dependencies]
shared.workspace = true
serde = { workspace = true }
local-util = { path = "../util", package = "util" }

[dev-dependencies]
tempfile = "3"
EOF
  printf '[package]\nname = "shared"\n' | gr_put crates/shared/Cargo.toml
  printf '[package]\nname = "util"\n' | gr_put crates/util/Cargo.toml
  printf 'module example.com/svc\n\nrequire (\n\tgithub.com/google/uuid v1.6.0\n)\n' | gr_put go/go.mod
  printf 'package main\n\nimport (\n\t"net/http"\n\n\t"example.com/svc/internal/api"\n\t"github.com/google/uuid"\n)\n\nfunc main() {}\n' | gr_put go/cmd/server/main.go
  printf 'package api\n\nimport "example.com/svc/internal/db"\n' | gr_put go/internal/api/api.go
  printf 'package db\n' | gr_put go/internal/db/db.go
  printf 'rootProject.name = "shop"\ninclude(":app", ":core:data")\ninclude(":feature-login")\n' | gr_put settings.gradle.kts
  gr_put app/build.gradle.kts <<'EOF'
plugins { id("com.android.application") }

dependencies {
    implementation(project(":core:data"))
    implementation(projects.featureLogin)
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    testImplementation(libs.junit)
}
EOF
  printf 'dependencies {\n    api(libs.kotlinx.coroutines)\n}\n' | gr_put core/data/build.gradle.kts
  printf "dependencies {\n    implementation project(':core:data')\n}\n" | gr_put feature-login/build.gradle
  gr_commit
  gr_json modules
  gr_edge npm:@acme/ui npm:@acme/utils depends
  gr_edge npm:@acme/ui pkg:npm/react depends
  gr_edge npm:root pkg:npm/typescript depends
  gr_node npm:@acme/utils
  gr_attr npm:@acme/ui .workspace .
  gr_attr npm:@acme/utils .label @acme/utils
  gr_edge cargo:app cargo:shared depends
  gr_edge cargo:app cargo:util depends
  gr_edge cargo:app pkg:cargo/serde depends
  gr_edge cargo:app pkg:cargo/tempfile depends
  assert_eq "$(gr_q '.edges[] | select(.source == "cargo:app" and .target == "pkg:cargo/tempfile") | .scope')" "dev-dependencies"
  gr_edge go:example.com/svc/cmd/server go:example.com/svc/internal/api depends
  gr_edge go:example.com/svc/internal/api go:example.com/svc/internal/db depends
  gr_edge go:example.com/svc/cmd/server pkg:golang/github.com/google/uuid depends
  gr_no_node pkg:golang/net/http
  gr_edge gradle::app gradle::core:data depends
  gr_edge gradle::app gradle::feature-login depends
  gr_edge gradle::app pkg:maven/com.squareup.retrofit2:retrofit depends
  gr_edge gradle::app pkg:gradle/libs.junit depends
  gr_edge gradle::feature-login gradle::core:data depends
  gr_edge gradle::core:data pkg:gradle/libs.kotlinx.coroutines depends
  assert_eq "$(gr_q '.edges[] | select(.source == "gradle::app" and .target == "pkg:gradle/libs.junit") | .scope')" "testImplementation"
  # 폴더를 주면 그 아래 설정만
  gr_json modules packages
  gr_node npm:@acme/ui
  gr_no_node cargo:app
  gr_no_node npm:root
}

test_graph_changes_cochange() {
  gr_repo "$T/ch"
  for f in a b c d e g; do echo 0 > "$f.txt"; done
  echo '{}' > package.json; echo '{}' > package-lock.json; echo old > old.txt
  gr_commit init
  gch() { local m=$1; shift; for f in "$@"; do echo "$m" >> "$f"; done; git add -A && git commit -q -m "$m"; }
  GIT_COMMITTER_DATE="2020-01-01T00:00:00" gch 1 a.txt b.txt
  GIT_COMMITTER_DATE="2020-01-02T00:00:00" gch 2 a.txt b.txt old.txt
  gch 3 a.txt c.txt old.txt
  gch 4 a.txt b.txt c.txt d.txt e.txt            # --max-files 4 면 빠지는 큰 커밋 (첫 커밋도)
  gch 5 package.json package-lock.json
  gch 6 package.json g.txt
  gch 7 package.json g.txt
  git rm -q old.txt && git commit -q -m "rm old"     # 지운 파일은 추적하지 않으므로 빠진다
  gr_json changes --max-files 4
  assert_eq "$(gr_q '.directed')" "false"
  gr_edge a.txt b.txt cochange
  assert_eq "$(gr_q '.edges[] | select(.source == "a.txt" and .target == "b.txt") | .weight')" "2"
  assert_eq "$(gr_q '.edges[] | select(.source == "a.txt" and .target == "b.txt") | .degree')" "80" "degree = 200*2/(3+2)"
  gr_edge g.txt package.json cochange
  gr_no_edge a.txt c.txt                             # 한 번만 같이 바뀜 (< --min 2)
  gr_no_node old.txt
  gr_no_node package-lock.json
  gr_no_node d.txt
  gr_attr a.txt .changes 3
  gr_attr package.json .changes 3
  gr_attr a.txt .lastChanged "$(date +%Y-%m-%d)"
  assert_eq "$(gr_q '.stats.skippedLargeCommits')" "2"
  assert_eq "$(gr_q '.stats.minCount')" "2"
  gr_json changes --max-files 4 --min 1
  gr_edge a.txt c.txt cochange
  gr_json changes --since 2021-01-01 --max-files 4
  gr_no_edge a.txt b.txt                             # 2020 년 커밋에서만 같이 바뀌었다
  gr_json changes --max-commits 2 --min 1
  assert_eq "$(gr_q '.stats.commits')" "2"
  gr_edge g.txt package.json cochange
  run gitch graph changes --max-commits 1                      # 비면 JSON 은 그대로, 안내는 표준오류로
  assert_ok; assert_out '"nodes": ['; assert_out "같이 바뀐 파일이 없습니다"
  assert_json "$(gitch graph changes --max-commits 1 2>/dev/null)"
  run gitch graph changes --min 0; assert_fail "--min 0 은 거부"
}

test_graph_tree_sizes() {
  gr_repo "$T/tree"
  mkdir -p src/lib/deep docs
  printf '0123456789' > README.md; printf '%0100d' 0 > src/a.ts
  printf 'x' > src/lib/b.ts; printf 'yy' > src/lib/deep/c.ts; printf 'doc' > docs/x.md
  gr_commit
  printf 'new' > src/staged.ts; git add src/staged.ts      # 커밋 전이라도 추적(인덱스)하면 센다
  echo junk > untracked.txt
  gr_json tree
  gr_attr ./ .files 6
  gr_attr ./ .bytes 119
  gr_attr ./ .label tree
  gr_attr src/ .files 4
  gr_attr src/ .filesHere 2
  gr_attr src/ .dirs 1
  gr_attr src/ '.exts.ts' 4
  gr_edge ./ src/ contains
  gr_edge src/lib/ src/lib/deep/ contains
  gr_no_node untracked.txt
  gr_json tree --depth 1
  gr_no_node src/lib/
  gr_attr src/ .files 4
  gr_attr src/ .dirs 1
  gr_json tree --files
  gr_edge src/ src/a.ts contains
  gr_attr src/a.ts .bytes 100
  gr_json tree src
  gr_attr src/ .label src
  gr_no_node ./
  gr_no_node docs/
}

test_graph_formats_and_output() {
  gr_repo "$T/fmt"
  printf 'import x from "</script><b>"\nimport { y } from "./y"\n' | gr_put src/a.ts
  echo 'export const y = 1' | gr_put src/y.ts
  gr_commit
  # 비대화형 기본: json 을 표준출력
  run gitch graph; assert_ok; assert_json "$OUT"
  # html: 오프라인 한 페이지, 데이터 속 </script> 는 끊지 않게
  run gitch graph files --out "$T/out/g.html"; assert_ok
  assert_out "GRAPH_FILE=$T/out/g.html NODES=3 EDGES=2"
  [ -f "$T/out/g.html" ] || fail "html 파일이 없음"
  grep -q '<script id="graph-data" type="application/json">' "$T/out/g.html" || fail "데이터 블록 없음"
  grep -q '"relation": "files"' "$T/out/g.html" || fail "데이터에 관계가 없음"
  for id in panel table legend info q ana banner peek; do grep -q "id=\"$id\"" "$T/out/g.html" || fail "html 에 #$id 가 없음"; done   # 설정 창 · 표로 보기 · 범례 · 정보 · 찾기 · 분석 · 강조 알림 · 마스코트
  grep -q '<html lang="ko" data-theme="dark">' "$T/out/g.html" || fail "기본은 어두운 화면이어야"
  assert_eq "$(grep -o '</script>' "$T/out/g.html" | wc -l | tr -d ' ')" "2" "데이터 속 </script> 가 그대로 들어감"
  if command -v node >/dev/null 2>&1; then   # 보기 스크립트 문법(브라우저 없이)
    awk '/^<script>$/ { on = 1; next } /^<\/script>$/ { on = 0 } on' "$T/out/g.html" > "$T/out/viewer.js"
    grep -q 'function renderAna' "$T/out/viewer.js" || fail "보기 스크립트를 찾지 못함"
    node --check "$T/out/viewer.js" 2>"$T/out/node.err" || fail "보기 스크립트 문법 오류\n$(cat "$T/out/node.err")"
  fi
  grep -Eq '<(script|link)[^>]+(src|href)=' "$T/out/g.html" && fail "외부 파일(CDN)을 불러옴"
  grep -q 'http' "$T/out/g.html" && fail "인터넷 주소가 들어 있음"
  awk '/<script id="graph-data"/ { on = 1; next } /<\/script>/ { on = 0 } on' "$T/out/g.html" > "$T/out/data.json"
  jq -e '.initial == "files" and (.views.files.nodes | length == 3) and (.views | keys == ["changes", "files", "modules", "tree"])' "$T/out/data.json" >/dev/null \
    || fail "html 에 네 관계가 들어 있지 않음\n$(head -c 400 "$T/out/data.json")"
  run gitch graph modules --out "$T/out/m.html"; assert_ok
  grep -q '{"initial":"modules"' "$T/out/m.html" || fail "modules 로 열면 모듈 탭이 처음이어야"
  # 확장자로 형식, --open 은 기본 앱으로
  run gitch graph --out "$T/out/g.json" --open; assert_ok
  assert_json "$(cat "$T/out/g.json")"
  local opened="$T/out/g.json"; [ -n "$IS_WIN" ] && opened=$(cygpath -w "$opened")   # Windows 는 url.dll 에 C:\… 로 넘긴다
  grep -qF "open $opened" "$T/opened" || fail "--open 이 파일을 열지 않음\n$(cat "$T/opened" 2>&1)"
  run gitch graph --format dot; assert_ok; assert_out "digraph gitch {"; assert_out '"src/a.ts" -> "src/y.ts"'
  run gitch graph --format dot --out -; assert_ok; assert_out "digraph"
  run gitch graph --format gif; assert_fail; assert_out "html, json, svg, png, dot"
  run gitch graph --nope; assert_fail; assert_out "사용법: gitch graph"
  run gitch graph "$T/none"; assert_fail; assert_out "폴더가 아닙니다"
  mkdir -p "$T/plain"; run gitch graph "$T/plain"; assert_fail; assert_out "git 저장소 안의 폴더가 아닙니다"
  if command -v dot >/dev/null 2>&1; then
    run gitch graph --out "$T/out/g.svg"; assert_ok
    grep -q '<svg' "$T/out/g.svg" || fail "svg 가 아님"
    run gitch graph modules --format png --out "$T/out/g.png"; assert_ok
    [ "$(head -c 4 "$T/out/g.png" | od -An -c | tr -d ' ')" = '211PNG' ] || fail "png 가 아님"
  else
    run gitch graph --format svg; assert_rc 1
    if [ -n "$IS_WIN" ]; then assert_out "winget install Graphviz.Graphviz"; else assert_out "brew install graphviz"; fi
  fi
}

test_graph_scope_and_worktree_name() {
  gr_repo "$T/scope/myrepo"
  echo 'import { b } from "../lib/b"' | gr_put app/a.ts
  echo 'export const b = 1' | gr_put lib/b.ts
  echo 'export const c = 1' | gr_put lib/c.ts
  gr_commit
  cd app || fail cd
  gr_json files .
  assert_eq "$(gr_q '.scope')" "app"
  gr_edge app/a.ts lib/b.ts import
  gr_attr lib/b.ts .outside true
  gr_no_node lib/c.ts
  cd .. && git worktree add -q "$T/scope/wt" -b side 2>/dev/null || fail "worktree"
  cd "$T/scope/wt" || fail cd
  gr_json tree
  assert_eq "$(gr_q '.repo')" "myrepo" "워크트리여도 본 저장소 이름"
}

test_graph_lang_filter() {
  gr_repo "$T/lang"
  echo 'import { b } from "./b"' | gr_put web/a.ts
  echo 'export const b = 1' | gr_put web/b.ts
  echo 'const x = require("./c")' | gr_put web/legacy.js
  echo 'module.exports = 1' | gr_put web/c.js
  printf 'struct Model {}\n' | gr_put ios/Model.swift
  printf 'let m = Model()\n' | gr_put ios/View.swift
  echo 'import os' | gr_put tools/run.py
  printf '{\n  "name": "web"\n}\n' | gr_put web/package.json
  printf '[package]\nname = "core"\n' | gr_put core/Cargo.toml
  gr_commit
  gr_json --lang swift
  assert_eq "$(gr_q '.lang | join(",")')" "swift"
  assert_eq "$(gr_q '[.nodes[] | select(.kind == "file") | .lang] | unique | join(",")')" "swift"
  gr_edge ios/View.swift ios/Model.swift type-ref
  gr_json --lang web
  assert_eq "$(gr_q '.lang | join(",")')" "ts,js,vue,svelte"
  gr_edge web/a.ts web/b.ts import
  gr_edge web/legacy.js web/c.js require
  gr_no_node ios/Model.swift
  gr_json files --lang ts,py
  gr_node web/a.ts
  gr_node tools/run.py
  gr_no_node web/legacy.js
  gr_json tree --lang swift
  gr_node ios/
  gr_no_node web/
  gr_attr ./ .files 2
  gr_json modules --lang rust
  gr_node cargo:core
  gr_no_node npm:web
  run gitch graph --lang cobol; assert_rc 1; assert_out "--lang 은"
  assert_eq "$(gitch graph --json | jq -r '.lang')" "null" "고르지 않으면 lang 은 null"
}
