import Foundation
import AppKit
import Observation

/// Claude Code 세션 상태(훅 이벤트로 판단)
enum AgentStatus: String {
    case starting, working, permission, waiting, ended

    var title: String {
        switch self {
        case .starting: return "입력 대기"
        case .working: return "작업 중"
        case .permission: return "권한 요청"
        case .waiting: return "입력 대기"
        case .ended: return "종료됨"
        }
    }

    var isActive: Bool { self == .working || self == .permission }
}

struct AgentSession: Identifiable, Hashable {
    let id: String
    let path: String
    let task: String
    let created: Date
    var pid: Int32?
    var status: AgentStatus
    var detail: String?
    var updated: Date
}

/// Branchwork 가 띄운 Claude Code 세션 추적.
///
/// 세션을 띄울 때 `--settings` 로 훅을 더해 두면(사용자 설정·훅은 그대로 유지) 각 이벤트마다
/// hook.sh 가 ~/Library/Application Support/Branchwork/agents/<id>.state 에 마지막 상태를 쓴다.
/// 이 폴더를 지켜보다가 상태를 읽고, 프로세스가 사라졌으면 종료로 본다.
@MainActor @Observable
final class AgentCenter {
    static let shared = AgentCenter()

    private(set) var sessions: [AgentSession] = []
    let directory: URL
    private var watcher: FileWatcher?
    private var timer: Timer?

    private var hookScript: URL { directory.appendingPathComponent("hook.sh") }
    private var hooksFile: URL { directory.appendingPathComponent("hooks.json") }
    private func file(_ name: String) -> URL { directory.appendingPathComponent(name) }

    private init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Branchwork/agents", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        installHooks()
        load()
        watcher = FileWatcher(path: directory.path) { [weak self] _ in
            Task { @MainActor in self?.load() }
        }
        // 터미널을 닫아 훅 없이 끝난 세션도 잡도록 주기적으로 프로세스 확인
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.load() }
        }
    }

    func sessions(in path: String) -> [AgentSession] {
        let key = Self.normalize(path)
        return sessions.filter { Self.normalize($0.path) == key }
    }

    static func normalize(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
    }

    // MARK: 훅 설치

    private func installHooks() {
        let script = """
        #!/bin/sh
        # Branchwork: Claude Code 훅 이벤트를 세션 상태 파일로 남긴다(Branchwork 가 띄운 세션만).
        [ -n "$BRANCHWORK_AGENT_ID" ] || exit 0
        dir="$HOME/Library/Application Support/Branchwork/agents"
        payload=$(cat)
        [ -n "$payload" ] || payload=null
        tmp="$dir/$BRANCHWORK_AGENT_ID.state.tmp"
        printf '{"event":"%s","time":%s,"payload":%s}\\n' "$1" "$(date +%s)" "$payload" > "$tmp" && mv -f "$tmp" "$dir/$BRANCHWORK_AGENT_ID.state"
        exit 0

        """
        try? script.write(to: hookScript, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hookScript.path)

        let events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "SessionEnd"]
        var hooks: [String: Any] = [:]
        for e in events {
            hooks[e] = [["matcher": "", "hooks": [["type": "command", "command": "\"\(hookScript.path)\" \(e)", "timeout": 5]]]]
        }
        if let data = try? JSONSerialization.data(withJSONObject: ["hooks": hooks], options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: hooksFile)
        }
    }

    // MARK: 상태 읽기

    private func json(_ name: String) -> [String: Any]? {
        guard let data = try? Data(contentsOf: file(name)) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    func load() {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
        var list: [AgentSession] = []
        for name in names where name.hasSuffix(".meta") {
            let id = String(name.dropLast(5))
            guard let meta = json(name) else { continue }
            let created = Date(timeIntervalSince1970: meta["created"] as? Double ?? 0)
            let pid = (try? String(contentsOf: file(id + ".pid"), encoding: .utf8)).flatMap { Int32($0.trimmed) }
            var status = AgentStatus.starting
            var detail: String?
            var updated = created

            if let state = json(id + ".state") {
                updated = Date(timeIntervalSince1970: state["time"] as? Double ?? created.timeIntervalSince1970)
                let payload = state["payload"] as? [String: Any] ?? [:]
                switch state["event"] as? String {
                case "SessionStart":
                    status = .starting
                case "UserPromptSubmit":
                    status = .working
                case "PreToolUse":
                    status = .working
                    detail = payload["tool_name"] as? String
                case "PermissionRequest":
                    status = .permission
                    detail = payload["tool_name"] as? String
                case "Notification":
                    let message = payload["message"] as? String
                    status = (message?.lowercased().contains("permission") ?? false) ? .permission : .waiting
                    detail = message
                case "Stop":
                    status = .waiting
                case "SessionEnd":
                    status = .ended
                default:
                    break
                }
            }

            let alive: Bool
            if let pid {
                let r = kill(pid, 0)
                alive = r == 0 || errno == EPERM
            } else {
                alive = Date().timeIntervalSince(created) < 30   // 터미널이 뜨는 중
            }
            if !alive { status = .ended }
            if status == .ended, Date().timeIntervalSince(max(updated, created)) > 86_400 {
                remove(id: id)
                continue
            }
            list.append(AgentSession(id: id, path: meta["path"] as? String ?? "", task: meta["task"] as? String ?? "",
                                     created: created, pid: pid, status: status, detail: detail, updated: updated))
        }
        list.sort { $0.created > $1.created }
        if list != sessions { sessions = list }
    }

    // MARK: 세션 다루기

    /// 폴더에서 Claude Code 를 새 Terminal 창으로 띄운다. task 가 있으면 첫 요청으로 보낸다.
    func start(in path: String, task: String, permissionMode: String? = nil) throws {
        let id = UUID().uuidString.lowercased()
        let meta: [String: Any] = ["id": id, "path": path, "task": task.trimmed, "created": Date().timeIntervalSince1970]
        try JSONSerialization.data(withJSONObject: meta).write(to: file(id + ".meta"))
        var args = ["--settings", hooksFile.path]
        if let permissionMode, !permissionMode.isEmpty { args += ["--permission-mode", permissionMode] }
        if !task.trimmed.isEmpty { args.append(task.trimmed) }
        try Launcher.run(Claude.findCLI() ?? "claude", args: args, in: path,
                         env: ["BRANCHWORK_AGENT_ID": id], pidFile: file(id + ".pid").path)
        load()
    }

    /// 세션이 돌고 있는 Terminal 탭을 앞으로 가져온다(처음 한 번 Terminal 제어 허용을 묻는다).
    func focus(_ s: AgentSession) {
        guard let pid = s.pid, s.status != .ended else { return }
        Task {
            let r = try? await Shell.run("/bin/ps", ["-o", "tty=", "-p", String(pid)], cwd: directory)
            let tty = r?.output.trimmed ?? ""
            guard !tty.isEmpty, tty != "??" else { return }
            let source = """
            tell application "Terminal"
                repeat with w in windows
                    repeat with t in tabs of w
                        if tty of t is "/dev/\(tty)" then
                            set selected of t to true
                            set index of w to 1
                            activate
                            return
                        end if
                    end repeat
                end repeat
            end tell
            """
            var error: NSDictionary?
            NSAppleScript(source: source)?.executeAndReturnError(&error)
            if error != nil, let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") {
                NSWorkspace.shared.openApplication(at: terminal, configuration: NSWorkspace.OpenConfiguration(),
                                                   completionHandler: nil)
            }
        }
    }

    func stop(_ s: AgentSession) {
        if let pid = s.pid { kill(pid, SIGTERM) }
        load()
    }

    func remove(id: String) {
        for ext in [".meta", ".state", ".pid", ".state.tmp"] {
            try? FileManager.default.removeItem(at: file(id + ext))
        }
        sessions.removeAll { $0.id == id }
    }

    func clearEnded() {
        for s in sessions where s.status == .ended { remove(id: s.id) }
    }
}
