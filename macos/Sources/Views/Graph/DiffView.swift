import SwiftUI
import AppKit

/// 파일 하나의 변경 내용. 그래프 자리를 대신 차지하고, ← 또는 Esc 로 그래프로 돌아간다.
/// 한 줄로 / 나란히 보기, 공백 무시, 단어 단위 강조, 이미지 비교, 덩어리·줄 단위 스테이지.
struct DiffView: View {
    @Environment(RepoStore.self) private var store
    let source: DiffSource

    var body: some View {
        let change = source.change
        let _ = store.diffSettingsVersion
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
                fileButtons(change)
                viewOptions
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
                } else if let images = store.diffImages {
                    ImageDiffView(images: images)
                } else if doc.isBinary {
                    ContentUnavailableView("바이너리 파일", systemImage: "doc.zipper",
                                           description: Text("텍스트가 아닌 파일이라 줄 단위 비교를 표시하지 않습니다."))
                } else if doc.lines.isEmpty {
                    ContentUnavailableView("표시할 변경 없음", systemImage: "equal.circle",
                                           description: Text(store.diffIgnoreWhitespace ? "공백만 바뀌었습니다(공백 무시를 끄면 보입니다)."
                                                                                       : "내용 변경 없이 권한·이름만 바뀌었을 수 있습니다."))
                } else {
                    DiffLinesView(doc: doc, split: store.diffSplit, editable: store.canEditDiffLines,
                                  staged: { if case .working(let c) = source { return c.staged } else { return false } }())
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
        case .review(let n, let c, _):
            return "\(c.oldPath.map { "\($0) → " } ?? "")\(c.path) · \(store.target?.provider.requestShort ?? "PR") #\(n)"
        }
    }

    /// 이 파일의 히스토리·blame 열기
    @ViewBuilder
    private func fileButtons(_ c: FileChange) -> some View {
        if c.kind != .untracked, !isReview {
            Button { store.openFileHistory(c.path) } label: { Image(systemName: "clock.arrow.circlepath") }
                .buttonStyle(.borderless)
                .help("파일 히스토리 — 이 파일을 바꾼 커밋들")
                .accessibilityLabel("파일 히스토리")
            if c.kind != .deleted {
                Button {
                    if case .commit(let sha, _, _) = source { store.openBlame(c.path, rev: sha) } else { store.openBlame(c.path) }
                } label: { Image(systemName: "person.text.rectangle") }
                    .buttonStyle(.borderless)
                    .help("줄별 작성자(blame) — 줄마다 누가 언제 바꿨는지")
                    .accessibilityLabel("줄별 작성자")
            }
        }
    }

    private var isReview: Bool { if case .review = source { return true } else { return false } }

    /// 보기: 한 줄로 / 나란히, 공백 무시
    private var viewOptions: some View {
        HStack(spacing: 6) {
            Picker("", selection: Binding(get: { store.diffSplit }, set: { store.diffSplit = $0 })) {
                Image(systemName: "list.bullet").help("한 줄로 보기").accessibilityLabel("한 줄로 보기").tag(false)
                Image(systemName: "rectangle.split.2x1").help("나란히 보기(왼쪽 이전 · 오른쪽 이후)").accessibilityLabel("나란히 보기").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Toggle(isOn: Binding(get: { store.diffIgnoreWhitespace }, set: { store.diffIgnoreWhitespace = $0 })) {
                Image(systemName: "space").accessibilityLabel("공백 무시")
            }
            .toggleStyle(.button)
            .help("공백 무시 — 들여쓰기·공백만 바뀐 줄은 같은 것으로 봅니다(켜 두면 줄 단위 스테이지는 쓸 수 없습니다)")
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

/// diff 줄 목록(한 줄로 / 나란히). 파일 히스토리에서도 쓴다.
struct DiffLinesView: View {
    @Environment(RepoStore.self) private var store
    let doc: DiffDocument
    let split: Bool
    let editable: Bool
    let staged: Bool

    var body: some View {
        GeometryReader { geo in
            ScrollView(split ? [.vertical] : [.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if split {
                        ForEach(doc.splitRows) { row in
                            if let f = row.full {
                                fullRow(doc.lines[f])
                            } else {
                                HStack(spacing: 0) {
                                    cell(row.left.map { doc.lines[$0] }, side: .left)
                                        .frame(width: geo.size.width / 2, alignment: .leading)
                                    Divider()
                                    cell(row.right.map { doc.lines[$0] }, side: .right)
                                        .frame(width: geo.size.width / 2 - 1, alignment: .leading)
                                }
                            }
                        }
                    } else {
                        ForEach(doc.lines) { line in
                            if line.kind == .hunk || line.kind == .meta { fullRow(line) } else { lineRow(line) }
                        }
                    }
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

    enum Side { case left, right }

    @ViewBuilder
    private func fullRow(_ line: DiffLine) -> some View {
        if line.kind == .hunk, let h = line.hunk {
            HunkHeader(line: line, hunk: h, editable: editable, staged: staged)
        } else {
            DiffLineRow(line: line, showOld: true, showNew: true, selected: false)
        }
    }

    private func lineRow(_ line: DiffLine) -> some View {
        DiffLineRow(line: line, showOld: true, showNew: true, selected: store.diffSelection.contains(line.id))
            .modifier(Selectable(line: line, enabled: editable))
    }

    @ViewBuilder
    private func cell(_ line: DiffLine?, side: Side) -> some View {
        if let line {
            DiffLineRow(line: line, showOld: side == .left, showNew: side == .right, selected: store.diffSelection.contains(line.id),
                        clip: true)
                .modifier(Selectable(line: line, enabled: editable))
                .frame(maxWidth: .infinity, alignment: .leading)
                .clipped()
        } else {
            Color.secondary.opacity(0.06).frame(maxWidth: .infinity).frame(height: 17)
        }
    }
}

/// 바뀐 줄을 누르면 고르기(Shift 로 범위). 고른 줄은 덩어리 머리의 버튼으로 스테이지·언스테이지·버리기.
private struct Selectable: ViewModifier {
    @Environment(RepoStore.self) private var store
    let line: DiffLine
    let enabled: Bool

    func body(content: Content) -> some View {
        if enabled, line.kind == .added || line.kind == .removed {
            content
                .contentShape(Rectangle())
                .onTapGesture { store.toggleDiffLine(line, extend: NSEvent.modifierFlags.contains(.shift)) }
                .help("눌러서 이 줄 고르기(Shift: 범위) — 고른 줄만 스테이지할 수 있습니다")
        } else {
            content
        }
    }
}

/// @@ 줄: 덩어리 위치 + (작업 트리 diff 면) 덩어리·고른 줄 스테이지·언스테이지·버리기
private struct HunkHeader: View {
    @Environment(RepoStore.self) private var store
    let line: DiffLine
    let hunk: Int
    let editable: Bool
    let staged: Bool

    var body: some View {
        let picked = editable ? store.selectedCount(inHunk: hunk) : 0
        HStack(spacing: 8) {
            Text(line.text)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color(red: 0.25, green: 0.45, blue: 0.85))
                .lineLimit(1)
            Spacer(minLength: 8)
            if editable {
                if staged {
                    Button(picked > 0 ? "고른 줄 언스테이지 (\(picked))" : "덩어리 언스테이지") {
                        Task { await store.applyLines(.unstage, hunk: hunk) }
                    }
                    .help(picked > 0 ? "고른 줄만 스테이지에서 뺍니다" : "이 덩어리를 스테이지에서 뺍니다")
                } else {
                    Button(picked > 0 ? "고른 줄 버리기…" : "덩어리 버리기…") { store.confirmDiscardLines(hunk: hunk) }
                        .help(picked > 0 ? "고른 줄의 변경을 작업 트리에서 버립니다" : "이 덩어리의 변경을 작업 트리에서 버립니다")
                    Button(picked > 0 ? "고른 줄 스테이지 (\(picked))" : "덩어리 스테이지") {
                        Task { await store.applyLines(.stage, hunk: hunk) }
                    }
                    .buttonStyle(.borderedProminent)
                    .help(picked > 0 ? "고른 줄만 스테이지합니다" : "이 덩어리만 스테이지합니다(바뀐 줄을 눌러 고르면 그 줄만)")
                }
            }
        }
        .controlSize(.small)
        .padding(.horizontal, 10)
        .padding(.vertical, editable ? 3 : 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.blue.opacity(0.07))
    }
}

private struct DiffLineRow: View {
    let line: DiffLine
    var showOld = true
    var showNew = true
    var selected = false
    /// 나란히 보기: 칸 너비에 맞춰 넘치는 부분은 자른다(가로 스크롤 대신)
    var clip = false

    var body: some View {
        HStack(spacing: 0) {
            if showOld {
                Text(line.oldNo.map(String.init) ?? "")
                    .frame(width: 44, alignment: .trailing)
                    .foregroundStyle(.tertiary)
            }
            if showNew {
                Text(line.newNo.map(String.init) ?? "")
                    .frame(width: 44, alignment: .trailing)
                    .foregroundStyle(.tertiary)
            }
            Text(marker)
                .frame(width: 20)
                .foregroundStyle(markerColor)
            Text(content)
                .foregroundStyle(textColor)
                .lineLimit(1)
                .fixedSize(horizontal: !clip, vertical: false)
                .help(clip && line.text.count > 60 ? line.text : "")
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(.vertical, 0.5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background)
        .overlay(alignment: .leading) {
            if selected { Rectangle().fill(Color.accentColor).frame(width: 3) }
        }
    }

    /// 단어 단위로 바뀐 부분을 진하게
    private var content: AttributedString {
        var s = AttributedString(line.text.isEmpty ? " " : line.text)
        guard !line.changes.isEmpty else { return s }
        let strong = line.kind == .added ? Color.green.opacity(0.32) : Color.red.opacity(0.30)
        let chars = Array(line.text)
        for r in line.changes where r.lowerBound >= 0 && r.upperBound <= chars.count {
            let lo = s.index(s.startIndex, offsetByCharacters: r.lowerBound)
            let hi = s.index(s.startIndex, offsetByCharacters: r.upperBound)
            s[lo..<hi].backgroundColor = strong
        }
        return s
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
        if selected { return Color.accentColor.opacity(0.22) }
        switch line.kind {
        case .added: return Color.green.opacity(0.14)
        case .removed: return Color.red.opacity(0.14)
        case .hunk: return Color.blue.opacity(0.07)
        default: return .clear
        }
    }
}

/// 이미지 파일: 바뀌기 전과 후를 나란히(크기·용량 함께)
private struct ImageDiffView: View {
    let images: DiffImages

    var body: some View {
        HStack(spacing: 0) {
            pane("이전", images.old, tint: .red)
            Divider()
            pane("이후", images.new, tint: .green)
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    private func pane(_ title: String, _ data: Data?, tint: Color) -> some View {
        VStack(spacing: 8) {
            HStack {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(tint)
                Spacer()
                if let data, let img = NSImage(data: data) {
                    let px = img.representations.first.map { "\($0.pixelsWide) × \($0.pixelsHigh)" } ?? ""
                    Text("\(px) · \(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file))")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            if let data, let img = NSImage(data: data) {
                Image(nsImage: img)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(CheckerBoard().opacity(0.5))
                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(tint.opacity(0.5)))
            } else {
                ContentUnavailableView(data == nil ? "없음" : "열 수 없는 이미지", systemImage: "photo",
                                       description: Text(data == nil ? (title == "이전" ? "새로 추가된 파일입니다." : "지운 파일입니다.") : ""))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 투명한 부분이 보이게 깔아 두는 체크 무늬
private struct CheckerBoard: View {
    var body: some View {
        Canvas { ctx, size in
            let s: CGFloat = 8
            for y in stride(from: 0, to: size.height, by: s) {
                for x in stride(from: 0, to: size.width, by: s) where (Int(x / s) + Int(y / s)) % 2 == 0 {
                    ctx.fill(Path(CGRect(x: x, y: y, width: s, height: s)), with: .color(.secondary.opacity(0.15)))
                }
            }
        }
    }
}
