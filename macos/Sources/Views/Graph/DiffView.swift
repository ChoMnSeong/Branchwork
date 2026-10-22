import SwiftUI

/// 파일 하나의 변경 내용. 그래프 자리를 대신 차지하고, ← 또는 Esc 로 그래프로 돌아간다.
struct DiffView: View {
    @Environment(RepoStore.self) private var store
    let source: DiffSource

    var body: some View {
        let change = source.change
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { store.closeDiff() } label: {
                    Label("그래프", systemImage: "chevron.left")
                }
                .keyboardShortcut(.escape, modifiers: [])
                .help("그래프로 돌아가기 (Esc)")

                StatusBadge(kind: change.kind)
                VStack(alignment: .leading, spacing: 0) {
                    Text(change.fileName).font(.headline).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
                Spacer()
                actions(change)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
            Divider()

            if let doc = store.diff {
                if let error = doc.error {
                    ContentUnavailableView("변경 내용을 불러오지 못했습니다", systemImage: "exclamationmark.triangle",
                                           description: Text(error))
                } else if doc.isBinary {
                    ContentUnavailableView("바이너리 파일", systemImage: "doc.zipper",
                                           description: Text("텍스트가 아닌 파일이라 줄 단위 비교를 표시하지 않습니다."))
                } else if doc.lines.isEmpty {
                    ContentUnavailableView("표시할 변경 없음", systemImage: "equal.circle",
                                           description: Text("내용 변경 없이 권한·이름만 바뀌었을 수 있습니다."))
                } else {
                    DiffLinesView(doc: doc)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var subtitle: String {
        switch source {
        case .working(let c):
            let where_ = c.kind == .conflicted ? "충돌" : (c.staged ? "스테이지됨" : "작업 트리")
            return "\(c.path) · \(where_)"
        case .commit(let sha, let c, _):
            return "\(c.oldPath.map { "\($0) → " } ?? "")\(c.path) · 커밋 \(sha.prefix(7))"
        }
    }

    @ViewBuilder
    private func actions(_ c: FileChange) -> some View {
        if case .working = source {
            if c.kind == .conflicted {
                Button("해결됨으로 표시") { Task { await store.stage([c]) } }
            } else if c.staged {
                Button("언스테이지") { Task { await store.unstage([c]) } }
            } else {
                Button("변경 버리기…", role: .destructive) { store.confirmDiscard(c) }
                Button("스테이지") { Task { await store.stage([c]) } }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}

private struct DiffLinesView: View {
    let doc: DiffDocument

    var body: some View {
        GeometryReader { geo in
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(doc.lines) { DiffLineRow(line: $0) }
                    if doc.truncated {
                        Text("… 변경이 너무 길어 앞부분만 표시합니다")
                            .foregroundStyle(.secondary)
                            .padding(12)
                    }
                }
                .frame(minWidth: geo.size.width, alignment: .leading)
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
    }
}

private struct DiffLineRow: View {
    let line: DiffLine

    var body: some View {
        HStack(spacing: 0) {
            Text(line.oldNo.map(String.init) ?? "")
                .frame(width: 48, alignment: .trailing)
                .foregroundStyle(.tertiary)
            Text(line.newNo.map(String.init) ?? "")
                .frame(width: 48, alignment: .trailing)
                .foregroundStyle(.tertiary)
            Text(marker)
                .frame(width: 22)
                .foregroundStyle(markerColor)
            Text(line.text.isEmpty ? " " : line.text)
                .foregroundStyle(textColor)
                .fixedSize(horizontal: true, vertical: false)
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(.vertical, line.kind == .hunk ? 4 : 0.5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background)
    }

    private var marker: String {
        switch line.kind {
        case .added: return "+"
        case .removed: return "−"
        default: return ""
        }
    }

    private var markerColor: Color {
        line.kind == .added ? .green : (line.kind == .removed ? .red : .secondary)
    }

    private var textColor: Color {
        switch line.kind {
        case .hunk: return Color(red: 0.25, green: 0.45, blue: 0.85)
        case .meta: return .secondary
        default: return .primary
        }
    }

    private var background: Color {
        switch line.kind {
        case .added: return Color.green.opacity(0.14)
        case .removed: return Color.red.opacity(0.14)
        case .hunk: return Color.blue.opacity(0.07)
        default: return .clear
        }
    }
}
