import Foundation
import AppKit

/// 터미널(Terminal.app)에서 폴더 열기·에이전트(Claude Code·Codex·Gemini CLI) 실행
enum Launcher {
    private static var terminal: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal")
    }

    static func quote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func openTerminal(at path: String) {
        guard let t = terminal else { return }
        NSWorkspace.shared.open([URL(fileURLWithPath: path, isDirectory: true)], withApplicationAt: t,
                                configuration: NSWorkspace.OpenConfiguration())
    }

    /// 폴더에서 명령을 새 Terminal 창으로 실행한다. .command 파일을 Terminal 로 여는 방식이라
    /// 자동화(AppleScript) 권한이 필요 없다. exec 로 바꿔 실행하므로 pidFile 에 적힌 PID 가 곧 그 프로그램의 PID 다.
    static func run(_ program: String, args: [String], in path: String, env: [String: String] = [:], pidFile: String? = nil) throws {
        guard let t = terminal else { throw AIError.failed("Terminal", "Terminal 앱을 찾지 못했습니다.") }
        var lines = ["#!/bin/zsh -l", "cd -- \(quote(path)) || exit 1"]
        if let pidFile { lines.append("printf '%s' $$ > \(quote(pidFile))") }
        for (k, v) in env.sorted(by: { $0.key < $1.key }) { lines.append("export \(k)=\(quote(v))") }
        lines.append("clear")
        lines.append((["exec", program.contains("/") ? quote(program) : program] + args.map(quote)).joined(separator: " "))
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("branchwork-\(UUID().uuidString.prefix(8)).command")
        try (lines.joined(separator: "\n") + "\n").write(to: file, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: file.path)
        NSWorkspace.shared.open([file], withApplicationAt: t, configuration: NSWorkspace.OpenConfiguration())
    }
}
