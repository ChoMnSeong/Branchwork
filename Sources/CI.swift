import SwiftUI
import Foundation

// MARK: - 모델

/// 파이프라인·작업 상태(GitLab status 와 GitHub status+conclusion 을 하나로)
enum CIStatus: String, Hashable {
    case created, waiting, pending, running, success, failed, canceled, skipped, manual, scheduled, neutral, unknown

    init(gitlab s: String) {
        switch s {
        case "created": self = .created
        case "waiting_for_resource", "preparing", "waiting_for_callback": self = .waiting
        case "pending": self = .pending
        case "running": self = .running
        case "success": self = .success
        case "failed": self = .failed
        case "canceled", "canceling": self = .canceled
        case "skipped": self = .skipped
        case "manual": self = .manual
        case "scheduled": self = .scheduled
        default: self = .unknown
        }
    }

    init(github status: String?, conclusion: String?) {
        switch status {
        case "queued", "requested", "pending": self = .pending
        case "waiting": self = .waiting           // 환경 보호 규칙의 승인 대기
        case "in_progress": self = .running
        case "completed":
            switch conclusion {
            case "success": self = .success
            case "failure", "timed_out", "startup_failure": self = .failed
            case "cancelled": self = .canceled
            case "skipped": self = .skipped
            case "action_required": self = .manual
            case "neutral", "stale": self = .neutral
            default: self = .unknown
            }
        default: self = .unknown
        }
    }

    var title: String {
        switch self {
        case .created: return "생성됨"
        case .waiting: return "대기 중"
        case .pending: return "대기열"
        case .running: return "실행 중"
        case .success: return "성공"
        case .failed: return "실패"
        case .canceled: return "취소됨"
        case .skipped: return "건너뜀"
        case .manual: return "수동 실행 대기"
        case .scheduled: return "예약됨"
        case .neutral: return "완료"
        case .unknown: return "알 수 없음"
        }
    }

    var symbol: String {
        switch self {
        case .created, .pending: return "circle.dashed"
        case .waiting: return "pause.circle.fill"
        case .running: return "arrow.triangle.2.circlepath.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .canceled: return "slash.circle.fill"
        case .skipped: return "forward.circle"
        case .manual: return "hand.tap.fill"
        case .scheduled: return "clock.fill"
        case .neutral, .unknown: return "circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .success: return .green
        case .failed: return .red
        case .running: return .blue
        case .waiting, .manual: return .orange
        case .scheduled: return .purple
        default: return .secondary
        }
    }

    /// 아직 끝나지 않아 자주 새로 고쳐야 하는 상태
    var isActive: Bool { [.created, .waiting, .pending, .running].contains(self) }
    var isFinished: Bool { [.success, .failed, .canceled, .skipped, .neutral].contains(self) }
}

/// GitLab 파이프라인 / GitHub Actions 실행
struct CIPipeline: Identifiable, Hashable {
    let id: Int
    /// GitLab iid / GitHub run_number
    let number: Int
    /// GitHub 워크플로 이름, GitLab 파이프라인 이름(있으면)
    let name: String
    /// GitHub: 커밋 메시지·PR 제목. GitLab 은 없어서 화면에서 로컬 커밋 제목으로 채운다
    let title: String
    let ref: String
    let sha: String
    let status: CIStatus
    let url: String
    let created: Date?
    /// push, web, schedule, workflow_dispatch …
    let event: String
    let actor: String?

    var eventTitle: String {
        switch event {
        case "push": return "push"
        case "web", "workflow_dispatch": return "수동"
        case "schedule": return "예약"
        case "merge_request_event", "pull_request", "pull_request_target": return "MR·PR"
        case "api": return "API"
        case "trigger", "repository_dispatch": return "트리거"
        case "parent_pipeline", "pipeline", "workflow_run": return "연결"
        default: return event
        }
    }
}

struct CIJob: Identifiable, Hashable {
    let id: Int
    let name: String
    /// GitLab 단계(GitHub 은 빈 문자열)
    let stage: String
    let status: CIStatus
    let url: String
    let allowFailure: Bool
    let duration: Double?

    /// GitLab 수동 작업(when: manual)·지연 작업(when: delayed)은 바로 실행할 수 있다
    var canPlay: Bool { status == .manual || status == .scheduled }
}

/// GitHub 환경 보호 규칙 때문에 승인을 기다리는 배포
struct CIDeployment: Identifiable, Hashable {
    let environmentID: Int
    let environment: String
    let canApprove: Bool
    var id: Int { environmentID }
}

/// "Run workflow" 버튼이 있는(workflow_dispatch) GitHub 워크플로
struct CIWorkflow: Identifiable, Hashable {
    let id: Int
    let name: String
    let path: String
    var inputs: [CIInput]
}

/// workflow_dispatch 입력값 / GitLab 파이프라인 변수(.gitlab-ci.yml 에 설명이 있는 변수)
struct CIInput: Identifiable, Hashable {
    let name: String
    let description: String
    let required: Bool
    let defaultValue: String
    /// string, boolean, choice, number, environment
    let type: String
    let options: [String]
    var id: String { name }
}

// MARK: - 작은 YAML 읽기

/// 워크플로 입력값·파이프라인 변수를 읽을 만큼만 하는 YAML(블록 맵·목록·[a, b]·따옴표·| > 여러 줄 글)
enum MiniYAML {
    indirect enum Node {
        case scalar(String)
        case map([(String, Node)])
        case list([Node])

        subscript(key: String) -> Node? {
            if case .map(let pairs) = self { return pairs.first { $0.0 == key }?.1 }
            return nil
        }
        var string: String? {
            if case .scalar(let s) = self { return s }
            return nil
        }
        var pairs: [(String, Node)] {
            if case .map(let p) = self { return p }
            return []
        }
        var items: [Node] {
            if case .list(let l) = self { return l }
            return []
        }
    }

    private struct Line { let indent: Int; let text: String; let raw: String; let blank: Bool }

    static func parse(_ text: String) -> Node {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map { sub -> Line in
            let raw = String(sub).replacingOccurrences(of: "\t", with: "  ")
            let body = stripComment(raw)
            let trimmed = body.trimmingCharacters(in: .whitespaces)
            let indent = raw.prefix { $0 == " " }.count
            return Line(indent: indent, text: trimmed, raw: raw, blank: trimmed.isEmpty || trimmed == "---")
        }
        var i = 0
        skipBlank(lines, &i)
        guard i < lines.count else { return .map([]) }
        return block(lines, &i, lines[i].indent)
    }

    /// 따옴표 밖의 " #" 뒤는 주석
    private static func stripComment(_ s: String) -> String {
        var quote: Character?
        var prev: Character = " "
        for (n, c) in s.enumerated() {
            if let q = quote {
                if c == q { quote = nil }
            } else if c == "'" || c == "\"" {
                quote = c
            } else if c == "#", prev == " " || prev == "\t" || n == 0 {
                return String(s.prefix(n))
            }
            prev = c
        }
        return s
    }

    private static func skipBlank(_ lines: [Line], _ i: inout Int) {
        while i < lines.count, lines[i].blank { i += 1 }
    }

    private static func isItem(_ t: String) -> Bool { t == "-" || t.hasPrefix("- ") }

    private static func block(_ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        isItem(lines[i].text) ? list(lines, &i, indent) : map(lines, &i, indent)
    }

    /// "key: value" → (key, value). 값이 없으면 value 는 빈 문자열.
    private static func splitKey(_ t: String) -> (String, String)? {
        var quote: Character?
        let chars = Array(t)
        for n in chars.indices {
            let c = chars[n]
            if let q = quote {
                if c == q { quote = nil }
                continue
            }
            if (c == "'" || c == "\"") && n == 0 { quote = c; continue }
            if c == ":" && (n == chars.count - 1 || chars[n + 1] == " ") {
                let key = unquote(String(chars[..<n]).trimmingCharacters(in: .whitespaces))
                let value = n == chars.count - 1 ? "" : String(chars[(n + 1)...]).trimmingCharacters(in: .whitespaces)
                return (key, value)
            }
        }
        return nil
    }

    private static func map(_ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        var pairs: [(String, Node)] = []
        while i < lines.count {
            let l = lines[i]
            if l.blank { i += 1; continue }
            if l.indent < indent || (l.indent == indent && isItem(l.text)) { break }
            if l.indent > indent { i += 1; continue }       // 예상 밖의 들여쓰기는 건너뜀
            guard let (key, value) = splitKey(l.text) else { i += 1; continue }
            i += 1
            pairs.append((key, valueNode(value, lines, &i, indent)))
        }
        return .map(pairs)
    }

    private static func list(_ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        var items: [Node] = []
        while i < lines.count {
            let l = lines[i]
            if l.blank { i += 1; continue }
            guard l.indent == indent, isItem(l.text) else {
                if l.indent > indent { i += 1; continue }
                break
            }
            let rest = String(l.text.dropFirst()).trimmingCharacters(in: .whitespaces)
            if rest.isEmpty {
                i += 1
                skipBlank(lines, &i)
                if i < lines.count, lines[i].indent > indent { items.append(block(lines, &i, lines[i].indent)) } else { items.append(.scalar("")) }
            } else if splitKey(rest) != nil, !rest.hasPrefix("[") , !rest.hasPrefix("{") {
                // "- key: value" 로 시작하는 맵: 그 줄을 맵의 첫 줄로 다시 읽는다
                let inner = indent + (l.text.count - rest.count)
                var copy = lines
                copy[i] = Line(indent: inner, text: rest, raw: l.raw, blank: false)
                var j = i
                items.append(map(copy, &j, inner))
                i = j
            } else {
                i += 1
                items.append(scalarNode(rest))
            }
        }
        return .list(items)
    }

    private static func valueNode(_ value: String, _ lines: [Line], _ i: inout Int, _ indent: Int) -> Node {
        if value.isEmpty {
            var j = i
            skipBlank(lines, &j)
            guard j < lines.count else { i = j; return .scalar("") }
            let next = lines[j]
            if next.indent > indent || (next.indent == indent && isItem(next.text)) {
                i = j
                return block(lines, &i, next.indent)
            }
            return .scalar("")
        }
        if let first = value.first, first == "|" || first == ">" {
            // 여러 줄 글: 더 깊이 들여쓴 줄을 모두
            var raws: [String] = []
            var minIndent = Int.max
            while i < lines.count, lines[i].blank || lines[i].indent > indent {
                let l = lines[i]
                if !l.raw.trimmingCharacters(in: .whitespaces).isEmpty { minIndent = min(minIndent, l.indent) }
                raws.append(l.raw)
                i += 1
            }
            let cut = minIndent == .max ? 0 : minIndent
            let body = raws.map { $0.count >= cut ? String($0.dropFirst(cut)) : "" }
            let joined = first == "|" ? body.joined(separator: "\n") : body.joined(separator: " ")
            return .scalar(joined.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return scalarNode(value)
    }

    private static func scalarNode(_ v: String) -> Node {
        if v.hasPrefix("[") && v.hasSuffix("]") {
            let inner = v.dropFirst().dropLast()
            return .list(splitFlow(String(inner)).map { .scalar(unquote($0)) })
        }
        if v.hasPrefix("{") && v.hasSuffix("}") {
            let inner = v.dropFirst().dropLast()
            return .map(splitFlow(String(inner)).compactMap { part in
                splitKey(part).map { ($0.0, .scalar(unquote($0.1))) } ?? (unquote(part), .scalar(""))
            })
        }
        return .scalar(unquote(v))
    }

    /// "a, 'b, c', d" → ["a", "'b, c'", "d"]
    private static func splitFlow(_ s: String) -> [String] {
        var parts: [String] = [], cur = "", quote: Character?
        for c in s {
            if let q = quote {
                if c == q { quote = nil }
                cur.append(c)
            } else if c == "'" || c == "\"" {
                quote = c
                cur.append(c)
            } else if c == "," {
                parts.append(cur.trimmingCharacters(in: .whitespaces))
                cur = ""
            } else {
                cur.append(c)
            }
        }
        let last = cur.trimmingCharacters(in: .whitespaces)
        if !last.isEmpty { parts.append(last) }
        return parts.filter { !$0.isEmpty }
    }

    static func unquote(_ s: String) -> String {
        if s.count >= 2, s.hasPrefix("'"), s.hasSuffix("'") {
            return String(s.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
        }
        if s.count >= 2, s.hasPrefix("\""), s.hasSuffix("\"") {
            return String(s.dropFirst().dropLast())
                .replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\\"", with: "\"")
                .replacingOccurrences(of: "\\\\", with: "\\")
        }
        return s
    }

    // MARK: 쓰임새

    /// GitHub 워크플로 파일: workflow_dispatch 가 있으면 그 입력값(없으면 nil)
    static func dispatchInputs(_ text: String) -> [CIInput]? {
        let root = parse(text)
        guard let on = root["on"] ?? root["true"] else { return nil }
        switch on {
        case .scalar(let s): return s == "workflow_dispatch" ? [] : nil
        case .list(let l): return l.contains { $0.string == "workflow_dispatch" } ? [] : nil
        case .map:
            guard let wd = on["workflow_dispatch"] else { return nil }
            return (wd["inputs"]?.pairs ?? []).map { name, spec in
                let type = spec["type"]?.string ?? "string"
                return CIInput(name: name, description: spec["description"]?.string ?? "",
                               required: spec["required"]?.string == "true",
                               defaultValue: spec["default"]?.string ?? "", type: type,
                               options: (spec["options"]?.items ?? []).compactMap(\.string))
            }
        }
    }

    /// .gitlab-ci.yml: 설명이 있는 전역 변수(GitLab 의 "파이프라인 실행" 화면에 미리 채워지는 것)
    static func pipelineVariables(_ text: String) -> [CIInput] {
        (parse(text)["variables"]?.pairs ?? []).compactMap { name, spec in
            guard case .map = spec, let desc = spec["description"]?.string else { return nil }
            let options = (spec["options"]?.items ?? []).compactMap(\.string)
            return CIInput(name: name, description: desc, required: false, defaultValue: spec["value"]?.string ?? "",
                           type: options.isEmpty ? "string" : "choice", options: options)
        }
    }
}

// MARK: - API

/// GitLab 파이프라인 / GitHub Actions
enum CIAPI {
    private struct GLPipeline: Decodable {
        let id: Int; let iid: Int?; let sha: String; let ref: String; let status: String
        let source: String?; let createdAt: String?; let webUrl: String; let name: String?
        let user: GLUserRef?
    }
    private struct GLUserRef: Decodable { let username: String }
    private struct GLJob: Decodable {
        let id: Int; let name: String; let stage: String; let status: String; let webUrl: String
        let allowFailure: Bool?; let duration: Double?
    }
    private struct GHRuns: Decodable { let workflowRuns: [GHRun] }
    private struct GHRun: Decodable {
        let id: Int; let name: String?; let displayTitle: String?; let runNumber: Int; let headBranch: String?
        let headSha: String; let status: String?; let conclusion: String?; let htmlUrl: String
        let createdAt: String?; let event: String; let actor: GHActor?
    }
    private struct GHActor: Decodable { let login: String }
    private struct GHJobs: Decodable { let jobs: [GHJob] }
    private struct GHJob: Decodable {
        let id: Int; let name: String; let status: String?; let conclusion: String?; let htmlUrl: String?
        let startedAt: String?; let completedAt: String?
    }
    private struct GHWorkflows: Decodable { let workflows: [GHWorkflow] }
    private struct GHWorkflow: Decodable { let id: Int; let name: String; let path: String; let state: String }
    private struct GHContent: Decodable { let content: String? }
    private struct GHPending: Decodable { let environment: GHEnv; let currentUserCanApprove: Bool? }
    private struct GHEnv: Decodable { let id: Int; let name: String? }

    private static func project(_ t: RepoTarget, _ base: String) -> String {
        base + "/projects/\(Hosting.projectID(t.path))"
    }

    private static func repo(_ t: RepoTarget, _ base: String) -> String {
        base + "/repos/\(t.path)"
    }

    private static func q(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    /// 최근 파이프라인·실행(ref 가 있으면 그 브랜치만)
    static func pipelines(_ t: RepoTarget, token: String, apiBase: String, ref: String?) async throws -> [CIPipeline] {
        switch t.provider {
        case .gitlab:
            let filter = ref.map { "&ref=\(q($0))" } ?? ""
            let req = try Hosting.request(.gitlab, project(t, apiBase) + "/pipelines?per_page=30\(filter)", token: token)
            return try await Hosting.send([GLPipeline].self, req).map {
                CIPipeline(id: $0.id, number: $0.iid ?? $0.id, name: $0.name ?? "", title: "", ref: $0.ref, sha: $0.sha,
                           status: CIStatus(gitlab: $0.status), url: $0.webUrl, created: Hosting.date($0.createdAt),
                           event: $0.source ?? "", actor: $0.user?.username)
            }
        case .github:
            let filter = ref.map { "&branch=\(q($0))" } ?? ""
            let req = try Hosting.request(.github, repo(t, apiBase) + "/actions/runs?per_page=30\(filter)", token: token)
            return try await Hosting.send(GHRuns.self, req).workflowRuns.map {
                CIPipeline(id: $0.id, number: $0.runNumber, name: $0.name ?? "", title: $0.displayTitle ?? "",
                           ref: $0.headBranch ?? "", sha: $0.headSha, status: CIStatus(github: $0.status, conclusion: $0.conclusion),
                           url: $0.htmlUrl, created: Hosting.date($0.createdAt), event: $0.event, actor: $0.actor?.login)
            }
        }
    }

    static func jobs(_ t: RepoTarget, token: String, apiBase: String, pipeline id: Int) async throws -> [CIJob] {
        switch t.provider {
        case .gitlab:
            let req = try Hosting.request(.gitlab, project(t, apiBase) + "/pipelines/\(id)/jobs?per_page=100", token: token)
            // 단계 순서 = 먼저 만들어진 작업 순서
            return try await Hosting.send([GLJob].self, req).sorted { $0.id < $1.id }.map {
                CIJob(id: $0.id, name: $0.name, stage: $0.stage, status: CIStatus(gitlab: $0.status), url: $0.webUrl,
                      allowFailure: $0.allowFailure ?? false, duration: $0.duration)
            }
        case .github:
            let req = try Hosting.request(.github, repo(t, apiBase) + "/actions/runs/\(id)/jobs?per_page=100&filter=latest", token: token)
            return try await Hosting.send(GHJobs.self, req).jobs.map { j in
                let start = Hosting.date(j.startedAt), end = Hosting.date(j.completedAt)
                return CIJob(id: j.id, name: j.name, stage: "", status: CIStatus(github: j.status, conclusion: j.conclusion),
                             url: j.htmlUrl ?? "", allowFailure: false,
                             duration: start.flatMap { s in end.map { $0.timeIntervalSince(s) } })
            }
        }
    }

    // MARK: 작업

    static func play(_ t: RepoTarget, token: String, apiBase: String, job: Int) async throws {
        try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/jobs/\(job)/play", token: token, method: "POST"))
    }

    static func retry(_ t: RepoTarget, token: String, apiBase: String, job: Int) async throws {
        switch t.provider {
        case .gitlab:
            try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/jobs/\(job)/retry", token: token, method: "POST"))
        case .github:
            try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/actions/jobs/\(job)/rerun", token: token, method: "POST"))
        }
    }

    static func cancel(_ t: RepoTarget, token: String, apiBase: String, job: Int) async throws {
        try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/jobs/\(job)/cancel", token: token, method: "POST"))
    }

    // MARK: 파이프라인

    static func retry(_ t: RepoTarget, token: String, apiBase: String, pipeline id: Int, failedOnly: Bool) async throws {
        switch t.provider {
        case .gitlab:
            // GitLab 은 실패·취소된 작업만 다시 실행한다
            try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/pipelines/\(id)/retry", token: token, method: "POST"))
        case .github:
            let path = failedOnly ? "rerun-failed-jobs" : "rerun"
            try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/actions/runs/\(id)/\(path)", token: token, method: "POST"))
        }
    }

    static func cancel(_ t: RepoTarget, token: String, apiBase: String, pipeline id: Int) async throws {
        switch t.provider {
        case .gitlab:
            try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/pipelines/\(id)/cancel", token: token, method: "POST"))
        case .github:
            try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/actions/runs/\(id)/cancel", token: token, method: "POST"))
        }
    }

    /// GitLab: 브랜치·변수로 새 파이프라인
    static func runPipeline(_ t: RepoTarget, token: String, apiBase: String, ref: String, variables: [(String, String)]) async throws {
        let vars = variables.map { ["key": $0.0, "value": $0.1, "variable_type": "env_var"] }
        try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/pipeline", token: token, method: "POST",
                                               body: ["ref": ref, "variables": vars]))
    }

    /// GitHub: workflow_dispatch 가 있는 워크플로(입력값 포함). 파일은 ref 의 것을 읽는다.
    static func workflows(_ t: RepoTarget, token: String, apiBase: String, ref: String) async throws -> [CIWorkflow] {
        let req = try Hosting.request(.github, repo(t, apiBase) + "/actions/workflows?per_page=100", token: token)
        let list = try await Hosting.send(GHWorkflows.self, req).workflows
            .filter { $0.state == "active" && $0.path.hasPrefix(".github/workflows/") }
        return await withTaskGroup(of: (Int, CIWorkflow?).self) { group in
            for (n, w) in list.enumerated() {
                group.addTask {
                    guard let r = try? Hosting.request(.github, repo(t, apiBase) + "/contents/\(w.path)?ref=\(q(ref))", token: token),
                          let c = try? await Hosting.send(GHContent.self, r), let b64 = c.content,
                          let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
                          let inputs = MiniYAML.dispatchInputs(String(decoding: data, as: UTF8.self)) else { return (n, nil) }
                    return (n, CIWorkflow(id: w.id, name: w.name, path: w.path, inputs: inputs))
                }
            }
            var out: [(Int, CIWorkflow)] = []
            for await (n, w) in group { if let w { out.append((n, w)) } }
            return out.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    static func dispatch(_ t: RepoTarget, token: String, apiBase: String, workflow: Int, ref: String, inputs: [String: String]) async throws {
        try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/actions/workflows/\(workflow)/dispatches", token: token,
                                               method: "POST", body: ["ref": ref, "inputs": inputs]))
    }

    static func pendingDeployments(_ t: RepoTarget, token: String, apiBase: String, run: Int) async throws -> [CIDeployment] {
        let req = try Hosting.request(.github, repo(t, apiBase) + "/actions/runs/\(run)/pending_deployments", token: token)
        return try await Hosting.send([GHPending].self, req).map {
            CIDeployment(environmentID: $0.environment.id, environment: $0.environment.name ?? "환경 \($0.environment.id)",
                         canApprove: $0.currentUserCanApprove ?? false)
        }
    }

    static func review(_ t: RepoTarget, token: String, apiBase: String, run: Int, environments: [Int], approve: Bool) async throws {
        try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/actions/runs/\(run)/pending_deployments", token: token,
                                               method: "POST", body: ["environment_ids": environments,
                                                                      "state": approve ? "approved" : "rejected",
                                                                      "comment": "Branchwork"]))
    }
}
