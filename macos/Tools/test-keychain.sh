#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
python3 - "$ROOT/Sources/Services/Accounts.swift" "$TASK_TMP/Keychain.swift" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
keychain, delimiter, _ = source.partition('/// GitHub·사내 GitLab 계정')
assert delimiter and 'enum Keychain {' in keychain
Path(sys.argv[2]).write_text(keychain)
PY
cat > "$TASK_TMP/main.swift" <<'SWIFT'
import Foundation
@main struct KeychainTests {
    static func main() {
        let name = "selftest-keychain-" + UUID().uuidString
        defer { Keychain.set(nil, for: name) }
        precondition(Keychain.set("test-one", for: name), "Keychain creation failed")
        precondition(Keychain.get(name) == "test-one", "Keychain read failed")
        precondition(Keychain.set("test-two", for: name), "Keychain update failed")
        precondition(Keychain.get(name) == "test-two", "Keychain replacement failed")
        precondition(Keychain.set(nil, for: name), "Keychain cleanup failed")
        precondition(Keychain.get(name) == nil, "Keychain item remained")
        precondition(Keychain.set(nil, for: name), "Keychain deletion was not idempotent")
        print("macOS Keychain: unique credential create/read/update/delete and idempotent cleanup passed")
    }
}
SWIFT
swiftc -parse-as-library -swift-version 5 "$TASK_TMP/Keychain.swift" "$ROOT/Sources/Core/LegacyData.swift" "$TASK_TMP/main.swift" -o "$TASK_TMP/test-keychain"
"$TASK_TMP/test-keychain"
