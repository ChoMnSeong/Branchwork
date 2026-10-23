import Foundation

/// gitsw — 여러 Git 계정을 섞이지 않게 쓰는 셸 도구(tools/gitsw).
/// 앱 안(Contents/Resources/gitsw)에 함께 들어 있고 설정 > 도구에서 셸 명령으로 설치한다.
/// 저장소 화면은 gitsw 가 보는 이 저장소의 계정(잠금)과 커밋·push 전 점검을 보여 준다.
enum Gitsw {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// gitsw status --json
    struct Status: Decodable, Equatable {
        let inRepo: Bool
        let lockedAccount: String?
        let account: String?
        /// lock · owner · org · folder · alias · host
        let accountSource: String?
        let pushAccount: String?
        let ignored: Bool?
    }

    /// gitsw preflight --json (result: OK · WARN · STOP)
    struct Preflight: Decodable, Equatable {
        struct Check: Decodable, Equatable, Hashable {
            let level: String
            let code: String
            let message: String
        }
        let result: String
        let checks: [Check]
    }

    /// 앱에 든 gitsw
    static var bundled: String? { Bundle.main.path(forResource: "gitsw", ofType: nil) }
    /// gitsw install 이 만드는 셸 명령
    static var link: String { NSHomeDirectory() + "/bin/gitsw" }
    static var configFile: String { NSHomeDirectory() + "/.config/gitsw/config" }
    /// 계정을 하나라도 더했는지(gitsw add) — 없으면 install 도 저장소 점검도 할 수 없다
    static var hasConfig: Bool { FileManager.default.fileExists(atPath: configFile) }

    /// ~/bin/gitsw 가 가리키는 실제 파일. 설치하지 않았으면 nil
    static var installed: String? {
        let fm = FileManager.default
        guard fm.isExecutableFile(atPath: link) else { return nil }
        return URL(fileURLWithPath: link).resolvingSymlinksInPath().path
    }

    /// 설치된 셸 명령이 이 앱에 든 gitsw 인지(아니면 사용자가 따로 받은 gitsw)
    static var installedIsBundled: Bool {
        guard let i = installed, let b = bundled else { return false }
        return i == URL(fileURLWithPath: b).resolvingSymlinksInPath().path
    }

    /// 저장소 점검에 쓸 gitsw: 설치된 것(따로 받은 것일 수도), 없으면 앱에 든 것
    static var executable: String? { installed ?? bundled }

    /// 파일 머리의 GITSW_VERSION="x.y.z"
    static func version(at path: String) -> String? {
        guard let h = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? h.close() }
        let head = String(decoding: h.readData(ofLength: 4096), as: UTF8.self)
        guard let start = head.range(of: "GITSW_VERSION=\"")?.upperBound,
              let end = head[start...].firstIndex(of: "\"") else { return nil }
        return String(head[start..<end])
    }

    /// 앱을 Finder 에서 켜면 PATH 가 짧다 — gitsw 가 부르는 git·gh·jq 를 찾게 흔한 위치를 앞에 둔다
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

    /// 앱에 든 gitsw 로 `gitsw install`: ~/bin/gitsw 연결, ~/.zshrc, git 전역 훅·규칙, AI 도구 규칙. 출력을 돌려준다.
    static func install() async throws -> String {
        guard let exe = bundled else { throw Failure(message: String(localized: "Couldn't find gitsw inside Branchwork.")) }
        // 다운로드 폴더에서 바로 연 앱은 임시 위치에서 돌아, 거기에 연결하면 다음에 켤 때 끊긴다
        guard !exe.contains("/AppTranslocation/") else {
            throw Failure(message: String(localized: "Branchwork is running from a temporary location. Move it to the Applications folder, open it again, then install gitsw."))
        }
        let r = try await Shell.run("/bin/bash", [exe, "install"], cwd: URL(fileURLWithPath: NSHomeDirectory()), env: environment, timeout: 180)
        let out = plain(r.output + (r.stderr.isEmpty ? "" : "\n" + r.stderr))
        guard r.status == 0 else { throw Failure(message: out.isEmpty ? "exit \(r.status)" : out) }
        return out
    }

    /// Terminal 새 창에서 gitsw 명령(add · doctor 처럼 묻거나 길게 보여 주는 것). path 를 주면 그 저장소에서.
    static func openInTerminal(_ args: [String], in path: String? = nil) throws {
        guard let exe = executable else { throw Failure(message: String(localized: "Couldn't find gitsw inside Branchwork.")) }
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
