import Foundation

// MARK: - 모델

/// PR·MR 대화 한 줄(일반 댓글·코드 줄 댓글·리뷰 결과·시스템 기록)
struct ReviewComment: Identifiable, Hashable {
    enum Kind: Hashable { case comment, approved, changesRequested, system }
    let id: String
    let author: String
    let body: String
    let date: Date?
    /// 코드 줄 댓글이면 파일·줄
    var path: String?
    var line: Int?
    var kind: Kind = .comment
}

/// PR·MR 에서 바뀐 파일(패치 포함)
struct ReviewFile: Identifiable, Hashable {
    let path: String
    let oldPath: String?
    let kind: ChangeKind
    let additions: Int
    let deletions: Int
    /// 덩어리(@@)만 있는 패치. 바이너리·너무 큰 파일이면 nil
    let patch: String?
    var id: String { path }

    var change: FileChange { FileChange(path: path, oldPath: oldPath, kind: kind, staged: false) }
}

/// 승인 상태
struct ReviewState: Hashable {
    var approvedBy: [String] = []
    var changesRequestedBy: [String] = []
    /// GitLab: 남은 승인 수
    var approvalsLeft: Int?
    /// 내가 승인했는지
    var approvedByMe = false
}

struct PullRequestReview {
    let number: Int
    var comments: [ReviewComment] = []
    var files: [ReviewFile] = []
    var state = ReviewState()
}

// MARK: - API

/// PR(GitHub)·MR(GitLab) 리뷰: 대화·바뀐 파일·승인
enum ReviewAPI {
    private struct GHUser: Decodable { let login: String }
    private struct GHComment: Decodable { let id: Int; let user: GHUser?; let body: String?; let createdAt: String? }
    private struct GHLineComment: Decodable {
        let id: Int; let user: GHUser?; let body: String?; let createdAt: String?; let path: String?; let line: Int?; let originalLine: Int?
    }
    private struct GHReview: Decodable { let id: Int; let user: GHUser?; let body: String?; let state: String; let submittedAt: String? }
    private struct GHFile: Decodable {
        let filename: String; let previousFilename: String?; let status: String; let additions: Int; let deletions: Int; let patch: String?
    }
    private struct GLAuthor: Decodable { let username: String }
    private struct GLPosition: Decodable { let newPath: String?; let newLine: Int?; let oldPath: String?; let oldLine: Int? }
    private struct GLNote: Decodable {
        let id: Int; let author: GLAuthor?; let body: String; let createdAt: String?; let system: Bool?; let position: GLPosition?
    }
    private struct GLDiscussion: Decodable { let notes: [GLNote] }
    private struct GLApprovedBy: Decodable { let user: GLAuthor }
    private struct GLApprovals: Decodable { let approvedBy: [GLApprovedBy]?; let approvalsLeft: Int? }
    private struct GLChange: Decodable {
        let oldPath: String; let newPath: String; let newFile: Bool?; let deletedFile: Bool?; let renamedFile: Bool?; let diff: String?
    }
    private struct GLChanges: Decodable { let changes: [GLChange] }

    private static func repo(_ t: RepoTarget, _ base: String) -> String { base + "/repos/\(t.path)" }
    private static func project(_ t: RepoTarget, _ base: String) -> String { base + "/projects/\(Hosting.projectID(t.path))" }

    static func load(_ t: RepoTarget, token: String, apiBase: String, number: Int, me: String) async throws -> PullRequestReview {
        var review = PullRequestReview(number: number)
        switch t.provider {
        case .github:
            let r = repo(t, apiBase)
            async let commentsR = Hosting.send([GHComment].self, Hosting.request(.github, r + "/issues/\(number)/comments?per_page=100", token: token))
            async let lineR = Hosting.send([GHLineComment].self, Hosting.request(.github, r + "/pulls/\(number)/comments?per_page=100", token: token))
            async let reviewsR = Hosting.send([GHReview].self, Hosting.request(.github, r + "/pulls/\(number)/reviews?per_page=100", token: token))
            async let filesR = Hosting.send([GHFile].self, Hosting.request(.github, r + "/pulls/\(number)/files?per_page=100", token: token))
            let (comments, lines, reviews, files) = try await (commentsR, lineR, reviewsR, filesR)
            review.comments += comments.map {
                ReviewComment(id: "c\($0.id)", author: $0.user?.login ?? "", body: $0.body ?? "", date: Hosting.date($0.createdAt))
            }
            review.comments += lines.map {
                ReviewComment(id: "l\($0.id)", author: $0.user?.login ?? "", body: $0.body ?? "", date: Hosting.date($0.createdAt),
                              path: $0.path, line: $0.line ?? $0.originalLine)
            }
            var latest: [String: String] = [:]
            for rv in reviews {
                let who = rv.user?.login ?? ""
                if rv.state == "APPROVED" || rv.state == "CHANGES_REQUESTED" || rv.state == "DISMISSED" { latest[who] = rv.state }
                let kind: ReviewComment.Kind = rv.state == "APPROVED" ? .approved : rv.state == "CHANGES_REQUESTED" ? .changesRequested : .comment
                guard kind != .comment || !(rv.body ?? "").isEmpty else { continue }
                review.comments.append(ReviewComment(id: "r\(rv.id)", author: who, body: rv.body ?? "", date: Hosting.date(rv.submittedAt), kind: kind))
            }
            review.state.approvedBy = latest.filter { $0.value == "APPROVED" }.map(\.key).sorted()
            review.state.changesRequestedBy = latest.filter { $0.value == "CHANGES_REQUESTED" }.map(\.key).sorted()
            review.state.approvedByMe = latest[me] == "APPROVED"
            review.files = files.map { f in
                let kind: ChangeKind = f.status == "added" ? .added : f.status == "removed" ? .deleted : f.status == "renamed" ? .renamed : .modified
                return ReviewFile(path: f.filename, oldPath: f.previousFilename, kind: kind, additions: f.additions, deletions: f.deletions, patch: f.patch)
            }
        case .gitlab:
            let p = project(t, apiBase)
            async let discussionsR = Hosting.send([GLDiscussion].self, Hosting.request(.gitlab, p + "/merge_requests/\(number)/discussions?per_page=100", token: token))
            async let approvalsR = Hosting.send(GLApprovals.self, Hosting.request(.gitlab, p + "/merge_requests/\(number)/approvals", token: token))
            async let changesR = Hosting.send(GLChanges.self, Hosting.request(.gitlab, p + "/merge_requests/\(number)/changes", token: token))
            let (discussions, approvals, changes) = try await (discussionsR, try? approvalsR, changesR)
            review.comments = discussions.flatMap(\.notes).map { n in
                ReviewComment(id: "n\(n.id)", author: n.author?.username ?? "", body: n.body, date: Hosting.date(n.createdAt),
                              path: n.position?.newPath ?? n.position?.oldPath, line: n.position?.newLine ?? n.position?.oldLine,
                              kind: n.system == true ? .system : .comment)
            }
            review.state.approvedBy = (approvals?.approvedBy ?? []).map(\.user.username)
            review.state.approvalsLeft = approvals?.approvalsLeft
            review.state.approvedByMe = review.state.approvedBy.contains(me)
            review.files = changes.changes.map { c in
                let kind: ChangeKind = c.newFile == true ? .added : c.deletedFile == true ? .deleted : c.renamedFile == true ? .renamed : .modified
                let lines = (c.diff ?? "").lfLines()
                return ReviewFile(path: c.newPath, oldPath: c.renamedFile == true ? c.oldPath : nil, kind: kind,
                                  additions: lines.filter { $0.hasPrefix("+") }.count, deletions: lines.filter { $0.hasPrefix("-") }.count,
                                  patch: (c.diff ?? "").isEmpty ? nil : c.diff)
            }
        }
        review.comments.sort { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        return review
    }

    static func comment(_ t: RepoTarget, token: String, apiBase: String, number: Int, body: String) async throws {
        switch t.provider {
        case .github:
            try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/issues/\(number)/comments", token: token, method: "POST", body: ["body": body]))
        case .gitlab:
            try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/merge_requests/\(number)/notes", token: token, method: "POST", body: ["body": body]))
        }
    }

    /// 승인(GitHub 은 의견을 함께 남길 수 있다)
    static func approve(_ t: RepoTarget, token: String, apiBase: String, number: Int, body: String) async throws {
        switch t.provider {
        case .github:
            var payload: [String: Any] = ["event": "APPROVE"]
            if !body.isEmpty { payload["body"] = body }
            try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/pulls/\(number)/reviews", token: token, method: "POST", body: payload))
        case .gitlab:
            try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/merge_requests/\(number)/approve", token: token, method: "POST"))
            if !body.isEmpty { try await comment(t, token: token, apiBase: apiBase, number: number, body: body) }
        }
    }

    /// GitLab: 승인 취소
    static func unapprove(_ t: RepoTarget, token: String, apiBase: String, number: Int) async throws {
        try await Hosting.data(Hosting.request(.gitlab, project(t, apiBase) + "/merge_requests/\(number)/unapprove", token: token, method: "POST"))
    }

    /// GitHub: 변경 요청(의견 필수)
    static func requestChanges(_ t: RepoTarget, token: String, apiBase: String, number: Int, body: String) async throws {
        try await Hosting.data(Hosting.request(.github, repo(t, apiBase) + "/pulls/\(number)/reviews", token: token, method: "POST",
                                               body: ["event": "REQUEST_CHANGES", "body": body]))
    }
}
