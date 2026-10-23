import SwiftUI
import AppKit

struct AddWorktreeSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let presetBranch: String?
    let start: String?

    @ViewState private var createNew = true
    @ViewState private var name = ""
    @ViewState private var existing = ""
    @ViewState private var path = ""
    @ViewState private var pathEdited = false
    @ViewState private var runClaude = false
    @ViewState private var task = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("New worktree").font(.title3.weight(.semibold)).padding([.top, .horizontal], 20)
            Form {
                Picker("Branch", selection: $createNew) {
                    Text("Create new branch").tag(true)
                    Text("Existing branch").tag(false)
                }
                .pickerStyle(.segmented)
                if createNew {
                    TextField("New branch name", text: $name, prompt: Text("feature/new-task"))
                    LabeledContent("Start point", value: start.map { String($0.prefix(10)) } ?? store.headBranch ?? "HEAD")
                } else {
                    Picker("Branch to check out", selection: $existing) {
                        ForEach(freeBranches, id: \.self) { Text($0).tag($0) }
                    }
                }
                LabeledContent("Location") {
                    HStack {
                        TextField("", text: Binding(get: { path }, set: { path = $0; pathEdited = true }))
                            .textFieldStyle(.roundedBorder)
                        Button("Change…") { choose() }
                    }
                }
                Toggle("Run \(AgentCenter.shared.defaultKind.title) after creating", isOn: $runClaude)
                if runClaude {
                    TextField("Task for the agent (optional)", text: $task, prompt: Text("e.g. add password recovery to the login screen"), axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .formStyle(.grouped)
            HStack {
                Text("A branch can be checked out in only one worktree.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    let b = branch, p = path, new = createNew, s = createNew ? start : nil, c = runClaude, t = task
                    dismiss()
                    Task { await store.addWorktree(path: p, branch: b, createNew: new, start: s, launchClaude: c, task: t) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!valid)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 560)
        .onAppear {
            if let presetBranch {
                createNew = false
                existing = presetBranch
            } else {
                existing = freeBranches.first ?? ""
            }
            updatePath()
        }
        .onChange(of: name) { _, _ in updatePath() }
        .onChange(of: existing) { _, _ in updatePath() }
        .onChange(of: createNew) { _, _ in updatePath() }
    }

    private var branch: String { createNew ? name.trimmed : existing }

    private var freeBranches: [String] {
        let used = Set(store.worktrees.compactMap(\.branch))
        return store.localBranches.map(\.name).filter { !used.contains($0) }
    }

    private var valid: Bool {
        let b = branch
        return !b.isEmpty && !b.contains(" ") && !b.hasPrefix("-") && !path.trimmed.isEmpty
            && !FileManager.default.fileExists(atPath: path)
    }

    private func updatePath() {
        guard !pathEdited, !branch.isEmpty else { return }
        path = store.defaultWorktreePath(for: branch)
    }

    private func choose() {
        let p = NSOpenPanel()
        p.canChooseDirectories = true
        p.canChooseFiles = false
        p.canCreateDirectories = true
        p.prompt = String(localized: "Create inside")
        if p.runModal() == .OK, let u = p.url {
            path = u.appendingPathComponent(branch.isEmpty ? "worktree" : branch.replacingOccurrences(of: "/", with: "-")).path
            pathEdited = true
        }
    }
}
