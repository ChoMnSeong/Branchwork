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
            Text("새 워크트리").font(.title3.weight(.semibold)).padding([.top, .horizontal], 20)
            Form {
                Picker("브랜치", selection: $createNew) {
                    Text("새 브랜치 만들기").tag(true)
                    Text("기존 브랜치").tag(false)
                }
                .pickerStyle(.segmented)
                if createNew {
                    TextField("새 브랜치 이름", text: $name, prompt: Text("feature/새-작업"))
                    LabeledContent("시작 위치", value: start.map { String($0.prefix(10)) } ?? store.headBranch ?? "HEAD")
                } else {
                    Picker("체크아웃할 브랜치", selection: $existing) {
                        ForEach(freeBranches, id: \.self) { Text($0).tag($0) }
                    }
                }
                LabeledContent("위치") {
                    HStack {
                        TextField("", text: Binding(get: { path }, set: { path = $0; pathEdited = true }))
                            .textFieldStyle(.roundedBorder)
                        Button("변경…") { choose() }
                    }
                }
                Toggle("만든 뒤 \(AgentCenter.shared.defaultKind.title) 실행", isOn: $runClaude)
                if runClaude {
                    TextField("에이전트에게 맡길 작업 (선택)", text: $task, prompt: Text("예: 로그인 화면에 비밀번호 찾기 추가"), axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .formStyle(.grouped)
            HStack {
                Text("한 브랜치는 워크트리 하나에서만 체크아웃할 수 있습니다.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("만들기") {
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
        p.prompt = "이 안에 만들기"
        if p.runModal() == .OK, let u = p.url {
            path = u.appendingPathComponent(branch.isEmpty ? "worktree" : branch.replacingOccurrences(of: "/", with: "-")).path
            pathEdited = true
        }
    }
}
