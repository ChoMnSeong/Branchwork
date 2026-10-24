import Foundation
import AppKit
import UniformTypeIdentifiers

/// 터미널(Terminal.app)에서 폴더 열기·에이전트(Claude Code·Codex·Gemini CLI) 실행, 기본 브라우저 · 글 편집기로 파일 열기
enum Launcher {
    private static var terminal: URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal")
    }

    static func quote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// 기본 브라우저로 연다 — .html 을 편집기 같은 다른 앱에 묶어 두었어도 브라우저로(못 찾으면 그 파일의 기본 앱)
    @MainActor static func openInBrowser(_ file: URL) async throws {
        let ws = NSWorkspace.shared
        guard let browser = URL(string: "https:").flatMap(ws.urlForApplication(toOpen:)) else {
            ws.open(file)
            return
        }
        _ = try await ws.open([file], withApplicationAt: browser, configuration: NSWorkspace.OpenConfiguration())
    }

    /// 일반 텍스트를 여는 앱(TextEdit 이나 사용자가 고른 편집기)으로 연다 — .rules 처럼 묶인 앱이 없는 확장자도
    @MainActor static func openInTextEditor(_ file: URL) async throws {
        let ws = NSWorkspace.shared
        guard let editor = ws.urlForApplication(toOpen: .plainText) else {
            ws.open(file)
            return
        }
        _ = try await ws.open([file], withApplicationAt: editor, configuration: NSWorkspace.OpenConfiguration())
    }

    static func openTerminal(at path: String) {
        guard let t = terminal else { return }
        NSWorkspace.shared.open([URL(fileURLWithPath: path, isDirectory: true)], withApplicationAt: t,
                                configuration: NSWorkspace.OpenConfiguration())
    }

    /// 폴더에서 명령을 새 Terminal 창으로 실행한다. .command 파일을 Terminal 로 여는 방식이라
    /// 자동화(AppleScript) 권한이 필요 없다. exec 로 바꿔 실행하므로 pidFile 에 적힌 PID 가 곧 그 프로그램의 PID 다.
    static func run(_ program: String, args: [String], in path: String, env: [String: String] = [:], pidFile: String? = nil) throws {
        guard let t = terminal else { throw AIError.failed("Terminal", String(localized: "Couldn't find the Terminal app.")) }
        var lines = ["#!/bin/zsh -l", "cd -- \(quote(path)) || exit 1"]
        if let pidFile { lines.append("printf '%s' $$ > \(quote(pidFile))") }
        for (k, v) in env.sorted(by: { $0.key < $1.key }) { lines.append("export \(k)=\(quote(v))") }
        lines.append("clear")
        lines.append((["exec", program.contains("/") ? quote(program) : program] + args.map(quote)).joined(separator: " "))
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("gitrochi-\(UUID().uuidString.prefix(8)).command")
        try (lines.joined(separator: "\n") + "\n").write(to: file, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: file.path)
        NSWorkspace.shared.open([file], withApplicationAt: t, configuration: NSWorkspace.OpenConfiguration())
    }
}
