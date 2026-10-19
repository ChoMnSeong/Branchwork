import SwiftUI

// MARK: - 작업 영역

struct WorkingChangesView: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            Divider()
            if store.repoState != .clean { OperationBanner() }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !store.status.conflicted.isEmpty {
                        FileSection(title: "충돌", color: .red, count: store.status.conflicted.count,
                                    actionTitle: "모두 해결됨으로 표시",
                                    action: { Task { await store.stage(store.status.conflicted) } }) {
                            ChangeList(changes: store.status.conflicted, isSelected: isOpen,
                                       actionIcon: "checkmark.circle", actionHelp: "해결됨으로 표시(스테이지)",
                                       onAction: { files in Task { await store.stage(files) } },
                                       onOpen: open) { c in
                                Button("해결됨으로 표시") { Task { await store.stage([c]) } }
                                Divider()
                                Button("Finder 에서 보기") { store.revealInFinder(c) }
                            }
                        }
                    }
                    FileSection(title: "스테이지 안 된 파일", color: .orange, count: store.status.unstaged.count,
                                actionTitle: "모두 스테이지",
                                action: { Task { await store.stageAll() } }) {
                        ChangeList(changes: store.status.unstaged, isSelected: isOpen, stats: store.unstagedStats,
                                   actionIcon: "plus.circle", actionHelp: "스테이지",
                                   onAction: { files in Task { await store.stage(files) } },
                                   onOpen: open) { c in
                            Button("스테이지") { Task { await store.stage([c]) } }
                            Button("변경 버리기…", role: .destructive) { store.confirmDiscard(c) }
                            Divider()
                            Button("Finder 에서 보기") { store.revealInFinder(c) }
                            Button("경로 복사") { store.copy(c.path) }
                        }
                    }
                    FileSection(title: "스테이지된 파일", color: .green, count: store.status.staged.count,
                                actionTitle: "모두 언스테이지",
                                action: { Task { await store.unstageAll() } }) {
                        ChangeList(changes: store.status.staged, isSelected: isOpen, stats: store.stagedStats,
                                   actionIcon: "minus.circle", actionHelp: "언스테이지",
                                   onAction: { files in Task { await store.unstage(files) } },
                                   onOpen: open) { c in
                            Button("언스테이지") { Task { await store.unstage([c]) } }
                            Divider()
                            Button("Finder 에서 보기") { store.revealInFinder(c) }
                            Button("경로 복사") { store.copy(c.path) }
                        }
                    }
                    if store.status.isEmpty {
                        Card {
                            Label("작업 디렉터리가 깨끗합니다", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("수정한 파일이 생기면 여기에 나타납니다.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(12)
            }
            Divider()
            CommitComposer()
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("작업 중인 변경").font(.title3.weight(.semibold))
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.branch")
                    Text(store.headBranch ?? "분리된 HEAD")
                    if store.status.ahead > 0 { Text("↑\(store.status.ahead)") }
                    if store.status.behind > 0 { Text("↓\(store.status.behind)") }
                    if !store.status.isEmpty {
                        let total = totals
                        Text("·")
                        Text("\(store.status.count)개 파일")
                        if total.added + total.deleted > 0 { LineStatText(added: total.added, deleted: total.deleted) }
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer()
            FileViewToggle()
        }
    }

    private var totals: (added: Int, deleted: Int) {
        let all = Array(store.stagedStats.values) + Array(store.unstagedStats.values)
        return (all.compactMap(\.added).reduce(0, +), all.compactMap(\.deleted).reduce(0, +))
    }

    private func isOpen(_ c: FileChange) -> Bool { store.diffSource == .working(c) }

    private func open(_ c: FileChange) { store.openDiff(.working(c)) }
}

private struct FileSection<Content: View>: View {
    let title: String
    let color: Color
    let count: Int
    let actionTitle: String
    let action: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        if count > 0 {
            Card(spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(color).frame(width: 7, height: 7)
                    Text(title).font(.subheadline.weight(.semibold))
                    Text("\(count)").font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                    Button(actionTitle, action: action).buttonStyle(.link).font(.caption)
                }
                .padding(.bottom, 4)
                content
            }
        }
    }
}

private struct OperationBanner: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(store.repoState.title, systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .foregroundStyle(.orange)
            Text(store.status.conflicted.isEmpty
                 ? "충돌이 모두 해결됐습니다. 계속 진행하세요."
                 : "충돌한 파일을 편집기에서 고친 뒤 '해결됨으로 표시' 하세요.")
                .font(.callout)
                .foregroundStyle(.secondary)
            HStack {
                Button("중단…") { store.abortOperation() }
                Spacer()
                Button("계속") { Task { await store.continueOperation() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(!store.status.conflicted.isEmpty)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.10))
    }
}

struct CommitComposer: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let me = store.me {
                    Avatar(name: me.name, email: me.email, size: 22)
                        .help("\(me.name) <\(me.email)>")
                }
                Text("커밋").font(.headline)
                Spacer()
                Button { Task { await store.generateCommitMessage() } } label: {
                    if store.aiWorking != nil {
                        HStack(spacing: 4) { ProgressView().controlSize(.mini); Text("작성 중") }
                    } else {
                        Label("Claude 로 작성", systemImage: "sparkles")
                    }
                }
                .controlSize(.small)
                .disabled(store.status.staged.isEmpty || store.aiWorking != nil)
                .help("스테이지된 변경을 보고 Claude 가 커밋 메시지를 씁니다 (⌥⌘M)")
            }
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    TextField("요약 (필수)", text: $store.summary)
                        .textFieldStyle(.plain)
                        .font(.body.weight(.medium))
                    Text("\(store.summary.count)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(store.summary.count > 72 ? Color.orange : Color.secondary)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 7)
                Divider()
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $store.message)
                        .font(.callout)
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 4)
                    if store.message.isEmpty {
                        Text("자세한 설명 (선택)")
                            .font(.callout)
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .allowsHitTesting(false)
                    }
                }
                .frame(height: 70)
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .textBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.25)))

            if let notice = store.aiNotice {
                Text(notice).font(.caption).foregroundStyle(.secondary)
            }

            HStack {
                Toggle("이전 커밋 수정", isOn: Binding(get: { store.amend },
                                                  set: { v in Task { await store.setAmend(v) } }))
                    .toggleStyle(.checkbox)
                    .disabled(store.headHash == nil)
                    .help("Amend: 마지막 커밋에 합칩니다")
                Spacer()
                Button {
                    Task { await store.commit() }
                } label: {
                    Text(buttonTitle).frame(minWidth: 120)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!store.canCommit)
            }
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private var buttonTitle: String {
        if store.amend { return "이전 커밋 수정" }
        if store.repoState == .merging { return "머지 커밋" }
        let n = store.status.staged.count
        return n == 0 ? "스테이지된 파일 없음" : "\(n)개 파일 커밋  ⌘↩"
    }
}

// MARK: - 커밋 상세

struct CommitDetailView: View {
    @Environment(RepoStore.self) private var store
    let sha: String
    @ViewState private var bodyExpanded = false

    var body: some View {
        if let d = store.detail, d.sha == sha {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image(systemName: d.parents.count > 1 ? "arrow.triangle.merge" : "smallcircle.filled.circle")
                        .foregroundStyle(.secondary)
                    Text(d.parents.count > 1 ? "머지 커밋" : "커밋").font(.headline)
                    Text(String(d.sha.prefix(8))).font(.system(.callout, design: .monospaced)).foregroundStyle(.secondary)
                    Spacer()
                    Text(Fmt.short(d.commitDate)).font(.callout).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        message(d)
                        people(d)
                        claude
                        files(d)
                    }
                    .padding(12)
                }
                .id(sha)   // 다른 커밋을 고르면 맨 위부터 보이게
            }
            .background(Color(nsColor: .windowBackgroundColor))
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .windowBackgroundColor))
        }
    }

    private func message(_ d: CommitDetail) -> some View {
        Card {
            let refs = store.refsByCommit[sha] ?? []
            if !refs.isEmpty {
                let tint = store.commitIndex[sha].map { Palette.lane(store.entries[$0].row.color) } ?? .accentColor
                HStack(spacing: 4) {
                    ForEach(refs.prefix(4)) { RefBadge(label: $0, color: tint) }
                    if refs.count > 4 { Text("+\(refs.count - 4)").font(.caption2).foregroundStyle(.secondary) }
                }
            }
            Text(d.summary)
                .font(.system(size: 15, weight: .semibold))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if !d.body.isEmpty {
                let long = d.body.count > 400 || d.body.filter { $0 == "\n" }.count > 8
                Text(d.body)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .lineLimit(long && !bodyExpanded ? 8 : nil)
                    .fixedSize(horizontal: false, vertical: true)
                if long {
                    Button(bodyExpanded ? "접기" : "전체 보기") { bodyExpanded.toggle() }
                        .buttonStyle(.link)
                        .font(.caption)
                }
            }
        }
    }

    private func people(_ d: CommitDetail) -> some View {
        Card {
            HStack(spacing: 10) {
                Avatar(name: d.author, email: d.email, size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(d.author).fontWeight(.semibold)
                    Text(d.email).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(Fmt.short(d.date)).font(.callout)
                    Text(Fmt.long(d.date)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            if d.committer != d.author || abs(d.commitDate.timeIntervalSince(d.date)) > 60 {
                Label(d.committer == d.author ? "커밋: \(Fmt.long(d.commitDate))" : "커밋: \(d.committer) · \(Fmt.long(d.commitDate))",
                      systemImage: "clock.arrow.circlepath")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Divider()
            HStack(spacing: 6) {
                Pill(text: String(d.sha.prefix(8)), icon: "number") { store.copy(d.sha) }
                    .help("전체 SHA 복사")
                if !d.parents.isEmpty {
                    Image(systemName: "arrow.left").font(.caption2).foregroundStyle(.tertiary)
                    ForEach(d.parents, id: \.self) { p in
                        Pill(text: String(p.prefix(7)), icon: d.parents.count > 1 ? "arrow.triangle.merge" : nil) { store.reveal(p) }
                            .help("부모 커밋으로 이동")
                    }
                }
                Spacer()
            }
        }
    }

    private var claude: some View {
        Card {
            HStack {
                Label("Claude 설명", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                Spacer()
                if store.explaining.contains(sha) {
                    HStack(spacing: 4) { ProgressView().controlSize(.mini); Text("읽는 중").font(.caption) }
                } else {
                    Button(store.explanations[sha] == nil ? "이 커밋 설명 듣기" : "다시 설명") {
                        Task { await store.explainCommit(sha) }
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
            }
            if let text = store.explanations[sha] {
                Text(text)
                    .font(.callout)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func files(_ d: CommitDetail) -> some View {
        Card(spacing: 6) {
            let stats = store.detailStats.values
            let added = stats.compactMap(\.added).reduce(0, +)
            let deleted = stats.compactMap(\.deleted).reduce(0, +)
            HStack(spacing: 8) {
                Text("변경된 파일").font(.subheadline.weight(.semibold))
                Text("\(store.detailFiles.count)").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                FileViewToggle()
            }
            if added + deleted > 0 {
                HStack(spacing: 8) {
                    LineStatText(added: added, deleted: deleted)
                    ChangeBar(added: added, deleted: deleted)
                    Spacer()
                }
                .padding(.bottom, 4)
            }
            ChangeList(changes: store.detailFiles,
                       isSelected: { store.diffSource == .commit(sha: sha, change: $0, parent: d.parents.first) },
                       stats: store.detailStats,
                       onOpen: { store.openDiff(.commit(sha: sha, change: $0, parent: d.parents.first)) }) { f in
                Button("경로 복사") { store.copy(f.path) }
            }
        }
    }
}

/// 작은 둥근 버튼(SHA·부모 커밋)
private struct Pill: View {
    let text: String
    var icon: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 3) {
                if let icon { Image(systemName: icon).font(.system(size: 9, weight: .semibold)) }
                Text(text).font(.system(size: 11, design: .monospaced))
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.secondary.opacity(0.12)))
        }
        .buttonStyle(.plain)
    }
}
