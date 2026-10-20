import SwiftUI
import AppKit

// MARK: - 사이드바: PR·MR

struct PullRequestSection: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.openSettings) private var openSettings
    let target: RepoTarget

    var body: some View {
        Section {
            switch store.prState {
            case .needsAccount:
                let others = AccountStore.shared.accounts(for: target.provider)
                if let a = others.first {
                    Button("연결된 계정(@\(a.username) · \(a.host))으로 시도") { Task { await store.tryExistingAccounts() } }
                        .buttonStyle(.link)
                        .help("같은 서버가 다른 주소로 쓰이는 경우, 이미 연결한 계정이 그대로 통합니다")
                }
                Button(target.provider == .gitlab ? "사내 GitLab(\(target.host)) 계정 연결…" : "GitHub 계정 연결…") { openSettings() }
                    .buttonStyle(.link)
            case .failed(let m):
                Text(m).font(.caption).foregroundStyle(.red).lineLimit(3)
            case .loading where store.pullRequests.isEmpty:
                ProgressView().controlSize(.small)
            case .loaded where store.pullRequests.isEmpty:
                Text("열린 \(target.provider.requestShort) 없음").font(.callout).foregroundStyle(.secondary)
            default:
                EmptyView()
            }
            ForEach(store.pullRequests) { pr in
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("#\(pr.number)").foregroundStyle(.secondary).monospacedDigit()
                        Text(pr.title).lineLimit(1)
                    }
                    HStack(spacing: 4) {
                        if pr.isDraft { Text("Draft").font(.caption2.weight(.semibold)).foregroundStyle(.orange) }
                        Text("\(pr.source) → \(pr.target)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { store.select(.pullRequest(pr.number)) }
                .contextMenu {
                    Button("브랜치 체크아웃") { Task { await store.checkoutPullRequest(pr) } }
                    Button("브라우저에서 열기") { if let u = URL(string: pr.url) { NSWorkspace.shared.open(u) } }
                    Button("링크 복사") { store.copy(pr.url) }
                }
            }
        } header: {
            HStack {
                Text(store.prState == .loaded ? "\(target.provider.requestsTitle) \(store.pullRequests.count)" : target.provider.requestsTitle)
                Spacer()
                let candidates = AccountStore.shared.candidates(for: target)
                if let current = store.hostingAccount {
                    Menu {
                        ForEach(candidates) { a in
                            Button {
                                store.useAccount(a)
                            } label: {
                                if a.id == current.id { Label("@\(a.username)", systemImage: "checkmark") } else { Text("@\(a.username)") }
                            }
                        }
                        Divider()
                        Button("계정 추가…") { openSettings() }
                    } label: {
                        Text("@\(current.username)").font(.caption)
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .help(candidates.count > 1 ? "이 저장소에 쓸 계정 고르기" : "이 저장소에 쓰는 계정")
                }
                Button { Task { await store.loadPullRequests() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless)
                    .help("목록 새로 고침")
                Button { store.sheet = .createPullRequest } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .disabled(store.headBranch == nil)
                    .help("현재 브랜치로 새 \(target.provider.requestShort)")
            }
        }
    }
}

// MARK: - 사이드바: 워크트리

struct WorktreeSection: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        Section {
            ForEach(store.worktrees) { w in
                let current = w.path == store.url?.path
                HStack(spacing: 6) {
                    Image(systemName: current ? "folder.fill" : "folder")
                        .foregroundStyle(current ? Color.accentColor : .secondary)
                        .frame(width: 16)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(w.branch ?? "분리된 HEAD \(w.head.map { String($0.prefix(7)) } ?? "")")
                            .fontWeight(current ? .semibold : .regular)
                            .lineLimit(1)
                        Text((w.path as NSString).abbreviatingWithTildeInPath)
                            .font(.caption).foregroundStyle(.secondary)
                            .lineLimit(1).truncationMode(.head)
                    }
                    Spacer(minLength: 4)
                    if isTemporary(w.path) && !w.prunable {
                        Text("임시").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.15)))
                            .help("임시 폴더 안의 워크트리 — 재부팅하면 폴더가 지워져 깨질 수 있습니다")
                    }
                    if w.prunable {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
                            .help("폴더가 사라진 워크트리 — '정리'로 지울 수 있습니다")
                    } else if w.locked {
                        Image(systemName: "lock").foregroundStyle(.secondary).help("잠긴 워크트리")
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { open(w) }
                .contextMenu {
                    Button("Branchwork 에서 열기") { open(w) }.disabled(current)
                    Button("Finder 에서 보기") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: w.path)]) }
                    Button("아래 터미널에서 열기") { store.newTerminal(in: w.path) }
                    Button("Terminal 앱에서 열기") { Launcher.openTerminal(at: w.path) }
                    Button("에이전트 실행 (\(AgentCenter.shared.defaultKind.title))") { store.startAgent(in: w.path) }
                    Button("경로 복사") { store.copy(w.path) }
                    Divider()
                    Button("제거…", role: .destructive) { store.confirmRemove(w) }.disabled(w.isMain || current)
                    Button("강제 제거…", role: .destructive) { store.confirmRemove(w, force: true) }.disabled(w.isMain || current)
                }
            }
        } header: {
            HStack {
                Text("워크트리 \(store.worktrees.count)")
                Spacer()
                if store.worktrees.contains(where: \.prunable) {
                    Button("정리") { Task { await store.pruneWorktrees() } }
                        .buttonStyle(.borderless).font(.caption)
                }
                Button { store.sheet = .addWorktree(branch: nil, start: nil) } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help("새 워크트리")
            }
        }
    }

    private func open(_ w: Worktree) {
        Task { await store.openOrReport(URL(fileURLWithPath: w.path, isDirectory: true)) }
    }

    private func isTemporary(_ path: String) -> Bool {
        ["/private/tmp/", "/tmp/", "/private/var/folders/", "/var/folders/"].contains { path.hasPrefix($0) }
    }
}

// MARK: - PR 상세

struct PullRequestDetailView: View {
    @Environment(RepoStore.self) private var store
    let number: Int

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
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(pr.title).font(.title3.weight(.semibold)).textSelection(.enabled)

                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 6) {
                        GridRow { Text("작성자").foregroundStyle(.secondary); Text("@\(pr.author)") }
                        GridRow {
                            Text("브랜치").foregroundStyle(.secondary)
                            Text("\(pr.source) → \(pr.target)\(pr.fromFork ? "  (포크)" : "")")
                        }
                        if let d = pr.updated {
                            GridRow { Text("업데이트").foregroundStyle(.secondary); Text(Fmt.long(d)) }
                        }
                    }
                    .font(.callout)

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

                    Divider()

                    if pr.body.trimmed.isEmpty {
                        Text("설명 없음").foregroundStyle(.secondary)
                    } else {
                        Text(markdown(pr.body)).textSelection(.enabled)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(number)
            }
        } else {
            ContentUnavailableView("목록에 없는 \(store.target?.provider.requestShort ?? "PR")", systemImage: "arrow.triangle.pull",
                                   description: Text("닫혔거나 아직 불러오지 않았습니다."))
        }
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}

// MARK: - PR 만들기

struct CreatePullRequestSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @ViewState private var title = ""
    @ViewState private var bodyText = ""
    @ViewState private var base = ""
    @ViewState private var bases: [String] = []
    @ViewState private var draft = false
    @ViewState private var generating = false

    var body: some View {
        let provider = store.target?.provider ?? .github
        VStack(alignment: .leading, spacing: 12) {
            Text("새 \(provider.requestName)").font(.title3.weight(.semibold))
            HStack {
                Text(store.headBranch ?? "").font(.system(.body, design: .monospaced))
                Image(systemName: "arrow.right").foregroundStyle(.secondary)
                Picker("", selection: $base) {
                    ForEach(bases, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .frame(maxWidth: 220)
            }
            TextField("제목", text: $title)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $bodyText)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(4)
                .frame(height: 200)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.3)))
            HStack {
                Toggle("Draft", isOn: $draft)
                Spacer()
                if generating { ProgressView().controlSize(.small) }
                Button { generate() } label: { Label("\(AIStore.shared.short(for: .pullRequest))로 작성", systemImage: "sparkles") }
                    .disabled(generating || base.isEmpty)
            }
            if store.status.upstream == nil || store.status.ahead > 0 {
                Text("만들기 전에 현재 브랜치를 \(store.target?.remote ?? "원격")에 Push 합니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("만들기") {
                    let t = title.trimmed, b = bodyText, target = base, d = draft
                    dismiss()
                    Task { await store.createPullRequest(title: t, body: b, base: target, draft: d) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(title.trimmed.isEmpty || base.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 600)
        .task {
            bases = store.pullRequestBaseCandidates()
            if let b = await store.defaultBaseBranch() { base = b }
            if title.isEmpty, let branch = store.headBranch {
                title = branch.split(separator: "/").last.map { $0.replacingOccurrences(of: "-", with: " ") } ?? branch
            }
        }
    }

    private func generate() {
        generating = true
        Task {
            if let d = await store.draftPullRequest(base: base) {
                title = d.title
                bodyText = d.body
            }
            generating = false
        }
    }
}

// MARK: - 워크트리 만들기

struct AddWorktreeSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let presetBranch: String?
    let start: String?

    @ViewState private var createNew = true
    @ViewState private var name = ""
    @ViewState private var existing = ""
    @ViewState private var path = ""
    @ViewState private var pathEdited = false
    @ViewState private var runClaude = false
    @ViewState private var task = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("새 워크트리").font(.title3.weight(.semibold)).padding([.top, .horizontal], 20)
            Form {
                Picker("브랜치", selection: $createNew) {
                    Text("새 브랜치 만들기").tag(true)
                    Text("기존 브랜치").tag(false)
                }
                .pickerStyle(.segmented)
                if createNew {
                    TextField("새 브랜치 이름", text: $name, prompt: Text("feature/새-작업"))
                    LabeledContent("시작 위치", value: start.map { String($0.prefix(10)) } ?? store.headBranch ?? "HEAD")
                } else {
                    Picker("체크아웃할 브랜치", selection: $existing) {
                        ForEach(freeBranches, id: \.self) { Text($0).tag($0) }
                    }
                }
                LabeledContent("위치") {
                    HStack {
                        TextField("", text: Binding(get: { path }, set: { path = $0; pathEdited = true }))
                            .textFieldStyle(.roundedBorder)
                        Button("변경…") { choose() }
                    }
                }
                Toggle("만든 뒤 \(AgentCenter.shared.defaultKind.title) 실행", isOn: $runClaude)
                if runClaude {
                    TextField("에이전트에게 맡길 작업 (선택)", text: $task, prompt: Text("예: 로그인 화면에 비밀번호 찾기 추가"), axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .formStyle(.grouped)
            HStack {
                Text("한 브랜치는 워크트리 하나에서만 체크아웃할 수 있습니다.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("만들기") {
                    let b = branch, p = path, new = createNew, s = createNew ? start : nil, c = runClaude, t = task
                    dismiss()
                    Task { await store.addWorktree(path: p, branch: b, createNew: new, start: s, launchClaude: c, task: t) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!valid)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 560)
        .onAppear {
            if let presetBranch {
                createNew = false
                existing = presetBranch
            } else {
                existing = freeBranches.first ?? ""
            }
            updatePath()
        }
        .onChange(of: name) { _, _ in updatePath() }
        .onChange(of: existing) { _, _ in updatePath() }
        .onChange(of: createNew) { _, _ in updatePath() }
    }

    private var branch: String { createNew ? name.trimmed : existing }

    private var freeBranches: [String] {
        let used = Set(store.worktrees.compactMap(\.branch))
        return store.localBranches.map(\.name).filter { !used.contains($0) }
    }

    private var valid: Bool {
        let b = branch
        return !b.isEmpty && !b.contains(" ") && !b.hasPrefix("-") && !path.trimmed.isEmpty
            && !FileManager.default.fileExists(atPath: path)
    }

    private func updatePath() {
        guard !pathEdited, !branch.isEmpty else { return }
        path = store.defaultWorktreePath(for: branch)
    }

    private func choose() {
        let p = NSOpenPanel()
        p.canChooseDirectories = true
        p.canChooseFiles = false
        p.canCreateDirectories = true
        p.prompt = "이 안에 만들기"
        if p.runModal() == .OK, let u = p.url {
            path = u.appendingPathComponent(branch.isEmpty ? "worktree" : branch.replacingOccurrences(of: "/", with: "-")).path
            pathEdited = true
        }
    }
}

// MARK: - 나눠서 커밋

/// AI 가 나눈 계획을 보고 메시지·파일을 고친 뒤 차례로 커밋
struct SplitCommitsSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @ViewState private var groups: [SplitGroup] = []
    @ViewState private var loaded = false

    var body: some View {
        let changes = Dictionary(store.splittableChanges.map { ($0.path, $0) }, uniquingKeysWith: { a, _ in a })
        let valid = groups.filter { !$0.files.isEmpty }
        let leftover = store.splittableChanges.map(\.path).filter { p in !groups.contains { $0.files.contains(p) } }
        VStack(alignment: .leading, spacing: 0) {
            Text("나눠서 커밋").font(.title3.weight(.semibold)).padding([.top, .horizontal], 20)
            if let notice = store.aiNotice {
                Text(notice).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.top, 4)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(groups.enumerated()), id: \.element.id) { i, g in
                        if !g.files.isEmpty {
                            Card(spacing: 6) {
                                HStack {
                                    Text("\(i + 1)번 커밋").font(.subheadline.weight(.semibold))
                                    Text("\(g.files.count)개 파일").font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                    Button { shift(i, -1) } label: { Image(systemName: "arrow.up") }
                                        .buttonStyle(.borderless).disabled(i == 0).help("위로")
                                    Button { shift(i, 1) } label: { Image(systemName: "arrow.down") }
                                        .buttonStyle(.borderless).disabled(i == groups.count - 1).help("아래로")
                                }
                                TextEditor(text: Binding(get: { groups[i].message }, set: { groups[i].message = $0 }))
                                    .font(.callout)
                                    .frame(height: 54)
                                    .scrollContentBackground(.hidden)
                                    .padding(4)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.25)))
                                ForEach(g.files, id: \.self) { p in fileRow(p, changes[p], current: g.id) }
                            }
                        }
                    }
                    if !leftover.isEmpty {
                        Card(spacing: 6) {
                            Text("커밋하지 않음").font(.subheadline.weight(.semibold))
                            ForEach(leftover, id: \.self) { p in fileRow(p, changes[p], current: nil) }
                        }
                    }
                }
                .padding(20)
            }
            .frame(maxHeight: 520)
            HStack {
                Text("스테이지 상태를 비우고 위에서부터 차례로 스테이지 → 커밋합니다." + (leftover.isEmpty ? "" : " 커밋하지 않는 \(leftover.count)개 파일은 그대로 남습니다."))
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("다시 나누기") {
                    dismiss()
                    Task { await store.planSplit() }
                }
                .disabled(store.aiWorking != nil)
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("\(valid.count)개 커밋 만들기") {
                    let plan = valid
                    dismiss()
                    Task { await store.applySplit(plan) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(valid.isEmpty || valid.contains { $0.message.trimmed.isEmpty } || store.busy != nil)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 720)
        .onAppear {
            if !loaded { groups = store.splitPlan ?? []; loaded = true }
        }
    }

    private func fileRow(_ p: String, _ c: FileChange?, current: UUID?) -> some View {
        HStack(spacing: 6) {
            if let c { StatusBadge(kind: c.kind) }
            Text(p).lineLimit(1).truncationMode(.middle).help(p)
            Spacer()
            Menu {
                ForEach(Array(groups.enumerated()), id: \.element.id) { i, g in
                    Button("\(i + 1)번 커밋으로") { move(p, to: g.id) }.disabled(g.id == current)
                }
                Button("새 커밋으로") { move(p, to: nil, new: true) }
                Divider()
                Button("커밋하지 않음") { move(p, to: nil) }.disabled(current == nil)
            } label: {
                Text(current.flatMap { id in groups.firstIndex { $0.id == id }.map { "\($0 + 1)번 커밋" } } ?? "커밋 안 함")
                    .font(.caption)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .font(.callout)
    }

    private func move(_ path: String, to id: UUID?, new: Bool = false) {
        for i in groups.indices { groups[i].files.removeAll { $0 == path } }
        if new { groups.append(SplitGroup(message: "", files: [path])) }
        else if let id, let i = groups.firstIndex(where: { $0.id == id }) { groups[i].files.append(path) }
    }

    private func shift(_ i: Int, _ d: Int) {
        let j = i + d
        guard j >= 0, j < groups.count else { return }
        groups.swapAt(i, j)
    }
}
