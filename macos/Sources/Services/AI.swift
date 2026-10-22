import Foundation
import Observation

enum AIError: LocalizedError {
    case notConfigured(String)
    case refused(String)
    case failed(String, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured(let m): return m
        case .refused(let who): return "\(who) 가 이 요청을 거절했습니다. 내용을 바꿔 다시 시도해 보세요."
        case .failed(let who, let m): return "\(who) 응답 실패: \(m)"
        }
    }
}

/// 글 작성(커밋 메시지·커밋 설명·PR 본문)에 쓰는 AI.
/// CLI 는 이 맥에 로그인한 계정을 그대로 쓰고(도구는 끈 채 글만), API 는 키로 직접 부른다.
enum AIProvider: String, CaseIterable, Identifiable {
    case claudeCode, codex, geminiCli, anthropic, openai, gemini, compatible
    var id: String { rawValue }

    var title: String {
        switch self {
        case .claudeCode: return "Claude Code (로그인 사용)"
        case .codex: return "Codex (ChatGPT 로그인 사용)"
        case .geminiCli: return "Gemini CLI (Google 로그인 사용)"
        case .anthropic: return "Claude API (Anthropic)"
        case .openai: return "ChatGPT API (OpenAI)"
        case .gemini: return "Gemini API (Google)"
        case .compatible: return "OpenAI 호환 (Ollama·LM Studio·OpenRouter 등)"
        }
    }

    /// 버튼 문구용: "Claude로 작성"
    var short: String {
        switch self {
        case .claudeCode, .anthropic: return "Claude"
        case .codex, .openai: return "ChatGPT"
        case .geminiCli, .gemini: return "Gemini"
        case .compatible: return "AI"
        }
    }

    var isCLI: Bool { tool != nil }

    var tool: ToolID? {
        switch self {
        case .claudeCode: return .claude
        case .codex: return .codex
        case .geminiCli: return .gemini
        default: return nil
        }
    }

    var defaultModel: String {
        switch self {
        case .anthropic: return "claude-opus-5-5"
        case .openai: return "gpt-5"
        case .gemini: return "gemini-2.5-flash"
        default: return ""
        }
    }

    var modelHint: String {
        isCLI ? "비우면 기본값" : (self == .compatible ? "llama3.1, qwen2.5-coder …" : defaultModel)
    }

    var keyHint: String {
        switch self {
        case .anthropic: return "sk-ant-…"
        case .openai: return "sk-…"
        case .gemini: return "AIza…"
        default: return "필요할 때만"
        }
    }

    var keyURL: String? {
        switch self {
        case .anthropic: return "https://console.anthropic.com/settings/keys"
        case .openai: return "https://platform.openai.com/api-keys"
        case .gemini: return "https://aistudio.google.com/apikey"
        default: return nil
        }
    }

    var note: String {
        switch self {
        case .claudeCode: return "이 맥에서 로그인한 Claude Code 를 그대로 씁니다. 도구는 모두 끈 채 글만 생성합니다."
        case .codex: return "이 맥에서 ChatGPT 계정으로 로그인한 Codex CLI 를 읽기 전용으로 실행해 글만 받습니다."
        case .geminiCli: return "이 맥에서 로그인한 Gemini CLI 를 읽기 전용(plan) 모드로 실행해 글만 받습니다."
        case .anthropic: return "요청이 안전 분류기에 막히면 서버가 권장 모델로 한 번 더 시도하도록(fallbacks) 켜 두었습니다."
        case .openai: return "OpenAI API 키로 Chat Completions 를 부릅니다."
        case .gemini: return "Google AI Studio API 키로 Gemini 를 부릅니다."
        case .compatible: return "OpenAI 형식(/chat/completions)을 받는 서버라면 무엇이든 됩니다. 예: Ollama http://localhost:11434/v1"
        }
    }
}

/// AI 를 쓰는 기능. 기능마다 규칙(지시사항)과 쓸 AI 를 따로 정할 수 있다.
enum AIFeature: String, CaseIterable, Identifiable {
    case commit, explain, pullRequest
    var id: String { rawValue }
}

/// 규칙을 적는 칸: 공통 + 기능별
enum InstructionKey: String, CaseIterable, Identifiable {
    case global, commit, explain, pullRequest
    var id: String { rawValue }

    var feature: AIFeature? { AIFeature(rawValue: rawValue) }

    var title: String {
        switch self {
        case .global: return "공통 규칙"
        case .commit: return "커밋 메시지 작성 · 나눠서 커밋"
        case .explain: return "커밋 설명"
        case .pullRequest: return "PR·MR 설명"
        }
    }

    var detail: String {
        switch self {
        case .global: return "아래 기능마다 따로 적은 규칙과 함께 모든 AI 기능에 적용됩니다."
        case .commit: return "커밋 메시지를 쓰거나 변경을 여러 커밋으로 나눌 때 따릅니다."
        case .explain: return "커밋·변경 내용을 설명할 때 따릅니다."
        case .pullRequest: return "Pull/Merge Request 제목과 본문을 쓸 때 따릅니다."
        }
    }

    var chips: [String] {
        switch self {
        case .global: return ["한국어로 작성", "영어로 작성", "간결하게", "명령형으로", "기술적인 말투", "부드러운 말투"]
        case .commit: return ["Conventional Commits 형식(feat: …)", "prefix 는 Feature, Fix, Hotfix, Refactoring, Style, Chore, Remove 중 하나",
                              "prefix 의 첫 글자는 대문자", "제목 50자 이내", "이슈 번호 포함", "본문 없이 제목만", "무엇을·왜 바꿨는지 중심으로"]
        case .explain: return ["업무에 주는 영향 위주로", "글머리표로", "영향받는 부분 포함", "초보자도 알기 쉽게"]
        case .pullRequest: return ["변경 이유를 먼저", "테스트 방법 포함", "체크리스트 형식", "관련 이슈 번호 포함", "스크린샷 자리 남기기"]
        }
    }
}

@MainActor @Observable
final class AIStore {
    static let shared = AIStore()

    var provider: AIProvider {
        didSet { UserDefaults.standard.set(provider.rawValue, forKey: "aiProvider") }
    }
    private(set) var models: [String: String]
    private(set) var baseURL: String
    private(set) var hasKey: [String: Bool]
    /// 사용자가 적은 규칙(공통·기능별)
    private(set) var instructions: [String: String]
    /// 기능별로 다른 AI 를 쓰고 싶을 때(없으면 기본 AI)
    private(set) var featureProvider: [String: String]
    private var keys: [String: String] = [:]

    private init() {
        let d = UserDefaults.standard
        // 예전 설정(Claude 만 있던 때)을 옮긴다
        if d.string(forKey: "aiProvider") == nil, let old = d.string(forKey: "claudeMode") {
            d.set(old == "api" ? AIProvider.anthropic.rawValue : AIProvider.claudeCode.rawValue, forKey: "aiProvider")
            d.set(["anthropic": d.string(forKey: "claudeModel") ?? "claude-opus-5-5", "claudeCode": d.string(forKey: "claudeCLIModel") ?? ""],
                  forKey: "aiModels")
            if d.bool(forKey: "hasClaudeKey"), let k = Keychain.get("anthropic") {
                Keychain.set(k, for: "ai:anthropic")
                d.set(["anthropic": true], forKey: "aiKeys")
            }
        }
        models = d.dictionary(forKey: "aiModels") as? [String: String] ?? [:]
        baseURL = d.string(forKey: "aiBaseURL") ?? "http://localhost:11434/v1"
        hasKey = d.dictionary(forKey: "aiKeys") as? [String: Bool] ?? [:]
        instructions = d.dictionary(forKey: "aiInstructions") as? [String: String] ?? [:]
        featureProvider = d.dictionary(forKey: "aiFeatureProvider") as? [String: String] ?? [:]
        if let saved = d.string(forKey: "aiProvider").flatMap(AIProvider.init(rawValue:)) {
            provider = saved
        } else {
            // 처음 켰을 때: 설치된 CLI 가 있으면 그걸로
            let tools = ToolStore.shared
            provider = AIProvider.allCases.first { $0.tool.map { tools.path($0) != nil } ?? false } ?? .anthropic
        }
    }

    var short: String { provider.short }

    func provider(for f: AIFeature) -> AIProvider {
        featureProvider[f.rawValue].flatMap(AIProvider.init(rawValue:)) ?? provider
    }

    func short(for f: AIFeature) -> String { provider(for: f).short }

    func setFeatureProvider(_ f: AIFeature, _ p: AIProvider?) {
        featureProvider[f.rawValue] = p?.rawValue
        UserDefaults.standard.set(featureProvider, forKey: "aiFeatureProvider")
    }

    func instruction(_ k: InstructionKey) -> String { instructions[k.rawValue] ?? "" }

    func setInstruction(_ k: InstructionKey, _ text: String) {
        instructions[k.rawValue] = text
        UserDefaults.standard.set(instructions, forKey: "aiInstructions")
    }

    /// 기본 지시 + 사용자가 적은 규칙(공통 → 기능별). 규칙이 기본 지시보다 우선한다.
    func system(for f: AIFeature, base: String) -> String {
        let rules = [instruction(.global), instructions[f.rawValue] ?? ""].map(\.trimmed).filter { !$0.isEmpty }
        guard !rules.isEmpty else { return base }
        return base + "\n\nThe user set the following rules. Follow them exactly; they take priority over the style guidance above (for example the language, prefixes, and format):\n" + rules.joined(separator: "\n")
    }

    /// 기능 하나 실행: 그 기능의 AI·규칙으로
    func write(_ f: AIFeature, base: String, prompt: String, effort: String) async throws -> String {
        try await complete(system: system(for: f, base: base), prompt: prompt, effort: effort, using: provider(for: f))
    }

    func model(_ p: AIProvider) -> String { models[p.rawValue] ?? p.defaultModel }

    func setModel(_ p: AIProvider, _ m: String) {
        models[p.rawValue] = m.trimmed
        UserDefaults.standard.set(models, forKey: "aiModels")
    }

    func setBaseURL(_ s: String) {
        var v = s.trimmed
        while v.hasSuffix("/") { v.removeLast() }
        baseURL = v
        UserDefaults.standard.set(v, forKey: "aiBaseURL")
    }

    func setKey(_ p: AIProvider, _ key: String) {
        let k = key.trimmed
        Keychain.set(k.isEmpty ? nil : k, for: "ai:" + p.rawValue)
        keys[p.rawValue] = k.isEmpty ? nil : k
        hasKey[p.rawValue] = !k.isEmpty
        UserDefaults.standard.set(hasKey, forKey: "aiKeys")
    }

    private func key(_ p: AIProvider) -> String? {
        guard hasKey[p.rawValue] == true else { return nil }
        if let k = keys[p.rawValue] { return k }
        let k = Keychain.get("ai:" + p.rawValue)
        keys[p.rawValue] = k
        return k
    }

    /// 쓸 수 없는 이유(되면 nil)
    func problem(_ p: AIProvider) -> String? {
        if let tool = p.tool {
            return ToolStore.shared.path(tool) == nil ? "\(tool.title) 를 찾지 못했습니다. 설정 > 도구에서 실행 파일을 불러오거나 설치하세요." : nil
        }
        if p == .compatible { return baseURL.isEmpty ? "서버 주소를 입력하세요." : nil }
        return hasKey[p.rawValue] == true ? nil : "설정 > AI 에서 \(p.title) 키를 입력하세요."
    }

    /// 글 한 번 생성. effort 는 Claude API 에서만 쓴다(low/medium/high).
    func complete(system: String, prompt: String, effort: String, using p: AIProvider? = nil) async throws -> String {
        let p = p ?? provider
        if let problem = problem(p) { throw AIError.notConfigured(problem) }
        let model = model(p)
        let tools = ToolStore.shared
        switch p {
        case .claudeCode:
            var args = ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence", "--system-prompt", system]
            if !model.isEmpty { args += ["--model", model] }
            return try await Self.cli(tools.path(.claude)!, args, stdin: prompt, name: "Claude Code")
        case .codex:
            var args = ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only"]
            if !model.isEmpty { args += ["-m", model] }
            return try await Self.cli(tools.path(.codex)!, args + ["-"], stdin: "\(system)\n\n---\n\n\(prompt)", name: "Codex")
        case .geminiCli:
            // -p 의 글은 표준 입력 뒤에 붙는다: 내용(표준 입력) 다음에 지시(시스템 프롬프트)
            var args = ["-p", system, "-o", "text", "--approval-mode", "plan"]
            if !model.isEmpty { args += ["-m", model] }
            return try await Self.cli(tools.path(.gemini)!, args, stdin: prompt, name: "Gemini CLI")
        case .anthropic:
            return try await Self.anthropic(key: key(p)!, model: model, system: system, prompt: prompt, effort: effort)
        case .openai:
            return try await Self.chat(base: "https://api.openai.com/v1", key: key(p), model: model, system: system, prompt: prompt, name: "ChatGPT")
        case .compatible:
            return try await Self.chat(base: baseURL, key: key(p), model: model, system: system, prompt: prompt, name: "AI 서버")
        case .gemini:
            return try await Self.gemini(key: key(p)!, model: model, system: system, prompt: prompt)
        }
    }

    // MARK: 방식별

    private static func cli(_ exe: String, _ args: [String], stdin: String, name: String) async throws -> String {
        var env = ProcessInfo.processInfo.environment
        let dir = (exe as NSString).deletingLastPathComponent
        env["PATH"] = "\(dir):\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        let r = try await Shell.run(exe, args, cwd: FileManager.default.temporaryDirectory, env: env, input: stdin, timeout: 300)
        let out = r.output.trimmed
        guard r.status == 0, !out.isEmpty else {
            let err = r.stderr.trimmed.split(separator: "\n").suffix(6).joined(separator: "\n")
            throw AIError.failed(name, !err.isEmpty ? err : (!out.isEmpty ? out : "응답이 없습니다(종료 코드 \(r.status))."))
        }
        return out
    }

    private static func post(_ url: String, headers: [String: String], body: [String: Any]) async throws -> (Int, Data) {
        guard let u = URL(string: url) else { throw AIError.notConfigured("주소가 올바르지 않습니다: \(url)") }
        var req = URLRequest(url: u, timeoutInterval: 300)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    private static func get(_ url: String, headers: [String: String]) async throws -> (Int, Data) {
        guard let u = URL(string: url) else { throw AIError.notConfigured("주소가 올바르지 않습니다: \(url)") }
        var req = URLRequest(url: u, timeoutInterval: 30)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    private static func apiError(_ who: String, _ code: Int, _ data: Data) -> Error {
        let obj = try? JSONSerialization.jsonObject(with: data)
        let msg = ((obj as? [String: Any])?["error"] as? [String: Any])?["message"] as? String
            ?? ((obj as? [[String: Any]])?.first?["error"] as? [String: Any])?["message"] as? String
            ?? String(decoding: data.prefix(300), as: UTF8.self)
        switch code {
        case 401, 403: return AIError.failed(who, "API 키가 올바르지 않거나 권한이 없습니다(\(code)). \(msg)")
        case 404: return AIError.failed(who, "모델이나 주소를 찾을 수 없습니다(404). 모델 이름을 확인하세요. \(msg)")
        case 429: return AIError.failed(who, "사용 한도에 걸렸습니다(429). 잠시 뒤 다시 시도하세요. \(msg)")
        default: return AIError.failed(who, "HTTP \(code) — \(msg)")
        }
    }

    private static func anthropic(key: String, model: String, system: String, prompt: String, effort: String) async throws -> String {
        var headers = ["x-api-key": key, "anthropic-version": "2023-06-01"]
        var body: [String: Any] = [
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "messages": [["role": "user", "content": prompt]],
            "output_config": ["effort": effort],
        ]
        // 안전 분류기가 거절하면 서버가 권장 모델로 다시 시도한다(Haiku 는 서버 측 대체가 없어 보내지 않음)
        if !model.contains("haiku") {
            body["fallbacks"] = "default"
            headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
        }
        let (code, data) = try await post("https://api.anthropic.com/v1/messages", headers: headers, body: body)
        guard code == 200 else { throw apiError("Claude", code, data) }
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        if obj["stop_reason"] as? String == "refusal" { throw AIError.refused("Claude") }
        let text = (obj["content"] as? [[String: Any]] ?? []).filter { $0["type"] as? String == "text" }
            .compactMap { $0["text"] as? String }.joined().trimmed
        guard !text.isEmpty else { throw AIError.failed("Claude", "빈 응답") }
        return text
    }

    private static func chat(base: String, key: String?, model: String, system: String, prompt: String, name: String) async throws -> String {
        guard !model.isEmpty else { throw AIError.notConfigured("\(name): 모델을 정하세요(설정 > AI).") }
        var headers: [String: String] = [:]
        if let key { headers["authorization"] = "Bearer \(key)" }
        let body: [String: Any] = ["model": model, "messages": [["role": "system", "content": system], ["role": "user", "content": prompt]]]
        var b = base
        while b.hasSuffix("/") { b.removeLast() }
        let (code, data) = try await post(b + "/chat/completions", headers: headers, body: body)
        guard code == 200 else { throw apiError(name, code, data) }
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let msg = ((obj["choices"] as? [[String: Any]])?.first?["message"]) as? [String: Any]
        if let refusal = msg?["refusal"] as? String, !refusal.isEmpty { throw AIError.refused(name) }
        let text = (msg?["content"] as? String ?? "").trimmed
        guard !text.isEmpty else { throw AIError.failed(name, "빈 응답") }
        return text
    }

    private static func gemini(key: String, model: String, system: String, prompt: String) async throws -> String {
        let body: [String: Any] = [
            "systemInstruction": ["parts": [["text": system]]],
            "contents": [["role": "user", "parts": [["text": prompt]]]],
        ]
        let m = model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model
        let (code, data) = try await post("https://generativelanguage.googleapis.com/v1beta/models/\(m):generateContent",
                                          headers: ["x-goog-api-key": key], body: body)
        guard code == 200 else { throw apiError("Gemini", code, data) }
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        if ((obj["promptFeedback"] as? [String: Any])?["blockReason"]) != nil { throw AIError.refused("Gemini") }
        let cand = (obj["candidates"] as? [[String: Any]])?.first
        let parts = ((cand?["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
        let text = parts.compactMap { $0["text"] as? String }.joined().trimmed
        guard !text.isEmpty else {
            throw cand?["finishReason"] as? String == "SAFETY" ? AIError.refused("Gemini") : AIError.failed("Gemini", "빈 응답")
        }
        return text
    }

    /// 계정에서 쓸 수 있는 모델 목록(API 방식)
    func listModels(_ p: AIProvider) async throws -> [String] {
        let k = key(p)
        func ids(_ data: Data, field: String = "data") -> [[String: Any]] {
            ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?[field] as? [[String: Any]] ?? []
        }
        switch p {
        case .anthropic:
            guard let k else { throw AIError.notConfigured("먼저 API 키를 저장하세요.") }
            let (code, data) = try await Self.get("https://api.anthropic.com/v1/models?limit=100", headers: ["x-api-key": k, "anthropic-version": "2023-06-01"])
            guard code == 200 else { throw Self.apiError("Claude", code, data) }
            return ids(data).compactMap { $0["id"] as? String }
        case .openai, .compatible:
            if p == .openai, k == nil { throw AIError.notConfigured("먼저 API 키를 저장하세요.") }
            var base = p == .openai ? "https://api.openai.com/v1" : baseURL
            while base.hasSuffix("/") { base.removeLast() }
            let (code, data) = try await Self.get(base + "/models", headers: k.map { ["authorization": "Bearer \($0)"] } ?? [:])
            guard code == 200 else { throw Self.apiError(p == .openai ? "ChatGPT" : "AI 서버", code, data) }
            var list = ids(data).compactMap { $0["id"] as? String }
            if p == .openai {
                // 글 생성 모델만(임베딩·음성·이미지 제외)
                list = list.filter { m in
                    (m.hasPrefix("gpt") || m.hasPrefix("chatgpt") || m.range(of: "^o[0-9]", options: .regularExpression) != nil)
                        && !["audio", "realtime", "transcribe", "tts", "image", "embedding", "search"].contains { m.contains($0) }
                }
            }
            return list.sorted { $0.localizedStandardCompare($1) == .orderedDescending }
        case .gemini:
            guard let k else { throw AIError.notConfigured("먼저 API 키를 저장하세요.") }
            let (code, data) = try await Self.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers: ["x-goog-api-key": k])
            guard code == 200 else { throw Self.apiError("Gemini", code, data) }
            return ids(data, field: "models")
                .filter { ($0["supportedGenerationMethods"] as? [String] ?? []).contains("generateContent") }
                .compactMap { ($0["name"] as? String)?.replacingOccurrences(of: "models/", with: "") }
                .sorted { $0.localizedStandardCompare($1) == .orderedDescending }
        default:
            return []
        }
    }
}
