#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
cat > "$TASK_TMP/main.swift" <<'SWIFT'
import Foundation

@main struct KeyRegistrationTests {
    static func main() async throws {
        let key = "ssh-ed25519 AAAA"
        let token = "TEST_TOKEN_MUST_NEVER_APPEAR_IN_ERRORS"
        var calls: [URLRequest] = []
        let created = try await GitHubSSHRegistration.register(publicKey: key + " comment@example.invalid", login: "octocat", token: token) { req in
            calls.append(req)
            precondition(req.url?.scheme == "https" && req.url?.host == "api.github.com")
            precondition(req.value(forHTTPHeaderField: "Authorization") == "Bearer " + token)
            if req.url!.path == "/user" { return (Data(#"{"login":"octocat"}"#.utf8), 200) }
            if req.httpMethod == "POST" {
                let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: String]
                precondition(body == ["key": key, "title": "Gitrochi (octocat)"])
                return (Data(#"{"id":1}"#.utf8), 201)
            }
            return (Data("[]".utf8), 200)
        }
        precondition(created && calls.count == 3 && calls.last?.httpMethod == "POST")
        calls = []
        let reused = try await GitHubSSHRegistration.register(publicKey: key, login: "OCTOCAT", token: token) { req in
            calls.append(req)
            return req.url!.path == "/user" ? (Data(#"{"login":"octocat"}"#.utf8), 200) : (Data(#"[{"key":"ssh-ed25519 AAAA another-comment"}]"#.utf8), 200)
        }
        precondition(!reused && calls.count == 2 && !calls.contains { $0.httpMethod == "POST" })
        calls = []
        do {
            _ = try await GitHubSSHRegistration.register(publicKey: key, login: "other", token: token) { req in
                calls.append(req); return (Data(#"{"login":"octocat"}"#.utf8), 200)
            }
            fatalError("wrong identity accepted")
        } catch { precondition(calls.count == 1 && !error.localizedDescription.contains(token)) }
        for status in [401, 403, 422, 500] {
            do {
                _ = try await GitHubSSHRegistration.register(publicKey: key, login: "octocat", token: token) { _ in
                    (Data("server error echoes \(token)".utf8), status)
                }
                fatalError("HTTP failure accepted")
            } catch { precondition(!error.localizedDescription.contains(token)) }
        }
        do {
            _ = try await GitHubSSHRegistration.register(publicKey: "invalid-not-a-public-ssh-key", login: "octocat", token: token) { _ in
                fatalError("invalid key reached network")
            }
            fatalError("invalid key accepted")
        } catch {}
        var pages = 0
        let paginated = try await GitHubSSHRegistration.register(publicKey: key, login: "octocat", token: token) { req in
            if req.url!.path == "/user" { return (Data(#"{"login":"octocat"}"#.utf8), 200) }
            pages += 1
            let rows = pages == 1 ? Array(repeating: ["key":"ssh-ed25519 AAAB"], count: 100) : [["key":key]]
            return (try JSONSerialization.data(withJSONObject: rows), 200)
        }
        precondition(!paginated && pages == 2)
        print("GitHub public key registration: creation, reuse, identity guard, pagination, invalid key and sanitized HTTP failures passed")
    }
}
SWIFT
swiftc -parse-as-library -swift-version 5 "$ROOT/Sources/Services/GitHubSSHRegistration.swift" "$TASK_TMP/main.swift" -o "$TASK_TMP/test-key-registration"
"$TASK_TMP/test-key-registration"
