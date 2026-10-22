import SwiftUI
import AppKit

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
