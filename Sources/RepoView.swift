import SwiftUI

/// 저장소를 연 뒤의 메인 화면: 사이드바(참조) | 그래프 또는 diff (+ 터미널) | 상세
struct RepoView: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 360)
        } content: {
            ContentColumn()
                .navigationSplitViewColumnWidth(min: 520, ideal: 780)
        } detail: {
            InspectorView()
                .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 560)
        }
        .navigationTitle(store.name)
        .navigationSubtitle(subtitle)
        .toolbar { toolbar }
        .onChange(of: AccountStore.shared.revision) { _, _ in
            Task { await store.loadPullRequests() }
        }
    }

    private var subtitle: String {
        guard let branch = store.headBranch else {
            return store.headHash.map { "분리된 HEAD · \($0.prefix(7))" } ?? ""
        }
        var s = branch
        if let up = store.status.upstream {
            s += "  →  \(up)"
            if store.status.ahead > 0 { s += "  ↑\(store.status.ahead)" }
            if store.status.behind > 0 { s += "  ↓\(store.status.behind)" }
        }
        if store.repoState != .clean { s += "  ·  \(store.repoState.title)" }
        return s
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Menu {
                ForEach(store.recents.filter { $0 != store.url }, id: \.self) { u in
                    Button(u.lastPathComponent) { Task { await store.openOrReport(u) } }
                }
                if store.recents.count > 1 { Divider() }
                Button("저장소 열기…") { store.presentOpenPanel() }
                Button("저장소 복제…") { store.sheet = .clone }
                Divider()
                Button("탭 닫기") { NSApp.keyWindow?.performClose(nil) }
            } label: {
                ToolLabel(title: "저장소", icon: "folder")
            }
            .hoverTip("저장소", "다른 저장소 열기·복제, 최근에 연 저장소, 탭 닫기")
        }

        // 작업 중 표시는 버튼 묶음과 떼어 자기 칸에 둔다(같은 묶음이면 글자가 테두리에 붙음)
        if let busy = store.busy {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text(busy).font(.callout).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .fixedSize()
            }
        }

        ToolbarItemGroup(placement: .primaryAction) {

            Button { store.select(.wip) } label: {
                ToolLabel(title: store.status.isEmpty ? "변경" : "변경 \(store.status.count)", icon: "square.and.pencil")
            }
            .hoverTip("작업 중인 변경",
                      store.status.isEmpty ? "수정한 파일이 없습니다. 파일을 고치면 여기서 스테이지하고 커밋합니다."
                                           : "수정한 파일 \(store.status.count)개 — 스테이지하고 커밋합니다.",
                      shortcut: "⌘1")

            Button { Task { await store.fetch() } } label: {
                ToolLabel(title: "Fetch", icon: "arrow.triangle.2.circlepath")
            }
            .hoverTip("Fetch", "모든 원격에서 새 커밋과 브랜치를 가져옵니다. 내 브랜치는 바꾸지 않습니다.", shortcut: "⇧⌘F")

            Menu {
                Button("Pull (git 설정대로)") { Task { await store.pull(.standard) } }
                Button("Pull — fast-forward 만") { Task { await store.pull(.fastForward) } }
                Button("Pull — merge") { Task { await store.pull(.merge) } }
                Button("Pull — rebase") { Task { await store.pull(.rebase) } }
            } label: {
                ToolLabel(title: store.status.behind > 0 ? "Pull ↓\(store.status.behind)" : "Pull", icon: "arrow.down")
            } primaryAction: {
                Task { await store.pull() }
            }
            .disabled(store.status.upstream == nil)
            .hoverTip("Pull",
                      store.status.upstream == nil ? "이 브랜치는 원격 추적 브랜치가 없어 Pull 할 곳이 없습니다(먼저 Push 하면 생깁니다)."
                      : (store.status.behind > 0 ? "원격의 새 커밋 \(store.status.behind)개를 현재 브랜치로 가져옵니다." : "현재 브랜치를 원격과 맞춥니다(지금은 받을 커밋 없음).")
                        + " ▾ 에서 merge·rebase 방식을 고를 수 있습니다.",
                      shortcut: "⇧⌘L")

            Menu {
                Button("Push") { Task { await store.push() } }
                Button("Force push (with lease)…") {
                    store.confirm = ConfirmRequest(title: "강제로 Push 할까요?",
                                                   message: "원격 브랜치가 내가 마지막으로 본 상태일 때만 덮어씁니다(--force-with-lease).",
                                                   actionTitle: "Force push") { await store.push(force: true) }
                }
            } label: {
                ToolLabel(title: store.status.ahead > 0 ? "Push ↑\(store.status.ahead)" : "Push", icon: "arrow.up")
            } primaryAction: {
                Task { await store.push() }
            }
            .hoverTip("Push",
                      (store.status.upstream == nil ? "현재 브랜치를 원격에 처음 올리고 추적을 연결합니다."
                       : (store.status.ahead > 0 ? "올리지 않은 커밋 \(store.status.ahead)개를 원격에 올립니다." : "현재 브랜치를 원격에 올립니다(지금은 올릴 커밋 없음)."))
                        + " ▾ 에서 Force push.",
                      shortcut: "⇧⌘P")

            Menu {
                Button("새 브랜치…") { store.requestNewBranch() }
                Button("새 워크트리…") { store.sheet = .addWorktree(branch: nil, start: nil) }
                if let url = store.url {
                    Divider()
                    Button("여기서 Claude Code 실행") { store.startClaude(in: url.path) }
                }
            } label: {
                ToolLabel(title: "브랜치", icon: "arrow.triangle.branch")
            } primaryAction: {
                store.requestNewBranch()
            }
            .hoverTip("브랜치", "지금 위치에서 새 브랜치를 만듭니다. ▾ 에서 새 워크트리, Claude Code 실행.", shortcut: "⇧⌘B")

            if let t = store.target {
                Button { store.sheet = .createPullRequest } label: {
                    ToolLabel(title: "새 \(t.provider.requestShort)", icon: "arrow.triangle.pull")
                }
                .disabled(store.headBranch == nil)
                .hoverTip("새 \(t.provider.requestShort)", "현재 브랜치(\(store.headBranch ?? "-"))로 \(t.provider.requestName)를 만듭니다. 필요하면 먼저 Push 합니다.")
            }

            Menu {
                Button("Stash… (변경 임시 보관)") { store.sheet = .stash }
                    .disabled(store.status.isEmpty)
                Button("Pop (가장 최근 stash 꺼내기)") { Task { await store.stashPop() } }
                    .disabled(store.stashes.isEmpty)
            } label: {
                ToolLabel(title: store.stashes.isEmpty ? "Stash" : "Stash \(store.stashes.count)", icon: "tray.and.arrow.down")
            } primaryAction: {
                if !store.status.isEmpty { store.sheet = .stash } else { Task { await store.stashPop() } }
            }
            .disabled(store.status.isEmpty && store.stashes.isEmpty)
            .hoverTip("Stash",
                      (store.status.isEmpty ? "가장 최근에 보관한 변경을 꺼냅니다(Pop)." : "커밋하지 않은 변경을 임시로 보관합니다.")
                        + (store.stashes.isEmpty ? "" : " 보관된 stash \(store.stashes.count)개.") + " ▾ 에서 Stash·Pop 선택.",
                      shortcut: "⇧⌘S")

            Button { store.toggleTerminal() } label: {
                ToolLabel(title: "터미널", icon: store.showTerminal ? "apple.terminal.fill" : "apple.terminal")
            }
            .hoverTip("터미널",
                      store.showTerminal ? "아래 터미널 패널을 숨깁니다. 셸은 계속 실행됩니다."
                                         : "그래프 아래에 이 저장소 폴더의 터미널을 엽니다. git 명령을 치면 그래프가 바로 갱신됩니다.",
                      shortcut: "⌃`")
        }
    }
}

/// 오른쪽 열: 작업 영역 또는 커밋 상세
struct InspectorView: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        switch store.selection {
        case .wip?:
            WorkingChangesView()
        case .commit(let sha)?:
            CommitDetailView(sha: sha)
        case .pullRequest(let n)?:
            PullRequestDetailView(number: n)
        case nil:
            ContentUnavailableView("선택된 커밋 없음", systemImage: "point.3.connected.trianglepath.dotted",
                                   description: Text("그래프에서 커밋을 선택하세요."))
        }
    }
}

/// 툴바 버튼 모양: 아이콘만. 무슨 버튼인지는 마우스를 올리면 설명 풍선(hoverTip)으로 보여 준다.
struct ToolLabel: View {
    let title: String
    let icon: String

    var body: some View {
        Label(title, systemImage: icon)
            .labelStyle(.iconOnly)
    }
}
