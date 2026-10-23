import SwiftUI

enum GraphMetrics {
    static let laneWidth: CGFloat = 22
    static let rowHeight: CGFloat = 30
    static let leftPad: CGFloat = 6
    static let maxVisibleLanes = 16
    /// 왼쪽 브랜치·태그 칸 너비
    static let refWidth: CGFloat = 190
    /// 커밋 동그라미(프로필) 지름
    static let avatar: CGFloat = 20

    static func width(lanes: Int) -> CGFloat {
        max(44, CGFloat(min(lanes, maxVisibleLanes)) * laneWidth + leftPad * 2)
    }

    /// 그래프 행의 칸 너비. 좁은 화면에서는 커밋 메시지 칸을 지키려고 다른 칸을 숨기거나 줄인다.
    struct Columns: Equatable {
        var ref = GraphMetrics.refWidth
        var graph: CGFloat
        var author = true
        var date = true
        var sha = true
    }

    private static let messageMin: CGFloat = 180

    /// SHA → 날짜 칸을 숨기고, 브랜치 칸을 조금 줄이고, 작성자 칸을 숨기고, 브랜치 칸을 더 줄이고,
    /// 그래도 모자라면 그래프 칸(오른쪽 레인은 잘림)을 줄인다
    static func columns(width: CGFloat, graph: CGFloat) -> Columns {
        var c = Columns(graph: graph)
        // 메시지 왼쪽 여백 8, 행 오른쪽 여백 12, 작성자·날짜·SHA 는 왼쪽 여백 8 씩
        func short() -> CGFloat {
            messageMin - (width - (c.ref + c.graph + 20 + (c.author ? 128 : 0) + (c.date ? 98 : 0) + (c.sha ? 68 : 0)))
        }
        func shrinkRef(_ min: CGFloat) { if short() > 0 { c.ref = max(min, c.ref - short()) } }
        if short() > 0 { c.sha = false }
        if short() > 0 { c.date = false }
        shrinkRef(150)
        if short() > 0 { c.author = false }
        shrinkRef(110)
        if short() > 0 { c.graph = max(min(graph, 66), c.graph - short()) }
        return c
    }
}

struct GraphView: View {
    @Environment(RepoStore.self) private var store
    @FocusState private var focused: Bool
    @ViewState private var width: CGFloat = 1000

    var body: some View {
        let graphWidth = GraphMetrics.width(lanes: store.maxLanes)
        // 좁은 화면에서는 SHA·날짜·작성자 칸을 숨기고 브랜치·그래프 칸을 줄여 커밋 메시지 칸을 지킨다
        let columns = GraphMetrics.columns(width: width, graph: graphWidth)
        VStack(spacing: 0) {
            SearchBar()
            Divider()
            GraphHeader(columns: columns)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(store.entries) { entry in
                            CommitRow(entry: entry,
                                      graphWidth: graphWidth,
                                      columns: columns,
                                      refs: store.refsByCommit[entry.id] ?? [],
                                      selected: isSelected(entry),
                                      isHead: entry.id == store.headHash,
                                      wipCount: entry.commit.isWIP ? store.status.count : 0,
                                      match: matchState(entry),
                                      ci: store.ciBySha[entry.id])
                                .id(entry.id)
                                .onTapGesture {
                                    focused = true
                                    store.select(entry.commit.isWIP ? .wip : .commit(entry.id))
                                }
                                // VoiceOver 등 접근성: 행 하나를 버튼처럼(메시지·작성자·날짜를 한 번에 읽고 눌러서 선택)
                                .accessibilityElement(children: .combine)
                                .accessibilityAddTraits(.isButton)
                                .accessibilityAction { store.select(entry.commit.isWIP ? .wip : .commit(entry.id)) }
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
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
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

            GraphFilterMenu()

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
    let columns: GraphMetrics.Columns

    var body: some View {
        HStack(spacing: 0) {
            Text("브랜치 / 태그").padding(.leading, 10).frame(width: columns.ref, alignment: .leading)
            Text("그래프").padding(.leading, 6).frame(width: columns.graph, alignment: .leading)
            Text("커밋 메시지").padding(.leading, 8).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            Group {
                if columns.author { Text("작성자").frame(width: 120, alignment: .leading).padding(.leading, 8) }
                if columns.date { Text("날짜").frame(width: 90, alignment: .leading).padding(.leading, 8) }
                if columns.sha { Text("SHA").frame(width: 60, alignment: .leading).padding(.leading, 8) }
            }
        }
        .lineLimit(1)
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.trailing, 12)
        .frame(height: 26)
        .background(.bar)
    }
}

/// 그래프 거르기: 현재 브랜치만 보기, 숨긴 브랜치 다시 보이기
private struct GraphFilterMenu: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        let hidden = store.hiddenRefs.count
        let active = store.graphCurrentOnly || hidden > 0
        Menu {
            Toggle("현재 브랜치만 보기", isOn: Binding(get: { store.graphCurrentOnly }, set: { on in Task { await store.setCurrentOnly(on) } }))
            Divider()
            Button(hidden > 0 ? "숨긴 브랜치 \(hidden)개 모두 보이기" : "숨긴 브랜치 없음") { Task { await store.showAllBranches() } }
                .disabled(hidden == 0)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                if store.graphCurrentOnly { Text("현재 브랜치만").font(.caption) }
                else if hidden > 0 { Text("숨김 \(hidden)").font(.caption) }
            }
            .foregroundStyle(active ? Color.accentColor : .secondary)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("그래프 거르기 — 현재 브랜치만 보기, 숨긴 브랜치(사이드바 우클릭으로 숨김) 다시 보이기")
        .accessibilityLabel("그래프 거르기")
    }
}
