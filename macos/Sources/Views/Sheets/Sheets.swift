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
                Button("Cancel", role: .cancel) { dismiss() }
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
        SheetFrame(title: String(localized: "New branch"), confirmTitle: String(localized: "Create"), canConfirm: valid,
                   onConfirm: { Task { await store.createBranch(name.trimmed, at: start, checkout: checkout) } }) {
            TextField("Name", text: $name, prompt: Text("feature/new-feature"))
            LabeledContent("Start point", value: label)
            Toggle("Check out after creating", isOn: $checkout)
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
        SheetFrame(title: String(localized: "Create tag"), confirmTitle: String(localized: "Create"), canConfirm: !name.trimmed.isEmpty && !name.contains(" "),
                   onConfirm: { Task { await store.createTag(name.trimmed, message: message, at: sha) } }) {
            TextField("Name", text: $name, prompt: Text("v1.0.0"))
            TextField("Message", text: $message, prompt: Text("Leave empty for a lightweight tag"))
            LabeledContent("Commit", value: String(sha.prefix(10)))
        }
    }
}

struct StashSheet: View {
    @Environment(RepoStore.self) private var store
    @ViewState private var message = ""
    @ViewState private var includeUntracked = true

    var body: some View {
        SheetFrame(title: String(localized: "Stash changes"), confirmTitle: "Stash", canConfirm: true,
                   onConfirm: { Task { await store.stash(message: message, includeUntracked: includeUntracked) } }) {
            TextField("Message", text: $message, prompt: Text("Optional"))
            Toggle("Include untracked new files", isOn: $includeUntracked)
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
        SheetFrame(title: String(localized: "Clone repository"), confirmTitle: String(localized: "Clone"),
                   canConfirm: !remote.trimmed.isEmpty && !folder.trimmed.isEmpty,
                   onConfirm: { Task { await store.clone(remote: remote.trimmed, parent: parent, folder: folder.trimmed) } }) {
            if !accounts.accounts.isEmpty {
                Section("My repositories") {
                    Picker("Accounts", selection: $accountID) {
                        ForEach(accounts.accounts) { a in
                            Text("\(a.provider == .github ? "GitHub" : a.host) · @\(a.username)").tag(Optional(a.id))
                        }
                    }
                    TextField("Search", text: $query)
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
            TextField("URL", text: $remote, prompt: Text("https://github.com/user/repo.git"))
                .onChange(of: remote) { _, v in
                    if !folderEdited { folder = Self.guessName(v) }
                }
            LabeledContent("Location") {
                HStack {
                    Text(parent.path).lineLimit(1).truncationMode(.head)
                    Button("Change…") { choose() }
                }
            }
            TextField("Folder name", text: Binding(get: { folder }, set: { folder = $0; folderEdited = true }))
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
