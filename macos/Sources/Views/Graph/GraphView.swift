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
        HStack(spacing: 0) {
            Text("브랜치 / 태그").frame(width: GraphMetrics.refWidth, alignment: .leading).padding(.leading, 10)
            Text("그래프").frame(width: graphWidth, alignment: .leading).padding(.leading, 6)
            Text("커밋 메시지").frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 8)
            Spacer().frame(width: 8)
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
