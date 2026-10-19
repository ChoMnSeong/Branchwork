import Foundation
import AppKit

enum ClaudeError: LocalizedError {
    case notConfigured(String)
    case refused
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured(let m): return m
        case .refused: return "Claude 가 이 요청을 거절했습니다. 내용을 바꿔 다시 시도해 보세요."
        case .failed(let m): return "Claude 응답 실패: \(m)"
        }
    }
}

/// Claude 연결: 이 맥의 Claude Code CLI(로그인 그대로) 또는 Anthropic API(Messages API, HTTP)
enum Claude {
    static let defaultModel = "claude-opus-5-5"
    static let models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]

    static func findCLI() -> String? {
        let home = NSHomeDirectory()
        return ["\(home)/.local/bin/claude", "\(home)/.claude/local/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// 텍스트 한 번 생성. effort 는 API 방식에서만 쓴다(low/medium/high).
    @MainActor
    static func complete(system: String, prompt: String, effort: String) async throws -> String {
        let acc = AccountStore.shared
        switch acc.claudeMode {
        case .cli:
            guard let cli = acc.cliPath else {
                throw ClaudeError.notConfigured("Claude Code(claude)를 찾지 못했습니다. 설정 > Claude 에서 API 키 방식으로 바꾸세요.")
            }
            return try await viaCLI(cli, model: acc.claudeCLIModel, system: system, prompt: prompt)
        case .api:
            guard let key = acc.claudeKey, !key.isEmpty else {
                throw ClaudeError.notConfigured("설정 > Claude 에서 Anthropic API 키를 입력하세요.")
            }
            return try await viaAPI(key: key, model: acc.claudeModel, system: system, prompt: prompt, effort: effort)
        }
    }

    /// `claude -p` 비대화 실행. 도구를 모두 끄고(--tools "") 세션을 남기지 않는다.
    private static func viaCLI(_ cli: String, model: String, system: String, prompt: String) async throws -> String {
        var args = ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence", "--system-prompt", system]
        if !model.isEmpty { args += ["--model", model] }
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        let r = try await Shell.run(cli, args, cwd: FileManager.default.temporaryDirectory, env: env,
                                    input: prompt, timeout: 300)
        let out = r.output.trimmed
        guard r.status == 0, !out.isEmpty else {
            let err = r.stderr.trimmed
            throw ClaudeError.failed(!err.isEmpty ? err : (!out.isEmpty ? out : "Claude Code 가 응답하지 않았습니다(종료 코드 \(r.status))."))
        }
        return out
    }

    private struct APIResponse: Decodable {
        struct Block: Decodable { let type: String; let text: String? }
        let content: [Block]
        let stopReason: String?
    }

    private static func viaAPI(key: String, model: String, system: String, prompt: String, effort: String) async throws -> String {
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!, timeoutInterval: 300)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        var body: [String: Any] = [
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "messages": [["role": "user", "content": prompt]],
            "output_config": ["effort": effort],
        ]
        // 안전 분류기가 거절하면 서버가 권장 모델로 다시 시도한다(Haiku 는 서버 측 대체가 없어 보내지 않음)
        if model != "claude-haiku-5-5" {
            body["fallbacks"] = "default"
            req.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let msg = (obj?["error"] as? [String: Any])?["message"] as? String ?? String(decoding: data.prefix(300), as: UTF8.self)
            throw ClaudeError.failed(code == 401 ? "API 키가 올바르지 않습니다(401)." : "HTTP \(code): \(msg)")
        }
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let r = try d.decode(APIResponse.self, from: data)
        if r.stopReason == "refusal" { throw ClaudeError.refused }
        let text = r.content.filter { $0.type == "text" }.compactMap(\.text).joined().trimmed
        guard !text.isEmpty else { throw ClaudeError.failed("빈 응답") }
        return text
    }

    // MARK: 프롬프트

    enum Prompts {
        static let commit = """
        You write git commit messages for the staged changes the user sends.
        Reply with the commit message only: no preamble, no code fences, no quotation marks.
        First line: a concise summary of at most 72 characters in the imperative mood.
        If the change needs explanation, add a blank line and a short body saying what changed and why.
        Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in Korean.
        """

        static let explain = """
        You explain a git commit to a developer who is reviewing the history. Answer in Korean.
        Start with one sentence on what the commit does. Then list the key changes as short "-" bullets, naming files and functions.
        End with anything risky or worth a closer look, or say that nothing stands out.
        Be concrete and brief. Plain text only, no headings.
        """

        static let pullRequest = """
        You write pull request descriptions from the commits and diff the user sends.
        Reply in exactly this shape: the first line is the title (at most 72 characters, no "Title:" prefix), then a blank line, then the description in Markdown.
        The description has a short summary paragraph, a bulleted list of the main changes, and a short note on how to test if the changes suggest one.
        Use the same language as the commit messages; if unclear, write in Korean. Output nothing else.
        """
    }

    /// 너무 긴 입력은 앞부분만 보내고, 잘렸으면 생략한 글자 수를 돌려준다.
    static func clip(_ s: String, limit: Int = 400_000) -> (text: String, omitted: Int) {
        guard s.count > limit else { return (s, 0) }
        let head = String(s.prefix(limit))
        return (head + "\n\n[... 이후 \(s.count - limit)자 생략 ...]", s.count - limit)
    }

    /// 첫 줄(요약/제목)과 나머지(본문)로 나눈다. 코드 펜스·따옴표로 감쌌으면 벗긴다.
    static func split(_ text: String) -> (String, String) {
        var t = text.trimmed
        if t.hasPrefix("```") {
            t = t.split(separator: "\n", omittingEmptySubsequences: false).dropFirst().joined(separator: "\n")
            if t.hasSuffix("```") { t = String(t.dropLast(3)) }
            t = t.trimmed
        }
        let lines = t.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        var first = lines.first?.trimmed ?? ""
        if first.count > 1, first.hasPrefix("\""), first.hasSuffix("\"") { first = String(first.dropFirst().dropLast()) }
        return (first, lines.count > 1 ? lines[1].trimmed : "")
    }
}

/// 터미널(Terminal.app)에서 폴더 열기·Claude Code 실행
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
        guard let t = terminal else { throw ClaudeError.failed("Terminal 앱을 찾지 못했습니다.") }
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
