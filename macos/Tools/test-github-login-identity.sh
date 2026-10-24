#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
cat > "$TASK_TMP/main.swift" <<'SWIFT'
import Foundation
@main struct GitHubLoginIdentityTests {
    @MainActor static func main() async throws {
        var imports: [String] = []
        for expected in ["octocat", "OCTOCAT", nil] {
            let account = try await GitHubLoginIdentity.connect(login: "octocat", expected: expected) { login in
                imports.append(login)
                return "connected-" + login
            }
            precondition(account == "connected-octocat")
        }
        precondition(imports == ["octocat", "octocat", "octocat"])
        imports = []
        do {
            _ = try await GitHubLoginIdentity.connect(login: "other-account", expected: "octocat") { login in
                imports.append(login)
                return login
            }
            fatalError("mismatched identity was imported")
        } catch let mismatch as GitHubLoginIdentity.Mismatch {
            precondition(mismatch.expected == "octocat")
            precondition(mismatch.localizedDescription.contains("octocat"))
            precondition(imports.isEmpty, "credentials were imported before identity validation")
        }
        enum ImportFailure: Error { case denied }
        do {
            let _: String = try await GitHubLoginIdentity.connect(login: "octocat", expected: "octocat") { _ in
                throw ImportFailure.denied
            }
            fatalError("credential import failure was swallowed")
        } catch ImportFailure.denied {}
        print("GitHub login identity: exact/case-insensitive/new identity accepted, mismatch blocked before import, import failure propagated")
    }
}
SWIFT
swiftc -parse-as-library -swift-version 5 "$ROOT/Sources/Services/GitHubLoginIdentity.swift" "$TASK_TMP/main.swift" -o "$TASK_TMP/test-login-identity"
"$TASK_TMP/test-login-identity"
