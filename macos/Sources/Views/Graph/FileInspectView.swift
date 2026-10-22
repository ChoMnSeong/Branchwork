import SwiftUI

/// 파일 히스토리 · 줄별 작성자(blame). 그래프 자리를 대신 차지하고, Esc 로 돌아간다.
struct FileInspectView: View {
    @Environment(RepoStore.self) private var store
    let inspect: FileInspect

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { store.closeFileInspect() } label: { Label("그래프", systemImage: "chevron.left") }
                    .keyboardShortcut(.escape, modifiers: [])
                    .help("그래프로 돌아가기 (Esc)")
                Image(systemName: inspect.mode == .history ? "clock.arrow.circlepath" : "person.text.rectangle")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 0) {
                    Text((inspect.path as NSString).lastPathComponent).font(.headline).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
                Spacer()
                if store.fileInspectLoading { ProgressView().controlSize(.small) }
                Picker("", selection: Binding(get: { inspect.mode }, set: { store.setFileInspectMode($0) })) {
                    Text("히스토리").tag(FileInspect.Mode.history)
                    Text("줄별 작성자").tag(FileInspect.Mode.blame)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .help("이 파일을 바꾼 커밋들 / 줄마다 누가 언제 바꿨는지")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
            Divider()

            if let error = store.fileInspectError {
                ContentUnavailableView("읽지 못했습니다", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if inspect.mode == .history {
                HistoryPane()
            } else {
                BlamePane()
            }
        }
    }

    private var subtitle: String {
        switch inspect.mode {
        case .history: return "\(inspect.path) · 커밋 \(store.fileHistory.count)개"
        case .blame: return "\(inspect.path) · " + (inspect.rev.map { "커밋 \($0.prefix(7)) 기준" } ?? "작업 트리 기준")
        }
    }
}

/// 위: 이 파일을 바꾼 커밋들, 아래: 고른 커밋에서의 변경
private struct HistoryPane: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        VSplitView {
            List(store.fileHistory, selection: Binding(get: { store.fileHistorySelected }, set: { id in
                if let e = store.fileHistory.first(where: { $0.id == id }) { Task { await store.selectHistory(e) } }
            })) { e in
                HStack(spacing: 8) {
                    AuthorAvatar(name: e.commit.author, email: e.commit.email, size: 18)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(e.commit.subject).lineLimit(1)
                        HStack(spacing: 6) {
                            Text(e.commit.author)
                            Text(Fmt.short(e.commit.date))
                            if e.path != store.fileInspect?.path {
                                Text("이전 이름: \(e.path)").foregroundStyle(.orange)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(e.commit.short).font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                .tag(e.id)
                .contextMenu {
                    Button("그래프에서 이 커밋 보기") { store.closeFileInspect(); store.reveal(e.commit.id) }
                    Button("이 커밋 기준 줄별 작성자 보기") { store.openBlame(e.path, rev: e.commit.id) }
                    Button("SHA 복사") { store.copy(e.commit.id) }
                }
            }
            .frame(minHeight: 90, idealHeight: CGFloat(min(8, max(2, store.fileHistory.count))) * 38 + 12, maxHeight: 420)

            Group {
                if let doc = store.fileHistoryDiff {
                    if let error = doc.error {
                        ContentUnavailableView("변경을 읽지 못했습니다", systemImage: "exclamationmark.triangle", description: Text(error))
                    } else if doc.isBinary {
                        ContentUnavailableView("바이너리 파일", systemImage: "doc.zipper")
                    } else if doc.lines.isEmpty {
                        ContentUnavailableView("내용 변경 없음", systemImage: "equal.circle", description: Text("이름·권한만 바뀌었을 수 있습니다."))
                    } else {
                        DiffLinesView(doc: doc, split: store.diffSplit, editable: false, staged: false)
                    }
                } else if !store.fileHistory.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if !store.fileInspectLoading {
                    ContentUnavailableView("히스토리 없음", systemImage: "clock", description: Text("아직 커밋되지 않은 파일입니다."))
                }
            }
            .frame(minHeight: 160, idealHeight: 600)
        }
    }
}

/// 줄마다 마지막으로 바꾼 커밋. 같은 커밋이 이어지면 첫 줄에만 작성자·날짜, 오래된 줄일수록 옅은 띠.
private struct BlamePane: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        let lines = store.blameLines
        let committed = lines.filter { !$0.uncommitted }
        let oldest = committed.map(\.date).min() ?? Date()
        let newest = committed.map(\.date).max() ?? Date()
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(lines) { l in
                    HStack(spacing: 0) {
                        gutter(l)
                            .frame(width: 240, alignment: .leading)
                            .background(age(l, oldest, newest))
                        Text("\(l.id)")
                            .frame(width: 44, alignment: .trailing)
                            .foregroundStyle(.tertiary)
                            .padding(.trailing, 8)
                        Text(l.text.isEmpty ? " " : l.text)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .font(.system(size: 12, design: .monospaced))
                    .frame(height: 18)
                    .overlay(alignment: .top) {
                        if l.startsBlock && l.id > 1 { Divider().opacity(0.6) }
                    }
                }
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .overlay {
            if lines.isEmpty && !store.fileInspectLoading {
                ContentUnavailableView("내용 없음", systemImage: "doc", description: Text("빈 파일이거나 아직 커밋되지 않았습니다."))
            }
        }
    }

    @ViewBuilder
    private func gutter(_ l: BlameLine) -> some View {
        if l.startsBlock {
            HStack(spacing: 6) {
                if l.uncommitted {
                    Text("커밋하지 않음").foregroundStyle(.orange)
                } else {
                    AuthorAvatar(name: l.author, email: l.email, size: 14)
                    Text(l.author).lineLimit(1).frame(maxWidth: 80, alignment: .leading)
                    Text(Fmt.short(l.date)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 2)
                    Text(String(l.sha.prefix(7))).foregroundStyle(.secondary)
                }
            }
            .font(.system(size: 11))
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
            .help(l.uncommitted ? "아직 커밋하지 않은 줄" : "\(l.summary)\n\(l.author) · \(Fmt.long(l.date))\n눌러서 그래프에서 이 커밋 보기")
            .onTapGesture {
                guard !l.uncommitted else { return }
                store.closeFileInspect()
                store.reveal(l.sha)
            }
        } else {
            Color.clear
        }
    }

    /// 최근일수록 진한 띠(가장 오래된 줄은 거의 투명)
    private func age(_ l: BlameLine, _ oldest: Date, _ newest: Date) -> Color {
        if l.uncommitted { return Color.orange.opacity(0.12) }
        let span = max(1, newest.timeIntervalSince(oldest))
        let t = l.date.timeIntervalSince(oldest) / span
        return Color.accentColor.opacity(0.04 + 0.16 * t)
    }
}
