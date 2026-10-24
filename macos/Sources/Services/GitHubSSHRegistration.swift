import Foundation

/// Fixed GitHub endpoints and sanitized errors keep tokens out of UI and diagnostics.
enum GitHubSSHRegistration {
    typealias Transport = (URLRequest) async throws -> (Data, Int)
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
    private struct User: Decodable { let login: String }
    private struct PublicKey: Decodable { let key: String }

    static func canonical(_ raw: String) -> String? {
        guard !raw.contains("\n"), !raw.contains("\r"), raw.utf8.count <= 16384 else { return nil }
        let parts = raw.split(whereSeparator: \.isWhitespace)
        guard parts.count >= 2, parts[0].hasPrefix("ssh-") || parts[0].hasPrefix("ecdsa-"),
              Data(base64Encoded: String(parts[1]))?.isEmpty == false else { return nil }
        return parts.prefix(2).joined(separator: " ")
    }

    /// Returns true for a newly registered key, false for an existing matching key.
    static func register(publicKey: String, login: String, token: String, transport: Transport = live) async throws -> Bool {
        guard let key = canonical(publicKey), !login.isEmpty else {
            throw Failure(message: String(localized: "Couldn't read a valid SSH public key. Refresh the key details and retry."))
        }
        func request(_ path: String, method: String = "GET", body: [String: String]? = nil) throws -> URLRequest {
            var req = URLRequest(url: URL(string: "https://api.github.com" + path)!, timeoutInterval: 30)
            req.httpMethod = method
            req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            req.setValue("Gitrochi", forHTTPHeaderField: "User-Agent")
            req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
            if let body {
                req.httpBody = try JSONEncoder().encode(body)
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            return req
        }
        func send(_ req: URLRequest) async throws -> Data {
            let (data, status): (Data, Int)
            do { (data, status) = try await transport(req) }
            catch is CancellationError { throw CancellationError() }
            catch { throw Failure(message: String(localized: "Couldn't reach GitHub. Check your connection and retry.")) }
            guard (200..<300).contains(status) else {
                if status == 401 || status == 403 {
                    throw Failure(message: String(localized: "GitHub didn't allow key registration. Sign in again and allow SSH key access, or register the public key manually."))
                }
                throw Failure(message: String(localized: "GitHub couldn't register this public key. It may already belong to another account. Check the SSH key settings or retry."))
            }
            return data
        }
        let user = try JSONDecoder().decode(User.self, from: await send(request("/user")))
        guard user.login.caseInsensitiveCompare(login) == .orderedSame else {
            throw Failure(message: String(localized: "The signed-in GitHub account doesn't match this account. Sign in with the intended account."))
        }
        for page in 1...10 {
            let keys = try JSONDecoder().decode([PublicKey].self, from: await send(request("/user/keys?per_page=100&page=\(page)")))
            if keys.contains(where: { canonical($0.key) == key }) { return false }
            if keys.count < 100 { break }
            if page == 10 {
                throw Failure(message: String(localized: "There are too many SSH keys to check safely. Register this public key in GitHub settings."))
            }
        }
        _ = try await send(request("/user/keys", method: "POST", body: ["title": "Gitrochi (\(login))", "key": key]))
        return true
    }

    private static func live(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}
