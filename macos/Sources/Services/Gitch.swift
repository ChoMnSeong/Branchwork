import Foundation

/// gitch — 여러 Git 계정을 섞이지 않게 쓰는 셸 도구(tools/gitch, 예전 이름 gitsw).
/// 앱 안(Contents/Resources/gitch)에 함께 들어 있고 설정 > CLI 에서 셸 명령으로 설치한다.
/// 저장소 화면은 gitch 가 보는 이 저장소의 계정(잠금)과 커밋·push 전 점검을 보여 주고, 계정을 바꿀 수 있다.
enum Gitch {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// gitch status --json
    struct Status: Decodable, Equatable {
        let inRepo: Bool
        let lockedAccount: String?
        let account: String?
        /// lock · owner · org · folder · alias · host
        let accountSource: String?
        let pushAccount: String?
        let ignored: Bool?

        private enum CodingKeys: String, CodingKey { case inRepo, lockedAccount, account, accountSource, pushAccount, ignored }

        /// gitch 는 값이 없으면 빈 글자("")를 내므로 nil 로 바꿔 읽는다(잠기지 않은 저장소를 잠긴 것으로 보지 않게)
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func text(_ key: CodingKeys) throws -> String? {
                let v = try c.decodeIfPresent(String.self, forKey: key)
                return v?.isEmpty == false ? v : nil
            }
            inRepo = try c.decode(Bool.self, forKey: .inRepo)
            lockedAccount = try text(.lockedAccount)
            account = try text(.account)
            accountSource = try text(.accountSource)
            pushAccount = try text(.pushAccount)
            ignored = try c.decodeIfPresent(Bool.self, forKey: .ignored)
        }
    }

    /// gitch preflight --json (result: OK · WARN · STOP)
    struct Preflight: Decodable, Equatable {
        struct Check: Decodable, Equatable, Hashable {
            let level: String
            let code: String
            let message: String
        }
        let result: String
        let checks: [Check]
    }

    /// gitch list --json 의 계정(rules 는 gitch 가 낸 문구 그대로)
    struct Account: Decodable, Identifiable, Equatable {
        let id: String
        let email: String
        let hosts: String
        let rules: String?
        let sshKey: Bool?
    }

    /// gitch 가 pl · up · sync · fix · undo · amend · rescue 전에 남긴 자동 백업(refs/gitsw/backup/<날짜-시각>-<이유>, 최근 30개)
    struct Backup: Identifiable, Equatable {
        let ref: String
        /// "2026-10-23 16:36:54"
        let date: String
        /// pl · up · sync · fix …
        let reason: String
        let sha: String
        let subject: String
        /// 그때 수정 중이던 파일도 함께 남겼는지
        let hasChanges: Bool
        var id: String { ref }
    }

    /// 앱에 든 gitch
    static var bundled: String? { Bundle.main.path(forResource: "gitch", ofType: nil) }
    /// gitch install 이 만드는 셸 명령
    static var link: String { NSHomeDirectory() + "/bin/gitch" }
    /// 예전 이름 — gitch install 이 같은 파일로 이어 두고, 그 전에 gitsw 로 깔았으면 그것만 있다
    static var legacyLink: String { NSHomeDirectory() + "/bin/gitsw" }
    /// 설정 파일은 예전 이름의 폴더 그대로(기존 설치와 같은 설정을 쓰게)
    static var configFile: String { NSHomeDirectory() + "/.config/gitsw/config" }
    /// 계정을 하나라도 더했는지(gitch add) — 없으면 install 도 저장소 점검도 할 수 없다
    static var hasConfig: Bool { FileManager.default.fileExists(atPath: configFile) }

    /// 셸 명령이 가리키는 실제 파일(~/bin/gitch, 없으면 예전 ~/bin/gitsw). 설치하지 않았으면 nil
    static var installed: String? {
        let fm = FileManager.default
        guard let path = [link, legacyLink].first(where: { fm.isExecutableFile(atPath: $0) }) else { return nil }
        return URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }

    /// 셸 명령 이름(~/bin/gitch 또는 예전 ~/bin/gitsw)
    static var installedName: String? {
        let fm = FileManager.default
        if fm.isExecutableFile(atPath: link) { return "~/bin/gitch" }
        return fm.isExecutableFile(atPath: legacyLink) ? "~/bin/gitsw" : nil
    }

    /// 설치된 셸 명령이 이 앱에 든 gitch 인지(아니면 따로 받은 gitch 나 예전 gitsw)
    static var installedIsBundled: Bool {
        guard let i = installed, let b = bundled else { return false }
        return i == URL(fileURLWithPath: b).resolvingSymlinksInPath().path
    }

    /// 저장소 점검에 쓸 gitch: 설치된 것(따로 받은 것일 수도), 없으면 앱에 든 것
    static var executable: String? { installed ?? bundled }

    /// 파일 머리의 GITSW_VERSION="x.y.z"(변수 이름은 예전 그대로)
    static func version(at path: String) -> String? {
        guard let h = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? h.close() }
        let head = String(decoding: h.readData(ofLength: 4096), as: UTF8.self)
        guard let start = head.range(of: "GITSW_VERSION=\"")?.upperBound,
              let end = head[start...].firstIndex(of: "\"") else { return nil }
        return String(head[start..<end])
    }

    /// 앱을 Finder 에서 켜면 PATH 가 짧다 — gitch 가 부르는 git·gh·jq 를 찾게 흔한 위치를 앞에 둔다
    static var environment: [String: String] {
        var env = ProcessInfo.processInfo.environment
        let git = ToolPaths.shared.get(.git).map { ($0 as NSString).deletingLastPathComponent }
        env["PATH"] = ([git, NSHomeDirectory() + "/bin", "/opt/homebrew/bin", "/usr/local/bin"].compactMap { $0 }
                       + [env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"]).joined(separator: ":")
        return env
    }

    static func status(in repo: URL) async -> Status? { await json(["status", "--json"], in: repo) }

    /// fetch 면 원격을 받아 받을 커밋까지 본다(몇 초). 아니면 지금 있는 원격 정보로만(0.2초 안팎).
    static func preflight(in repo: URL, fetch: Bool) async -> Preflight? {
        await json(["preflight", "--json"] + (fetch ? [] : ["--no-fetch"]), in: repo)
    }

    static func accounts() async -> [Account] {
        struct List: Decodable { let accounts: [Account] }
        let list: List? = await json(["list", "--json"], in: URL(fileURLWithPath: NSHomeDirectory()))
        return list?.accounts ?? []
    }

    /// gitch 명령을 실행하고, 실패하면 gitch 가 낸 문구로 던진다. 성공하면 출력(색 코드 뺀 것)
    @discardableResult
    static func run(_ args: [String], in repo: URL, timeout: TimeInterval = 120) async throws -> String {
        guard let exe = executable else { throw Failure(message: String(localized: "Couldn't find gitch inside Gitrochi.")) }
        let r = try await Shell.run("/bin/bash", [exe] + args, cwd: repo, env: environment, timeout: timeout)
        let out = plain(r.output + (r.stderr.isEmpty ? "" : "\n" + r.stderr))
        guard r.status == 0 else { throw Failure(message: out.isEmpty ? "exit \(r.status)" : out) }
        return out
    }

    /// 종료 코드와 출력을 그대로(확인이 필요하면 gitch 는 2 로 끝나며 무엇을 할지 목록을 낸다)
    static func runRaw(_ args: [String], in repo: URL, timeout: TimeInterval = 120) async throws -> (status: Int32, output: String) {
        guard let exe = executable else { throw Failure(message: String(localized: "Couldn't find gitch inside Gitrochi.")) }
        let r = try await Shell.run("/bin/bash", [exe] + args, cwd: repo, env: environment, timeout: timeout)
        return (r.status, plain(r.output + (r.stderr.isEmpty ? "" : "\n" + r.stderr)))
    }

    /// 자동 백업 목록(gitch rescue 와 같은 순서 — 최근 것이 1번)
    static func backups(in repo: URL) async -> [Backup] {
        let prefix = "refs/gitsw/backup/"
        guard let r = try? await Git.run(["for-each-ref", "--sort=-refname", "--format=%(refname)%09%(objectname:short)%09%(subject)", prefix], in: repo) else { return [] }
        let rows = r.output.split(separator: "\n").map { $0.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false).map(String.init) }
        let refs = Set(rows.compactMap(\.first))
        return rows.compactMap { row in
            guard row.count == 3, !row[0].hasSuffix("-wip") else { return nil }
            let name = String(row[0].dropFirst(prefix.count))
            guard name.count > 16 else { return nil }
            let ts = Array(name)
            let date = "\(String(ts[0..<4]))-\(String(ts[4..<6]))-\(String(ts[6..<8])) \(String(ts[9..<11])):\(String(ts[11..<13])):\(String(ts[13..<15]))"
            return Backup(ref: row[0], date: date, reason: String(name.dropFirst(16)), sha: row[1], subject: row[2], hasChanges: refs.contains(row[0] + "-wip"))
        }
    }

    /// gitch use <계정>: 이 저장소의 커밋 작성자와 원격 주소(그 계정의 SSH 별칭)를 바꾸고 그 계정으로 잠근다
    static func use(_ account: String, in repo: URL) async throws {
        try await run(["use", account], in: repo, timeout: 60)
    }

    /// 앱에 든 gitch 로 `gitch install`: ~/bin/gitch(와 예전 이름 ~/bin/gitsw) 연결, ~/.zshrc, git 전역 훅·규칙, AI 도구 규칙
    static func install() async throws -> String {
        guard let exe = bundled else { throw Failure(message: String(localized: "Couldn't find gitch inside Gitrochi.")) }
        // 다운로드 폴더에서 바로 연 앱은 임시 위치에서 돌아, 거기에 연결하면 다음에 켤 때 끊긴다
        guard !exe.contains("/AppTranslocation/") else {
            throw Failure(message: String(localized: "Gitrochi is running from a temporary location. Move it to the Applications folder, open it again, then install gitch."))
        }
        let r = try await Shell.run("/bin/bash", [exe, "install"], cwd: URL(fileURLWithPath: NSHomeDirectory()), env: environment, timeout: 180)
        let out = plain(r.output + (r.stderr.isEmpty ? "" : "\n" + r.stderr))
        guard r.status == 0 else { throw Failure(message: out.isEmpty ? "exit \(r.status)" : out) }
        return out
    }

    /// Terminal 새 창에서 gitch 명령(add · setup · doctor 처럼 묻거나 길게 보여 주는 것). path 를 주면 그 저장소에서.
    static func openInTerminal(_ args: [String], in path: String? = nil) throws {
        guard let exe = executable else { throw Failure(message: String(localized: "Couldn't find gitch inside Gitrochi.")) }
        try Launcher.run("/bin/bash", args: [exe] + args, in: path ?? NSHomeDirectory())
    }

    private static func json<T: Decodable>(_ args: [String], in repo: URL) async -> T? {
        guard hasConfig, let exe = executable,
              let r = try? await Shell.run("/bin/bash", [exe] + args, cwd: repo, env: environment, timeout: 60) else { return nil }
        // preflight 는 STOP 이면 종료 코드가 1 이어도 JSON 을 낸다
        return try? JSONDecoder().decode(T.self, from: r.data)
    }

    /// 터미널 색 코드를 뺀다
    private static func plain(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
