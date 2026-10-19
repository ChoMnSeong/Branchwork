import SwiftUI

enum GraphMetrics {
    static let laneWidth: CGFloat = 16
    static let rowHeight: CGFloat = 28
    static let leftPad: CGFloat = 6
    static let maxVisibleLanes = 18

    static func width(lanes: Int) -> CGFloat {
        max(44, CGFloat(min(lanes, maxVisibleLanes)) * laneWidth + leftPad * 2)
    }
}

struct GraphView: View {
    @Environment(RepoStore.self) private var store
    @FocusState private var focused: Bool

    var body: some View {
        let graphWidth = GraphMetrics.width(lanes: store.maxLanes)
        VStack(spacing: 0) {
            SearchBar()
            Divider()
            GraphHeader(graphWidth: graphWidth)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(store.entries) { entry in
                            CommitRow(entry: entry,
                                      graphWidth: graphWidth,
                                      refs: store.refsByCommit[entry.id] ?? [],
                                      selected: isSelected(entry),
                                      isHead: entry.id == store.headHash,
                                      wipCount: store.status.count,
                                      match: matchState(entry))
                                .id(entry.id)
                                .onTapGesture {
                                    focused = true
                                    store.select(entry.commit.isWIP ? .wip : .commit(entry.id))
                                }
                                .contextMenu { CommitMenu(commit: entry.commit) }
                        }
                        if store.hasMore {
                            Button("커밋 더 불러오기") { Task { await store.loadMore() } }
                                .padding(12)
                        }
                    }
                }
                .focusable()
                .focused($focused)
                .focusEffectDisabled()
                .onKeyPress(.upArrow) { store.moveSelection(-1); return .handled }
                .onKeyPress(.downArrow) { store.moveSelection(1); return .handled }
                .onChange(of: store.scrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(target, anchor: .center) }
                    store.scrollTarget = nil
                }
                .onAppear {
                    if let target = store.selectedID { proxy.scrollTo(target, anchor: .center) }
                }
            }
        }
        .overlay {
            if store.entries.isEmpty {
                ContentUnavailableView("아직 커밋이 없습니다", systemImage: "circle.dotted",
                                       description: Text("파일을 만들고 오른쪽에서 첫 커밋을 해 보세요."))
            }
        }
        .confirmationDialog(store.dropRequest?.title ?? "",
                            isPresented: Binding(get: { store.dropRequest != nil }, set: { if !$0 { store.dropRequest = nil } }),
                            titleVisibility: .visible,
                            presenting: store.dropRequest) { req in
            ForEach(req.choices) { c in
                Button(c.title, role: c.destructive ? .destructive : nil) { Task { await c.action() } }
            }
            Button(req.choices.isEmpty ? "확인" : "취소", role: .cancel) {}
        } message: { req in
            Text(req.message)
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    /// 검색 중이면 일치하는 행은 강조, 나머지는 흐리게
    private func matchState(_ e: GraphEntry) -> CommitRow.Match {
        guard store.isSearching, !store.searching || !store.searchMatchSet.isEmpty else { return .none }
        return store.searchMatchSet.contains(e.id) ? .hit : .miss
    }

    private func isSelected(_ e: GraphEntry) -> Bool {
        switch store.selection {
        case .wip?: return e.commit.isWIP
        case .commit(let s)?: return e.id == s
        case .pullRequest?, nil: return false
        }
    }
}

extension RepoStore {
    var selectedID: String? {
        switch selection {
        case .wip?: return Commit.wipID
        case .commit(let s)?: return s
        case .pullRequest?, nil: return nil
        }
    }
}

/// 그래프 위 검색 줄
private struct SearchBar: View {
    @Environment(RepoStore.self) private var store
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var store = store
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(store.searchScope.prompt, text: $store.searchText)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .onSubmit { store.nextMatch() }
                    .onKeyPress(.escape) {
                        store.clearSearch()
                        focused = false
                        return .handled
                    }
                if store.searching { ProgressView().controlSize(.small) }
                if !store.searchText.isEmpty {
                    Button { store.clearSearch() } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                        .help("검색 지우기 (Esc)")
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(RoundedRectangle(cornerRadius: 7).fill(Color(nsColor: .controlBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 7)
                .strokeBorder(focused ? Color.accentColor.opacity(0.7) : Color.secondary.opacity(0.25)))

            Picker("", selection: $store.searchScope) {
                ForEach(SearchScope.allCases) { Text($0.title).tag($0) }
            }
            .labelsHidden()
            .fixedSize()
            .help("검색 대상")

            if store.isSearching {
                Text(resultText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                ControlGroup {
                    Button { store.previousMatch() } label: { Image(systemName: "chevron.up") }
                        .help("이전 결과 (⇧⌘G)")
                    Button { store.nextMatch() } label: { Image(systemName: "chevron.down") }
                        .help("다음 결과 (⌘G · Enter)")
                }
                .fixedSize()
                .disabled(store.searchMatches.isEmpty)
                if store.searchUnloaded > 0 && store.hasMore {
                    Button("더 불러와서 찾기") { Task { await store.loadMoreForSearch() } }
                        .controlSize(.small)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .onChange(of: store.searchText) { store.updateSearch() }
        .onChange(of: store.searchScope) { store.updateSearch() }
        .onChange(of: store.searchFocusRequest) { focused = true }
    }

    private var resultText: String {
        if store.searchMatches.isEmpty {
            return store.searching ? "찾는 중…" : "결과 없음"
        }
        let pos = store.searchPosition.map(String.init) ?? "–"
        var s = "\(pos)/\(store.searchMatches.count)"
        if store.searchUnloaded > 0 { s += " · 그래프 밖 \(store.searchUnloaded)" }
        return s
    }
}

private struct GraphHeader: View {
    let graphWidth: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            Text("그래프").frame(width: graphWidth, alignment: .leading).padding(.leading, 6)
            Text("커밋 메시지").frame(maxWidth: .infinity, alignment: .leading)
            Text("작성자").frame(width: 120, alignment: .leading)
            Text("날짜").frame(width: 90, alignment: .leading)
            Text("SHA").frame(width: 60, alignment: .leading)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.trailing, 12)
        .frame(height: 26)
        .background(.bar)
    }
}

private struct CommitRow: View {
    enum Match { case none, hit, miss }

    @Environment(RepoStore.self) private var store
    @ViewState private var dropTargeted = false

    let entry: GraphEntry
    let graphWidth: CGFloat
    let refs: [RefLabel]
    let selected: Bool
    let isHead: Bool
    let wipCount: Int
    var match: Match = .none

    var body: some View {
        let c = entry.commit
        let tint = Palette.lane(entry.row.color)
        HStack(spacing: 8) {
            GraphCell(row: entry.row, isWIP: c.isWIP, isHead: isHead, isMerge: c.isMerge)
                .frame(width: graphWidth, height: GraphMetrics.rowHeight)
            HStack(spacing: 4) {
                ForEach(refs.prefix(3)) { ref in badge(ref, tint: tint) }
                if refs.count > 3 {
                    Text("+\(refs.count - 3)").font(.caption2).foregroundStyle(.secondary)
                        .help(refs.dropFirst(3).map(\.name).joined(separator: ", "))
                }
                if c.isWIP {
                    Text("// 작업 중인 변경").italic().foregroundStyle(.secondary)
                    Text("\(wipCount)개 파일")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(tint.opacity(0.18)))
                } else {
                    Text(c.subject)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .foregroundStyle(c.isMerge ? .secondary : .primary)
                }
            }
            // 배지가 길어도 오른쪽 열(작성자·날짜·SHA)을 밀어내지 않고 이 칸 안에서 잘리게
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            .clipped()
            Group {
                Text(c.author).frame(width: 120, alignment: .leading)
                Text(c.isWIP ? "" : Fmt.short(c.date)).frame(width: 90, alignment: .leading)
                Text(c.isWIP ? "" : c.short)
                    .font(.system(.caption, design: .monospaced))
                    .frame(width: 60, alignment: .leading)
            }
            .lineLimit(1)
            .foregroundStyle(.secondary)
        }
        .font(.system(size: 12.5))
        .padding(.trailing, 12)
        .frame(height: GraphMetrics.rowHeight)
        .opacity(match == .miss ? 0.32 : 1)
        .background(selected ? Color.accentColor.opacity(0.22) : (match == .hit ? Color.yellow.opacity(0.16) : Color.clear))
        .overlay(alignment: .leading) {
            if match == .hit { Rectangle().fill(Color.yellow).frame(width: 3) }
        }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 4).strokeBorder(Color.accentColor, lineWidth: 2)
                    .background(RoundedRectangle(cornerRadius: 4).fill(Color.accentColor.opacity(0.10)))
            }
        }
        .contentShape(Rectangle())
        // 커밋 줄을 끌어 브랜치에 놓으면 cherry-pick, 이 줄에 브랜치를 놓으면 머지·리베이스
        .draggable(RepoStore.commitPayload + c.id) {
            Label("커밋 \(c.short)  \(c.subject)", systemImage: "smallcircle.filled.circle")
                .lineLimit(1)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 6).fill(.regularMaterial))
        }
        .dropDestination(for: String.self) { items, _ in
            guard let payload = items.first, !c.isWIP else { return false }
            store.handleDrop(payload, onto: entry)
            return true
        } isTargeted: { dropTargeted = $0 && !c.isWIP }
    }
}

extension CommitRow {
    /// 브랜치 배지: 더블클릭 체크아웃, 우클릭 메뉴, 끌어서 다른 브랜치에 놓기
    @ViewBuilder
    func badge(_ ref: RefLabel, tint: Color) -> some View {
        let view = RefBadge(label: ref, color: tint)
            .contentShape(Rectangle())
            .contextMenu { RefMenu(ref: ref) }
        if ref.kind == .local || ref.kind == .remote {
            view
                .onTapGesture(count: 2) {
                    if let b = store.branch(named: ref.name) { Task { await store.checkout(b) } }
                }
                .draggable(RepoStore.branchPayload + ref.name) { RefBadge(label: ref, color: tint) }
                .help("더블클릭: 체크아웃 · 다른 브랜치 줄로 끌어 놓기: 머지·리베이스 · 우클릭: 메뉴")
        } else {
            view
        }
    }
}

/// 한 행의 그래프 조각: 위·아래로 이어지는 레인 선과 커밋 노드
struct GraphCell: View {
    let row: GraphRow
    let isWIP: Bool
    let isHead: Bool
    let isMerge: Bool

    var body: some View {
        Canvas { ctx, size in
            let h = size.height
            func x(_ lane: Double) -> CGFloat {
                GraphMetrics.leftPad + GraphMetrics.laneWidth * (CGFloat(lane) + 0.5)
            }
            for s in row.segments {
                let a = CGPoint(x: x(s.x1), y: h * s.y1)
                let b = CGPoint(x: x(s.x2), y: h * s.y2)
                var p = Path()
                p.move(to: a)
                if s.x1 == s.x2 {
                    p.addLine(to: b)
                } else {
                    let mid = (a.y + b.y) / 2
                    p.addCurve(to: b, control1: CGPoint(x: a.x, y: mid), control2: CGPoint(x: b.x, y: mid))
                }
                ctx.stroke(p, with: .color(Palette.lane(s.color)),
                           style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: s.dashed ? [3, 3] : []))
            }

            let color = Palette.lane(row.color)
            let center = CGPoint(x: x(Double(row.column)), y: h / 2)
            let r: CGFloat = isMerge ? 4 : 5.5
            let dot = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
            if isWIP {
                ctx.fill(Circle().path(in: dot), with: .color(Color(nsColor: .textBackgroundColor)))
                ctx.stroke(Circle().path(in: dot), with: .color(color), style: StrokeStyle(lineWidth: 2, dash: [2.5, 2]))
            } else {
                ctx.fill(Circle().path(in: dot.insetBy(dx: -1.5, dy: -1.5)), with: .color(Color(nsColor: .textBackgroundColor)))
                ctx.fill(Circle().path(in: dot), with: .color(color))
            }
            if isHead {
                ctx.stroke(Circle().path(in: dot.insetBy(dx: -4, dy: -4)), with: .color(color), lineWidth: 1.5)
            }
        }
    }
}

/// 그래프 행 우클릭 메뉴
private struct CommitMenu: View {
    @Environment(RepoStore.self) private var store
    let commit: Commit

    var body: some View {
        if commit.isWIP {
            Button("모두 스테이지") { Task { await store.stageAll() } }
            Button("Stash…") { store.sheet = .stash }
            Divider()
            Button("모든 변경 버리기…", role: .destructive) { store.confirmDiscardAll() }
        } else {
            let branches = (store.refsByCommit[commit.id] ?? []).filter { $0.kind == .local || $0.kind == .remote }
            if !branches.isEmpty {
                ForEach(branches) { r in
                    Menu("브랜치 '\(r.name)'") { RefMenu(ref: r) }
                }
                Divider()
            }
            if let current = store.headBranch, commit.id != store.headHash {
                Button("이 커밋을 '\(current)'에 머지") { Task { await store.merge(commit.id) } }
                Button("'\(current)'을(를) 이 커밋 위로 리베이스") { Task { await store.rebase(onto: commit.id) } }
                Divider()
            }
            Button("여기서 새 브랜치…") { store.requestNewBranch(from: commit.id, label: commit.short) }
            Button("여기에 태그…") { store.sheet = .tag(sha: commit.id) }
            Button("여기서 워크트리 만들기…") { store.sheet = .addWorktree(branch: nil, start: commit.id) }
            Divider()
            Button("이 커밋 체크아웃 (분리된 HEAD)") { Task { await store.checkoutDetached(commit.id) } }
            Button("Cherry-pick") { Task { await store.cherryPick(commit.id) } }
                .disabled(commit.id == store.headHash)
            Button("Revert (되돌리는 커밋 만들기)") { Task { await store.revert(commit.id) } }
            if store.headBranch != nil {
                Menu("현재 브랜치를 여기로 Reset") {
                    Button("Soft — 변경은 스테이지된 상태로 유지") { store.reset(to: commit.id, mode: .soft) }
                    Button("Mixed — 변경은 작업 트리에 유지") { store.reset(to: commit.id, mode: .mixed) }
                    Button("Hard — 변경까지 모두 버림…", role: .destructive) { store.reset(to: commit.id, mode: .hard) }
                }
            }
            Divider()
            Button("SHA 복사") { store.copy(commit.id) }
            Button("메시지 복사") { store.copy(commit.subject) }
        }
    }
}
