import SwiftUI
import AppKit
import CryptoKit
import Observation

/// 커밋 작성자 프로필 사진. 이메일로 찾는다:
/// ① GitHub noreply 주소면 GitHub 프로필 ② 연결한 사내 GitLab 의 프로필 ③ Gravatar. 없으면 이니셜.
/// 받은 사진과 '없음'은 디스크에 저장해 두고(없음은 7일 뒤 다시 확인), 한 번에 4개까지만 받는다.
@MainActor @Observable
final class AvatarStore {
    static let shared = AvatarStore()

    var enabled: Bool = UserDefaults.standard.object(forKey: "avatarFetch") as? Bool ?? true {
        didSet { UserDefaults.standard.set(enabled, forKey: "avatarFetch") }
    }

    /// 사진을 새로 받을 때마다 올라간다(화면이 다시 그려지게). 사진 표 자체는 그리는 중에 채워도 되게 관찰하지 않는다.
    private(set) var version = 0
    @ObservationIgnored private var images: [String: NSImage] = [:]
    @ObservationIgnored private var missing = Set<String>()
    @ObservationIgnored private var queued = Set<String>()
    @ObservationIgnored private var queue: [String] = []
    @ObservationIgnored private var running = 0

    private let directory: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Branchwork/avatars", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private func key(_ email: String) -> String {
        SHA256.hash(data: Data(email.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    /// 있으면 사진, 없으면 nil(필요하면 뒤에서 받기 시작)
    func image(for rawEmail: String) -> NSImage? {
        guard enabled else { return nil }
        _ = version
        let email = rawEmail.trimmed.lowercased()
        guard !email.isEmpty, email.contains("@") else { return nil }
        if let img = images[email] { return img }
        if missing.contains(email) || queued.contains(email) { return nil }
        // 디스크에 있으면 바로
        let file = directory.appendingPathComponent(key(email) + ".png")
        if let img = NSImage(contentsOf: file) {
            images[email] = img
            return img
        }
        let none = directory.appendingPathComponent(key(email) + ".none")
        if let attrs = try? FileManager.default.attributesOfItem(atPath: none.path),
           let date = attrs[.modificationDate] as? Date, Date().timeIntervalSince(date) < 7 * 86_400 {
            missing.insert(email)
            return nil
        }
        queued.insert(email)
        queue.append(email)
        pump()
        return nil
    }

    private func pump() {
        while running < 4, !queue.isEmpty {
            let email = queue.removeFirst()
            running += 1
            Task {
                let data = await Self.fetch(email, gitlab: gitlabAccounts())
                running -= 1
                queued.remove(email)
                let base = directory.appendingPathComponent(key(email))
                if let data, let img = NSImage(data: data) {
                    try? data.write(to: base.appendingPathExtension("png"))
                    images[email] = img
                    version += 1
                } else {
                    missing.insert(email)
                    FileManager.default.createFile(atPath: base.appendingPathExtension("none").path, contents: nil)
                }
                pump()
            }
        }
    }

    private func gitlabAccounts() -> [(server: String, token: String)] {
        let store = AccountStore.shared
        return store.accounts(for: .gitlab).compactMap { a in store.token(for: a).map { (a.server, $0) } }
    }

    /// 이미 받은 '없음' 표시를 지우고 다시 받기(설정에서)
    func refresh() {
        missing.removeAll()
        images.removeAll()
        version += 1
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    // MARK: 받기

    nonisolated private static func get(_ url: String, headers: [String: String] = [:]) async -> (Int, Data)? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u, timeoutInterval: 15)
        req.setValue("Branchwork", forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        guard let (data, resp) = try? await URLSession.shared.data(for: req) else { return nil }
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    nonisolated private static func image(_ url: String, headers: [String: String] = [:]) async -> Data? {
        guard let (code, data) = await get(url, headers: headers), code == 200, NSImage(data: data) != nil else { return nil }
        return data
    }

    nonisolated static func gravatarURL(_ email: String) -> String {
        let md5 = Insecure.MD5.hash(data: Data(email.utf8)).map { String(format: "%02x", $0) }.joined()
        return "https://www.gravatar.com/avatar/\(md5)?s=64&d=404"
    }

    nonisolated private static func fetch(_ email: String, gitlab: [(server: String, token: String)]) async -> Data? {
        // ① GitHub noreply: 12345+name@users.noreply.github.com 또는 name@users.noreply.github.com
        if email.hasSuffix("@users.noreply.github.com") {
            let local = String(email.dropLast("@users.noreply.github.com".count))
            if let plus = local.firstIndex(of: "+"), let id = Int(local[..<plus]) {
                if let d = await image("https://avatars.githubusercontent.com/u/\(id)?s=64") { return d }
            } else if let d = await image("https://github.com/\(local).png?size=64") { return d }
        }
        // ② 사내 GitLab: /api/v4/avatar?email= (그 서버에 사진이 올라간 사용자만 — Gravatar 로 돌려주면 ③에서)
        for g in gitlab {
            let q = email.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? email
            guard let (code, data) = await get("\(g.server)/api/v4/avatar?email=\(q)&size=64", headers: ["PRIVATE-TOKEN": g.token]),
                  code == 200,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let url = obj["avatar_url"] as? String, !url.isEmpty, !url.contains("gravatar.com") else { continue }
            let full = url.hasPrefix("/") ? g.server + url : url
            if let d = await image(full, headers: full.hasPrefix(g.server) ? ["PRIVATE-TOKEN": g.token] : [:]) { return d }
        }
        // ③ Gravatar(없으면 404)
        return await image(gravatarURL(email))
    }
}

/// 작성자 동그라미: 프로필 사진이 있으면 사진, 없으면 이니셜
struct AuthorAvatar: View {
    let name: String
    let email: String
    var size: CGFloat = 20

    var body: some View {
        if let img = AvatarStore.shared.image(for: email) {
            Image(nsImage: img)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            Avatar(name: name, email: email, size: size)
        }
    }
}
