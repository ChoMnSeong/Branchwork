import SwiftUI
import AppKit

/// 오른쪽: PR·MR 상세 — 설명, CI, 승인 상태와 승인·변경 요청, 바뀐 파일(누르면 가운데 diff), 대화와 댓글 쓰기
struct PullRequestDetailView: View {
    @Environment(RepoStore.self) private var store
    let number: Int
    @ViewState private var draft = ""

    var body: some View {
        if let pr = store.pullRequests.first(where: { $0.number == number }), let t = store.target {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.pull").foregroundStyle(.secondary)
                    Text("\(t.provider.requestShort) #\(pr.number)").font(.headline)
                    if pr.isDraft {
                        Text("Draft").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.2)))
                    }
                    Spacer()
                    if store.reviewLoading { ProgressView().controlSize(.small) }
                    Button { Task { await store.loadReview(number) } } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.borderless)
                        .help("대화·승인 새로 고침")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(pr.title).font(.title3.weight(.semibold)).textSelection(.enabled)
                        info(pr)
                        actions(pr)
                        Divider()
                        if pr.body.trimmed.isEmpty {
                            Text("설명 없음").foregroundStyle(.secondary)
                        } else {
                            Text(markdown(pr.body)).textSelection(.enabled)
                        }
                        if let e = store.reviewError {
                            Text(e).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                        }
                        if let r = store.review, r.number == number {
                            approval(r.state, provider: t.provider)
                            files(r)
                            conversation(r)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .id(number)
                Divider()
                composer(t.provider)
            }
            .task(id: number) { draft = ""; await store.loadReview(number) }
        } else {
            ContentUnavailableView("목록에 없는 \(store.target?.provider.requestShort ?? "PR")", systemImage: "arrow.triangle.pull",
                                   description: Text("닫혔거나 아직 불러오지 않았습니다."))
        }
    }

    private func info(_ pr: PullRequest) -> some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 6) {
            GridRow { Text("작성자").foregroundStyle(.secondary); Text("@\(pr.author)") }
            GridRow {
                Text("브랜치").foregroundStyle(.secondary)
                Text("\(pr.source) → \(pr.target)\(pr.fromFork ? "  (포크)" : "")")
            }
            if let d = pr.updated {
                GridRow { Text("업데이트").foregroundStyle(.secondary); Text(Fmt.long(d)) }
            }
            if let sha = pr.headSHA, let ci = store.ciBySha[sha] {
                GridRow {
                    Text("CI").foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        CIStatusIcon(status: ci.status, size: 11)
                        Text("\(ci.status.title) · #\(ci.number)")
                        Button("열기") { if let u = URL(string: ci.url) { NSWorkspace.shared.open(u) } }.buttonStyle(.link)
                    }
                }
            }
        }
        .font(.callout)
    }

    private func actions(_ pr: PullRequest) -> some View {
        HStack {
            Button { Task { await store.checkoutPullRequest(pr) } } label: {
                Label("브랜치 체크아웃", systemImage: "arrow.down.to.line")
            }
            .buttonStyle(.borderedProminent)
            Button { if let u = URL(string: pr.url) { NSWorkspace.shared.open(u) } } label: {
                Label("브라우저", systemImage: "safari")
            }
            if let sha = pr.headSHA, store.commitIndex[sha] != nil {
                Button { store.reveal(sha) } label: { Label("그래프에서 보기", systemImage: "point.3.connected.trianglepath.dotted") }
            }
        }
    }

    /// 승인 상태
    private func approval(_ s: ReviewState, provider: Provider) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("리뷰").font(.subheadline.weight(.semibold))
            if s.approvedBy.isEmpty && s.changesRequestedBy.isEmpty {
                Text("아직 승인한 사람이 없습니다.").font(.callout).foregroundStyle(.secondary)
            }
            if !s.approvedBy.isEmpty {
                Label("승인: " + s.approvedBy.map { "@\($0)" }.joined(separator: ", "), systemImage: "checkmark.seal.fill")
                    .font(.callout).foregroundStyle(.green)
            }
            if !s.changesRequestedBy.isEmpty {
                Label("변경 요청: " + s.changesRequestedBy.map { "@\($0)" }.joined(separator: ", "), systemImage: "exclamationmark.bubble.fill")
                    .font(.callout).foregroundStyle(.orange)
            }
            if let left = s.approvalsLeft, left > 0 {
                Text("승인 \(left)명이 더 필요합니다.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// 바뀐 파일(누르면 가운데에 diff)
    private func files(_ r: PullRequestReview) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("바뀐 파일 \(r.files.count)").font(.subheadline.weight(.semibold))
            ForEach(r.files) { f in
                HStack(spacing: 6) {
                    StatusBadge(kind: f.kind)
                    Text((f.path as NSString).lastPathComponent).lineLimit(1)
                    Text((f.path as NSString).deletingLastPathComponent).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
                    Spacer(minLength: 4)
                    LineStatText(added: f.additions, deleted: f.deletions)
                }
                .padding(.vertical, 2)
                .padding(.horizontal, 4)
                .background(RoundedRectangle(cornerRadius: 5).fill(isOpen(f) ? Color.accentColor.opacity(0.18) : .clear))
                .contentShape(Rectangle())
                .onTapGesture { store.openReviewFile(r.number, f) }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { store.openReviewFile(r.number, f) }
                .help(f.patch == nil ? "바이너리이거나 너무 커서 브라우저에서 보세요" : "눌러서 가운데에 diff 보기")
            }
        }
    }

    private func isOpen(_ f: ReviewFile) -> Bool {
        if case .review(let n, let c, _)? = store.diffSource { return n == number && c.path == f.path }
        return false
    }

    /// 대화(일반 댓글·코드 줄 댓글·리뷰·시스템 기록)
    private func conversation(_ r: PullRequestReview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("대화 \(r.comments.filter { $0.kind != .system }.count)").font(.subheadline.weight(.semibold))
            ForEach(r.comments) { c in
                if c.kind == .system {
                    Text("@\(c.author) \(c.body)").font(.caption).foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text("@\(c.author)").font(.callout.weight(.semibold))
                            switch c.kind {
                            case .approved: Label("승인", systemImage: "checkmark.seal.fill").font(.caption).foregroundStyle(.green)
                            case .changesRequested: Label("변경 요청", systemImage: "exclamationmark.bubble.fill").font(.caption).foregroundStyle(.orange)
                            default: EmptyView()
                            }
                            Spacer()
                            if let d = c.date { Text(Fmt.short(d)).font(.caption).foregroundStyle(.secondary) }
                        }
                        if let path = c.path {
                            Text(path + (c.line.map { ":\($0)" } ?? ""))
                                .font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                        if !c.body.isEmpty { Text(markdown(c.body)).font(.callout).textSelection(.enabled) }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.08)))
                }
            }
        }
    }

    /// 아래: 댓글 쓰기 · 승인 · 변경 요청
    private func composer(_ provider: Provider) -> some View {
        let s = store.review?.number == number ? store.review?.state : nil
        let text = draft.trimmed
        return VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: $draft)
                .font(.callout)
                .frame(height: 56)
                .scrollContentBackground(.hidden)
                .padding(4)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.25)))
                .overlay(alignment: .topLeading) {
                    if draft.isEmpty {
                        Text("댓글 · 리뷰 의견").font(.callout).foregroundStyle(.tertiary).padding(8).allowsHitTesting(false)
                    }
                }
            HStack(spacing: 6) {
                if store.reviewBusy { ProgressView().controlSize(.small) }
                Spacer()
                if provider == .github {
                    Button("변경 요청") { Task { if await store.requestChanges(number, body: text) { draft = "" } } }
                        .disabled(text.isEmpty || store.reviewBusy)
                        .help("의견을 남기며 변경을 요청합니다(의견 필수)")
                }
                if provider == .gitlab, s?.approvedByMe == true {
                    Button("승인 취소") { Task { await store.unapprovePullRequest(number) } }
                        .disabled(store.reviewBusy)
                } else {
                    Button { Task { if await store.approvePullRequest(number, body: text) { draft = "" } } } label: {
                        Label("승인", systemImage: "checkmark.seal")
                    }
                    .disabled(store.reviewBusy || s?.approvedByMe == true)
                    .help(text.isEmpty ? "승인합니다" : "의견과 함께 승인합니다")
                }
                Button("댓글") { Task { if await store.postReviewComment(number, body: text) { draft = "" } } }
                    .buttonStyle(.borderedProminent)
                    .disabled(text.isEmpty || store.reviewBusy)
                    .keyboardShortcut(.return, modifiers: .command)
                    .help("댓글 달기 (⌘↩)")
            }
            .controlSize(.small)
        }
        .padding(10)
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}
