import SwiftUI
import AppKit

private struct SheetFrame<Content: View>: View {
    let title: String
    let confirmTitle: String
    let canConfirm: Bool
    let onConfirm: () -> Void
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.title3.weight(.semibold)).padding([.top, .horizontal], 20)
            Form { content }
                .formStyle(.grouped)
                .frame(maxHeight: 560)
            HStack {
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(confirmTitle) {
                    dismiss()
                    onConfirm()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canConfirm)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 500)
    }
}

struct NewBranchSheet: View {
    @Environment(RepoStore.self) private var store
    let start: String
    let label: String
    @ViewState private var name = ""
    @ViewState private var checkout = true

    var body: some View {
        SheetFrame(title: "새 브랜치", confirmTitle: "만들기", canConfirm: valid,
                   onConfirm: { Task { await store.createBranch(name.trimmed, at: start, checkout: checkout) } }) {
            TextField("이름", text: $name, prompt: Text("feature/새-기능"))
            LabeledContent("시작 위치", value: label)
            Toggle("만든 뒤 체크아웃", isOn: $checkout)
        }
    }

    private var valid: Bool {
        let n = name.trimmed
        return !n.isEmpty && !n.contains(" ") && !n.hasPrefix("-") && !n.contains("..")
    }
}

struct TagSheet: View {
    @Environment(RepoStore.self) private var store
    let sha: String
    @ViewState private var name = ""
    @ViewState private var message = ""

    var body: some View {
        SheetFrame(title: "태그 만들기", confirmTitle: "만들기", canConfirm: !name.trimmed.isEmpty && !name.contains(" "),
                   onConfirm: { Task { await store.createTag(name.trimmed, message: message, at: sha) } }) {
            TextField("이름", text: $name, prompt: Text("v1.0.0"))
            TextField("메시지", text: $message, prompt: Text("비우면 가벼운 태그"))
            LabeledContent("커밋", value: String(sha.prefix(10)))
        }
    }
}

struct StashSheet: View {
    @Environment(RepoStore.self) private var store
    @ViewState private var message = ""
    @ViewState private var includeUntracked = true

    var body: some View {
        SheetFrame(title: "변경 사항 Stash", confirmTitle: "Stash", canConfirm: true,
                   onConfirm: { Task { await store.stash(message: message, includeUntracked: includeUntracked) } }) {
            TextField("메시지", text: $message, prompt: Text("선택 사항"))
            Toggle("추적하지 않는 새 파일도 포함", isOn: $includeUntracked)
        }
    }
}

struct CloneSheet: View {
    @Environment(RepoStore.self) private var store
    private let accounts = AccountStore.shared
    @ViewState private var accountID: String?
    @ViewState private var repos: [RemoteRepo] = []
    @ViewState private var reposError: String?
    @ViewState private var loadingRepos = false
    @ViewState private var query = ""
    @ViewState private var remote = ""
    @ViewState private var parent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Desktop", isDirectory: true)
    @ViewState private var folder = ""
    @ViewState private var folderEdited = false

    var body: some View {
        SheetFrame(title: "저장소 복제", confirmTitle: "복제",
                   canConfirm: !remote.trimmed.isEmpty && !folder.trimmed.isEmpty,
                   onConfirm: { Task { await store.clone(remote: remote.trimmed, parent: parent, folder: folder.trimmed) } }) {
            if !accounts.accounts.isEmpty {
                Section("내 저장소") {
                    Picker("계정", selection: $accountID) {
                        ForEach(accounts.accounts) { a in
                            Text("\(a.provider == .github ? "GitHub" : a.host) · @\(a.username)").tag(Optional(a.id))
                        }
                    }
                    TextField("검색", text: $query)
                    List(filteredRepos, selection: Binding(get: { repos.first { $0.cloneURL == remote }?.id },
                                                           set: { id in if let r = repos.first(where: { $0.id == id }) { remote = r.cloneURL } })) { r in
                        HStack(spacing: 6) {
                            Image(systemName: r.isPrivate ? "lock" : "globe").foregroundStyle(.secondary).frame(width: 14)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(r.fullName).lineLimit(1)
                                if let d = r.summary, !d.isEmpty {
                                    Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                        .tag(r.id)
                    }
                    .frame(height: 170)
                    .overlay {
                        if loadingRepos { ProgressView() }
                        else if let reposError { Text(reposError).font(.caption).foregroundStyle(.red).padding() }
                    }
                }
                .task(id: accountID) { await loadRepos() }
                .onAppear { if accountID == nil { accountID = accounts.accounts.first?.id } }
            }
            TextField("URL", text: $remote, prompt: Text("https://github.com/사용자/저장소.git"))
                .onChange(of: remote) { _, v in
                    if !folderEdited { folder = Self.guessName(v) }
                }
            LabeledContent("위치") {
                HStack {
                    Text(parent.path).lineLimit(1).truncationMode(.head)
                    Button("변경…") { choose() }
                }
            }
            TextField("폴더 이름", text: Binding(get: { folder }, set: { folder = $0; folderEdited = true }))
        }
    }

    private var filteredRepos: [RemoteRepo] {
        let q = query.trimmed.lowercased()
        return q.isEmpty ? repos : repos.filter { $0.fullName.lowercased().contains(q) }
    }

    private func loadRepos() async {
        guard let a = accounts.accounts.first(where: { $0.id == accountID }), let token = accounts.token(for: a) else { return }
        loadingRepos = true
        reposError = nil
        do {
            repos = try await Hosting.repositories(a.provider, token: token, apiBase: a.apiBase)
        } catch {
            repos = []
            reposError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        loadingRepos = false
    }

    private func choose() {
        let p = NSOpenPanel()
        p.canChooseDirectories = true
        p.canChooseFiles = false
        p.canCreateDirectories = true
        p.directoryURL = parent
        if p.runModal() == .OK, let u = p.url { parent = u }
    }

    /// https://host/a/b.git, git@host:a/b.git → "b"
    static func guessName(_ url: String) -> String {
        let last = url.trimmed.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? ""
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }
}
