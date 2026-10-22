import SwiftUI

struct SidebarView: View {
    @Environment(RepoStore.self) private var store
    @ViewState private var expanded: Set<String> = []

    @AppStorage("sidebarMode") private var mode = "list"

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $mode) {
                Text("목록").tag("list")
                Text(activeAgents > 0 ? "에이전트 \(activeAgents)" : "에이전트").tag("agents")
                Text("CI/CD").tag("ci")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            if mode == "agents" {
                AgentsPanel()
            } else if mode == "ci" {
                CIPanel()
            } else {
                branchList
            }
        }
    }

    /// 지금 일하거나 허락을 기다리는 세션 수
    private var activeAgents: Int {
        let paths = Set(store.worktrees.map { AgentCenter.normalize($0.path) })
        return AgentCenter.shared.sessions.filter { $0.status.isActive && paths.contains(AgentCenter.normalize($0.path)) }.count
    }

    private var branchList: some View {
        List {
            if let target = store.target {
                PullRequestSection(target: target)
            }

            Section("로컬 브랜치 \(store.localBranches.count)") {
                let groups = BranchFolders(store.localBranches) { $0.name }
                ForEach(groups.loose) { b in localRow(b, label: b.name) }
                ForEach(groups.folders) { f in
                    DisclosureGroup(isExpanded: expansion("l:" + f.name)) {
                        ForEach(f.branches) { b in localRow(b, label: BranchFolders.leaf(b.name)) }
                    } label: {
                        folderLabel(f)
                    }
                }
            }

            if store.worktrees.count > 1 {
                WorktreeSection()
            }

            if !store.remoteBranches.isEmpty {
                Section("원격 \(store.remoteBranches.count)") {
                    ForEach(remoteGroups, id: \.0) { remote, branches in
                        DisclosureGroup(isExpanded: expansion("r:" + remote)) {
                            let groups = BranchFolders(branches) { $0.shortName }
                            ForEach(groups.loose) { b in remoteRow(b, label: b.shortName) }
                            ForEach(groups.folders) { f in
                                DisclosureGroup(isExpanded: expansion("r:\(remote)/\(f.name)")) {
                                    ForEach(f.branches) { b in remoteRow(b, label: BranchFolders.leaf(b.shortName)) }
                                } label: {
                                    folderLabel(f)
                                }
                            }
                        } label: {
                            HStack {
                                Label(remote, systemImage: "cloud")
                                Spacer()
                                Text("\(branches.count)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            if !store.tags.isEmpty {
                Section("태그 \(store.tags.count)") {
                    ForEach(store.tags) { t in
                        Label(t.name, systemImage: "tag")
                            .lineLimit(1)
                            .contentShape(Rectangle())
                            .onTapGesture { store.reveal(t.target) }
                            .contextMenu {
                                Button("이 태그로 이동") { store.reveal(t.target) }
                                Button("태그 Push") { Task { await store.pushTag(t) } }
                                Divider()
                                Button("태그 삭제…", role: .destructive) { store.deleteTag(t) }
                            }
                    }
                }
            }

            if !store.stashes.isEmpty {
                Section("스태시 \(store.stashes.count)") {
                    ForEach(store.stashes) { s in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(s.message).lineLimit(1)
                            Text(s.ref).font(.caption).foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { store.reveal(s.hash) }
                        .contextMenu {
                            Button("적용 (Apply)") { Task { await store.stashApply(s) } }
                            Button("꺼내기 (Pop)") { Task { await store.stashPop(s) } }
                            Divider()
                            Button("버리기 (Drop)…", role: .destructive) { store.stashDrop(s) }
                        }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .onAppear(perform: expandCurrent)
        .onChange(of: store.headBranch) { _, _ in expandCurrent() }
    }

    /// 현재 브랜치가 든 폴더는 펼쳐 둔다
    private func expandCurrent() {
        if let h = store.headBranch, let slash = h.firstIndex(of: "/") {
            expanded.insert("l:" + h[..<slash])
        }
    }

    private func expansion(_ id: String) -> Binding<Bool> {
        Binding(get: { expanded.contains(id) },
                set: { if $0 { expanded.insert(id) } else { expanded.remove(id) } })
    }

    private func folderLabel(_ f: BranchFolder) -> some View {
        HStack {
            Label(f.name, systemImage: f.branches.contains(where: \.isCurrent) ? "folder.fill" : "folder")
            Spacer()
            Text("\(f.branches.count)").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func localRow(_ b: Branch, label: String) -> some View {
        BranchRow(branch: b, label: label, worktreePath: store.worktree(using: b.name)?.path)
            .contentShape(Rectangle())
            .draggable(RepoStore.branchPayload + b.name) { Label(b.name, systemImage: "arrow.triangle.branch").padding(6) }
            .onTapGesture(count: 2) { Task { await store.checkout(b) } }
            .onTapGesture { store.reveal(b.target) }
            .contextMenu { localMenu(b) }
    }

    private func remoteRow(_ b: Branch, label: String) -> some View {
        BranchRow(branch: b, label: label)
            .contentShape(Rectangle())
            .draggable(RepoStore.branchPayload + b.name) { Label(b.name, systemImage: "cloud").padding(6) }
            .onTapGesture(count: 2) { Task { await store.checkout(b) } }
            .onTapGesture { store.reveal(b.target) }
            .contextMenu { remoteMenu(b) }
    }

    private var remoteGroups: [(String, [Branch])] {
        Dictionary(grouping: store.remoteBranches) { $0.remote ?? "" }
            .sorted { $0.key < $1.key }
            .map { ($0.key, $0.value) }
    }

    @ViewBuilder
    private func localMenu(_ b: Branch) -> some View {
        Button("체크아웃") { Task { await store.checkout(b) } }
            .disabled(b.isCurrent)
        if let current = store.headBranch, !b.isCurrent {
            Button("'\(b.name)'을(를) '\(current)'에 머지") { Task { await store.merge(b.name) } }
            Button("'\(current)'을(를) '\(b.name)' 위로 리베이스") { Task { await store.rebase(onto: b.name) } }
        }
        MergeIntoMenu(source: b.name)
        Divider()
        Button("여기서 새 브랜치…") { store.requestNewBranch(from: b.target, label: b.name) }
        Button("새 워크트리에서 체크아웃…") { store.sheet = .addWorktree(branch: b.name, start: nil) }
            .disabled(b.isCurrent || store.worktree(using: b.name) != nil)
        if let w = store.worktree(using: b.name) {
            Button("이 브랜치의 워크트리 열기") { Task { await store.openOrReport(URL(fileURLWithPath: w.path, isDirectory: true)) } }
            Button("워크트리에서 에이전트 실행") { store.startAgent(in: w.path) }
        }
        Button("Push") { Task { await store.pushBranch(b) } }
        Button("이름 복사") { store.copy(b.name) }
        Divider()
        Button("삭제…", role: .destructive) { store.confirmDelete(b) }
            .disabled(b.isCurrent)
        Button("강제 삭제…", role: .destructive) { store.confirmForceDelete(b) }
            .disabled(b.isCurrent)
    }

    @ViewBuilder
    private func remoteMenu(_ b: Branch) -> some View {
        Button("체크아웃 (로컬 추적 브랜치)") { Task { await store.checkout(b) } }
        if let current = store.headBranch {
            Button("'\(b.name)'을(를) '\(current)'에 머지") { Task { await store.merge(b.name) } }
            Button("'\(current)'을(를) '\(b.name)' 위로 리베이스") { Task { await store.rebase(onto: b.name) } }
        }
        MergeIntoMenu(source: b.name)
        Divider()
        Button("여기서 새 브랜치…") { store.requestNewBranch(from: b.target, label: b.name) }
        Button("이름 복사") { store.copy(b.name) }
        Divider()
        Button("원격에서 삭제…", role: .destructive) { store.confirmDelete(b) }
    }
}

/// 브랜치 이름의 첫 '/' 앞부분(feature, fix, hotfix …)으로 묶은 폴더
struct BranchFolder: Identifiable {
    let name: String
    let branches: [Branch]
    var id: String { name }
}

struct BranchFolders {
    let loose: [Branch]
    let folders: [BranchFolder]

    init(_ branches: [Branch], key: (Branch) -> String) {
        var loose: [Branch] = []
        var byFolder: [String: [Branch]] = [:]
        for b in branches {
            let k = key(b)
            if let slash = k.firstIndex(of: "/") {
                byFolder[String(k[..<slash]), default: []].append(b)
            } else {
                loose.append(b)
            }
        }
        var folders: [BranchFolder] = []
        for (name, list) in byFolder {
            if list.count == 1 { loose.append(list[0]) } else { folders.append(BranchFolder(name: name, branches: list)) }
        }
        self.loose = loose.sorted { key($0).localizedStandardCompare(key($1)) == .orderedAscending }
        self.folders = folders.sorted { $0.name < $1.name }
    }

    /// 폴더 이름을 뺀 나머지(feature/auth-jwt → auth-jwt)
    static func leaf(_ name: String) -> String {
        guard let slash = name.firstIndex(of: "/") else { return name }
        return String(name[name.index(after: slash)...])
    }
}

private struct BranchRow: View {
    let branch: Branch
    var label: String? = nil
    var worktreePath: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: branch.isCurrent ? "checkmark.circle.fill" : "arrow.triangle.branch")
                .foregroundStyle(branch.isCurrent ? Color.accentColor : .secondary)
                .frame(width: 16)
            Text(label ?? (branch.isRemote ? branch.shortName : branch.name))
                .fontWeight(branch.isCurrent ? .semibold : .regular)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(branch.name)
            Spacer(minLength: 4)
            if let worktreePath {
                Image(systemName: "folder").foregroundStyle(.secondary)
                    .help("워크트리에서 사용 중: \(worktreePath)")
            }
            if branch.upstreamGone {
                Image(systemName: "exclamationmark.icloud").foregroundStyle(.orange)
                    .help("추적하던 원격 브랜치가 삭제됨")
            }
            if branch.ahead > 0 { counter("↑\(branch.ahead)") }
            if branch.behind > 0 { counter("↓\(branch.behind)") }
        }
    }

    private func counter(_ s: String) -> some View {
        Text(s)
            .font(.caption2.monospacedDigit().weight(.semibold))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Capsule().fill(Color.secondary.opacity(0.18)))
    }
}
