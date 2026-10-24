import Foundation

/// An existing Git identity must match before importing any approved credentials.
@MainActor
enum GitHubLoginIdentity {
    struct Mismatch: LocalizedError {
        let expected: String
        var errorDescription: String? { String(localized: "Sign in as \(expected) to connect this Git identity.") }
    }

    static func connect<Account>(login: String, expected: String?, importAccount: (String) async throws -> Account) async throws -> Account {
        if let expected, login.caseInsensitiveCompare(expected) != .orderedSame {
            throw Mismatch(expected: expected)
        }
        return try await importAccount(login)
    }
}
