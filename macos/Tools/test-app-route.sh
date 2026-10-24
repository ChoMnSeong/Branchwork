#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
cat > "$TASK_TMP/main.swift" <<'SWIFT'
import Foundation
@main struct RouteTests {
    static func main() throws {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("gitrochi-route-\(UUID().uuidString)")
        let repo = base.appendingPathComponent("한글 space & repo")
        try fm.createDirectory(at: repo.appendingPathComponent(".git"), withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: base) }
        func link(_ pairs: [(String, String)]) -> URL {
            var c = URLComponents(string: "gitrochi://open")!
            c.queryItems = pairs.map { URLQueryItem(name: $0.0, value: $0.1) }
            return c.url!
        }
        let root = [("repo", repo.path)]
        let good = try AppRoute(url: link(root + [("file", "src/한글 #?.ts"), ("line", "27")]))
        precondition(good.file == "src/한글 #?.ts" && good.line == 27)
        precondition(good.repo.path == repo.resolvingSymlinksInPath().path)
        let sha = String(repeating: "a1", count: 20)
        let commitRoute = try AppRoute(url: link(root + [("commit", sha)]))
        precondition(commitRoute.commit == sha)
        var rejected = 0
        func rejects(_ pairs: [(String, String)]) {
            do { _ = try AppRoute(url: link(pairs)); fatalError("Accepted invalid route: \(pairs)") }
            catch { rejected += 1 }
        }
        for file in ["../escape", "/etc/passwd", "a/../b", "a\\b", "C:secret", "a//b", "./a"] { rejects(root + [("file", file)]) }
        for line in ["0", "-1", "1x", "1000000000", "999999999999999999999999999"] { rejects(root + [("file", "a.ts"), ("line", line)]) }
        rejects(root + [("line", "1")])
        rejects(root + [("repo", repo.path)])
        rejects(root + [("view", "command")])
        rejects(root + [("view", "diff")])
        rejects(root + [("unknown", "value")])
        rejects(root + [("commit", "abc")])
        rejects([("repo", "relative")])
        rejects([("repo", base.path)])
        try fm.createSymbolicLink(at: repo.appendingPathComponent("outside"), withDestinationURL: base)
        rejects(root + [("file", "outside/missing.ts")])
        print("AppRoute passed: Unicode encoding, file/line, and \(rejected) invalid routes")
    }
}
SWIFT
swiftc -parse-as-library "$ROOT/Sources/Core/AppRoute.swift" "$TASK_TMP/main.swift" -o "$TASK_TMP/test-route"
"$TASK_TMP/test-route"
