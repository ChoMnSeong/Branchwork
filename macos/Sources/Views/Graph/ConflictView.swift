import SwiftUI

/// 충돌 해결: 충돌 블록마다 내 것 · 상대 것 · 둘 다 · 직접 고치기를 고르고, 다 고르면 저장하고 해결됨으로 표시
struct ConflictView: View {
    @Environment(RepoStore.self) private var store
    let change: FileChange

    var body: some View {
        Group {
            if let doc = store.conflictDoc, store.conflictPath == change.path {
                if doc.isEmpty { noMarkers } else { resolver(doc) }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: change.path) { store.loadConflict(change) }
    }

    /// 충돌 표시가 없는 충돌(한쪽이 지웠거나 바이너리)
    private var noMarkers: some View {
        VStack(spacing: 12) {
            ContentUnavailableView("충돌 표시가 없는 충돌", systemImage: "exclamationmark.triangle",
                                   description: Text("한쪽에서 파일을 지웠거나 바이너리 파일입니다. 파일을 남길지 지울지 고르세요."))
            HStack {
                Button("이 파일 지우기") { Task { await store.resolveDeleted(change, keep: false) } }
                Button("이 파일 남기기") { Task { await store.resolveDeleted(change, keep: true) } }
                    .buttonStyle(.borderedProminent)
            }
            HStack {
                Button("내 것으로(\(store.conflictSides.ours))") { Task { await store.resolveWholeFile(change, ours: true) } }
                Button("상대 것으로(\(store.conflictSides.theirs))") { Task { await store.resolveWholeFile(change, ours: false) } }
            }
            .controlSize(.small)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func resolver(_ doc: ConflictDocument) -> some View {
        let sides = store.conflictSides
        let done = doc.blocks.filter { store.conflictChoices[$0.id] != nil }.count
        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text("충돌 \(doc.blocks.count)곳 — \(done)곳 골랐습니다").font(.callout.weight(.semibold))
                Spacer()
                Menu("파일 전체를") {
                    Button("모두 내 것(\(sides.ours))") { Task { await store.resolveWholeFile(change, ours: true) } }
                    Button("모두 상대 것(\(sides.theirs))") { Task { await store.resolveWholeFile(change, ours: false) } }
                }
                .fixedSize()
                .help("블록마다 고르지 않고 파일 전체를 한쪽으로 바로 해결합니다")
                Button("저장하고 해결됨으로 표시") { Task { await store.saveConflictResolution(change) } }
                    .buttonStyle(.borderedProminent)
                    .disabled(done < doc.blocks.count || store.busy != nil)
                    .help(done < doc.blocks.count ? "모든 충돌 블록을 골라야 저장할 수 있습니다" : "고른 대로 파일을 저장하고 스테이지합니다")
            }
            .controlSize(.small)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.orange.opacity(0.08))
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(doc.segments.enumerated()), id: \.offset) { _, seg in
                        switch seg {
                        case .text(let lines): TextSegment(lines: lines)
                        case .conflict(let i): BlockCard(block: doc.blocks[i], sides: sides)
                        }
                    }
                }
                .padding(12)
            }
            .background(Color(nsColor: .textBackgroundColor))
        }
    }
}

/// 충돌 없는 부분: 길면 앞뒤 3줄만
private struct TextSegment: View {
    let lines: [String]
    @ViewState private var expanded = false

    var body: some View {
        let short = lines.count > 8 && !expanded
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array((short ? Array(lines.prefix(3)) : lines).enumerated()), id: \.offset) { _, l in code(l) }
            if short {
                Button("… \(lines.count - 6)줄 더 보기") { expanded = true }
                    .buttonStyle(.link)
                    .font(.caption)
                    .padding(.vertical, 2)
                ForEach(Array(lines.suffix(3).enumerated()), id: \.offset) { _, l in code(l) }
            }
        }
        .foregroundStyle(.secondary)
    }

    private func code(_ l: String) -> some View {
        Text(l.isEmpty ? " " : l.replacingOccurrences(of: "\t", with: "    "))
            .font(.system(size: 12, design: .monospaced))
            .lineLimit(1)
    }
}

/// 충돌 블록 하나: 왼쪽 내 것, 오른쪽 상대 것, 아래 고르기
private struct BlockCard: View {
    @Environment(RepoStore.self) private var store
    let block: ConflictDocument.Block
    let sides: (ours: String, theirs: String)
    @ViewState private var editing = false
    @ViewState private var text = ""

    var body: some View {
        let choice = store.conflictChoices[block.id]
        VStack(alignment: .leading, spacing: 8) {
            if let choice, !editing {
                HStack {
                    Label("고름: \(title(choice))", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.callout.weight(.semibold))
                    Spacer()
                    Button("다시 고르기") { store.chooseConflict(block.id, nil) }.controlSize(.small)
                }
                lines(ConflictDocument.lines(block, choice), tint: .green)
            } else if editing {
                Text("직접 고치기").font(.callout.weight(.semibold))
                TextEditor(text: $text)
                    .font(.system(size: 12, design: .monospaced))
                    .frame(minHeight: 120)
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.3)))
                HStack {
                    Spacer()
                    Button("취소") { editing = false }
                    Button("이렇게 쓰기") { store.chooseConflict(block.id, .custom(text)); editing = false }
                        .buttonStyle(.borderedProminent)
                }
                .controlSize(.small)
            } else {
                HStack(alignment: .top, spacing: 8) {
                    side("내 것 · \(sides.ours)", block.oursLabel, block.ours, tint: .blue)
                    side("상대 것 · \(sides.theirs)", block.theirsLabel, block.theirs, tint: .purple)
                }
                HStack(spacing: 6) {
                    Button("내 것") { store.chooseConflict(block.id, .ours) }
                    Button("상대 것") { store.chooseConflict(block.id, .theirs) }
                    Menu("둘 다") {
                        Button("내 것 먼저") { store.chooseConflict(block.id, .oursThenTheirs) }
                        Button("상대 것 먼저") { store.chooseConflict(block.id, .theirsThenOurs) }
                    }
                    .fixedSize()
                    Button("직접 고치기…") {
                        text = (block.ours + block.theirs).joined(separator: "\n")
                        editing = true
                    }
                    Spacer()
                }
                .controlSize(.small)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(choice == nil ? 0.07 : 0.03)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder((choice == nil ? Color.orange : Color.green).opacity(0.4)))
    }

    private func title(_ c: ConflictDocument.Choice) -> String {
        switch c {
        case .ours: return "내 것"
        case .theirs: return "상대 것"
        case .oursThenTheirs: return "둘 다(내 것 먼저)"
        case .theirsThenOurs: return "둘 다(상대 것 먼저)"
        case .custom: return "직접 고침"
        }
    }

    private func side(_ title: String, _ label: String, _ l: [String], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(tint)
                .help(label.isEmpty ? title : "\(title)\n\(label)")
            lines(l, tint: tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func lines(_ l: [String], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if l.isEmpty {
                Text("(비어 있음)").font(.caption).foregroundStyle(.secondary).padding(4)
            }
            ForEach(Array(l.enumerated()), id: \.offset) { _, s in
                Text(s.isEmpty ? " " : s.replacingOccurrences(of: "\t", with: "    "))
                    .font(.system(size: 12, design: .monospaced))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 6).fill(tint.opacity(0.08)))
        .textSelection(.enabled)
    }
}
