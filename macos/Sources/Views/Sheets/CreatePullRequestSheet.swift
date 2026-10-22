import SwiftUI
import AppKit

struct CreatePullRequestSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @ViewState private var title = ""
    @ViewState private var bodyText = ""
    @ViewState private var base = ""
    @ViewState private var bases: [String] = []
    @ViewState private var draft = false
    @ViewState private var generating = false

    var body: some View {
        let provider = store.target?.provider ?? .github
        VStack(alignment: .leading, spacing: 12) {
            Text("새 \(provider.requestName)").font(.title3.weight(.semibold))
            HStack {
                Text(store.headBranch ?? "").font(.system(.body, design: .monospaced))
                Image(systemName: "arrow.right").foregroundStyle(.secondary)
                Picker("", selection: $base) {
                    ForEach(bases, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .frame(maxWidth: 220)
            }
            TextField("제목", text: $title)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $bodyText)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(4)
                .frame(height: 200)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.secondary.opacity(0.3)))
            HStack {
                Toggle("Draft", isOn: $draft)
                Spacer()
                if generating { ProgressView().controlSize(.small) }
                Button { generate() } label: { Label("\(AIStore.shared.short(for: .pullRequest))로 작성", systemImage: "sparkles") }
                    .disabled(generating || base.isEmpty)
            }
            if store.status.upstream == nil || store.status.ahead > 0 {
                Text("만들기 전에 현재 브랜치를 \(store.target?.remote ?? "원격")에 Push 합니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("만들기") {
                    let t = title.trimmed, b = bodyText, target = base, d = draft
                    dismiss()
                    Task { await store.createPullRequest(title: t, body: b, base: target, draft: d) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(title.trimmed.isEmpty || base.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 600)
        .task {
            bases = store.pullRequestBaseCandidates()
            if let b = await store.defaultBaseBranch() { base = b }
            if title.isEmpty, let branch = store.headBranch {
                title = branch.split(separator: "/").last.map { $0.replacingOccurrences(of: "-", with: " ") } ?? branch
            }
        }
    }

    private func generate() {
        generating = true
        Task {
            if let d = await store.draftPullRequest(base: base) {
                title = d.title
                bodyText = d.body
            }
            generating = false
        }
    }
}
