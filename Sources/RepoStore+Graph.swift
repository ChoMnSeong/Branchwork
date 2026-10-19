import SwiftUI

/// 그래프에 끌어다 놓았을 때 고를 수 있는 동작
struct DropChoice: Identifiable {
    let id = UUID()
    let title: String
    var destructive = false
    let action: @MainActor () async -> Void
}

struct DropRequest: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let choices: [DropChoice]
}

/// 그래프에서 바로 하는 브랜치 작업: 끌어다 놓기(머지·리베이스·빨리 감기·cherry-pick)
extension RepoStore {
    static let branchPayload = "branchwork-branch:"
    static let commitPayload = "branchwork-commit:"

    func branch(named name: String) -> Branch? {
        localBranches.first { $0.name == name } ?? remoteBranches.first { $0.name == name }
    }

    private func fullRef(_ name: String) -> String {
        if let b = branch(named: name) { return b.isRemote ? "refs/remotes/\(b.name)" : "refs/heads/\(b.name)" }
        return name
    }

    func isAncestor(_ a: String, of b: String) async -> Bool {
        guard let url, let r = try? await Git.raw(["merge-base", "--is-ancestor", a, b], in: url) else { return false }
        return r.status == 0
    }

    /// 커밋 줄에 무언가를 놓았을 때. 그 줄의 브랜치(현재 브랜치 우선, 없으면 로컬, 원격 순)를 대상으로 삼는다.
    func handleDrop(_ payload: String, onto entry: GraphEntry) {
        guard !entry.commit.isWIP, busy == nil else { return }
        let refs = refsByCommit[entry.id] ?? []
        let target = refs.first { $0.kind == .local && $0.isCurrent }?.name
            ?? refs.first { $0.kind == .local }?.name
            ?? refs.first { $0.kind == .remote }?.name

        if payload.hasPrefix(Self.branchPayload) {
            let source = String(payload.dropFirst(Self.branchPayload.count))
            if let target {
                guard target != source else { return }
                Task { await offerBranchDrop(source, onto: target) }
            } else {
                offerBranchOnCommit(source, entry.commit)
            }
        } else if payload.hasPrefix(Self.commitPayload) {
            let sha = String(payload.dropFirst(Self.commitPayload.count))
            guard sha != entry.id else { return }
            offerCommitDrop(sha, onto: target)
        }
    }

    /// 브랜치를 다른 브랜치에 놓았을 때
    private func offerBranchDrop(_ source: String, onto target: String) async {
        let current = headBranch
        let sourceRef = fullRef(source), targetRef = fullRef(target)
        let targetIsLocal = localBranches.contains { $0.name == target }
        let sourceIsLocal = localBranches.contains { $0.name == source }

        if await isAncestor(sourceRef, of: targetRef) {
            dropRequest = DropRequest(title: "'\(source)'은(는) 이미 '\(target)'에 들어 있습니다",
                                      message: "머지할 새 커밋이 없습니다.", choices: [])
            return
        }
        var choices: [DropChoice] = []
        // 대상이 원본의 조상이면 머지 커밋 없이 앞으로 옮기기만 하면 된다
        if targetIsLocal, await isAncestor(targetRef, of: sourceRef) {
            if target == current {
                choices.append(DropChoice(title: "'\(target)'(현재)을(를) '\(source)'까지 빨리 감기 (fast-forward)") { [weak self] in
                    await self?.run("빨리 감는 중…", ["merge", "--ff-only", source])
                })
            } else {
                choices.append(DropChoice(title: "'\(target)'을(를) '\(source)'까지 빨리 감기 (fast-forward)") { [weak self] in
                    await self?.run("빨리 감는 중…", ["fetch", ".", "\(sourceRef):refs/heads/\(target)"])
                })
            }
        }
        if target == current {
            choices.append(DropChoice(title: "'\(source)'을(를) '\(target)'(현재)에 머지") { [weak self] in
                await self?.merge(source)
            })
            choices.append(DropChoice(title: "'\(target)'(현재)을(를) '\(source)' 위로 리베이스") { [weak self] in
                await self?.rebase(onto: source)
            })
        } else if source == current {
            choices.append(DropChoice(title: "'\(source)'(현재)을(를) '\(target)' 위로 리베이스") { [weak self] in
                await self?.rebase(onto: target)
            })
            choices.append(DropChoice(title: "'\(target)'을(를) '\(source)'(현재)에 머지") { [weak self] in
                await self?.merge(target)
            })
        } else {
            if targetIsLocal {
                choices.append(DropChoice(title: "'\(target)' 체크아웃 후 '\(source)' 머지") { [weak self] in
                    guard let self, await self.run("체크아웃 중…", ["switch", target]) else { return }
                    await self.merge(source)
                })
            }
            if sourceIsLocal {
                choices.append(DropChoice(title: "'\(source)' 체크아웃 후 '\(target)' 위로 리베이스") { [weak self] in
                    guard let self, await self.run("체크아웃 중…", ["switch", source]) else { return }
                    await self.rebase(onto: target)
                })
            }
        }
        dropRequest = DropRequest(title: "'\(source)'  →  '\(target)'",
                                  message: choices.isEmpty ? "여기에서 할 수 있는 작업이 없습니다." : "무엇을 할까요? 충돌이 나면 오른쪽에서 해결할 수 있습니다.",
                                  choices: choices)
    }

    /// 브랜치를 브랜치 없는 커밋에 놓았을 때(현재 브랜치일 때만 의미가 있다)
    private func offerBranchOnCommit(_ source: String, _ commit: Commit) {
        let short = commit.short
        var choices: [DropChoice] = []
        if source == headBranch {
            choices.append(DropChoice(title: "이 커밋(\(short))을 '\(source)'(현재)에 머지") { [weak self] in
                await self?.merge(commit.id)
            })
            choices.append(DropChoice(title: "'\(source)'(현재)을(를) 이 커밋(\(short)) 위로 리베이스") { [weak self] in
                await self?.rebase(onto: commit.id)
            })
        } else if localBranches.contains(where: { $0.name == source }) {
            choices.append(DropChoice(title: "'\(source)' 체크아웃 후 이 커밋(\(short)) 위로 리베이스") { [weak self] in
                guard let self, await self.run("체크아웃 중…", ["switch", source]) else { return }
                await self.rebase(onto: commit.id)
            })
        }
        dropRequest = DropRequest(title: "'\(source)'  →  커밋 \(short)",
                                  message: choices.isEmpty ? "여기에서 할 수 있는 작업이 없습니다." : "무엇을 할까요?",
                                  choices: choices)
    }

    /// 커밋을 브랜치에 놓았을 때: cherry-pick
    private func offerCommitDrop(_ sha: String, onto target: String?) {
        guard let target else { return }
        let short = String(sha.prefix(7))
        var choices: [DropChoice] = []
        if target == headBranch {
            choices.append(DropChoice(title: "커밋 \(short)을(를) '\(target)'(현재)에 cherry-pick") { [weak self] in
                await self?.cherryPick(sha)
            })
        } else if localBranches.contains(where: { $0.name == target }) {
            choices.append(DropChoice(title: "'\(target)' 체크아웃 후 커밋 \(short) cherry-pick") { [weak self] in
                guard let self, await self.run("체크아웃 중…", ["switch", target]) else { return }
                await self.cherryPick(sha)
            })
        }
        dropRequest = DropRequest(title: "커밋 \(short)  →  '\(target)'",
                                  message: choices.isEmpty ? "원격 브랜치에는 바로 cherry-pick 할 수 없습니다." : "무엇을 할까요?",
                                  choices: choices)
    }
}

/// 브랜치·태그 배지 우클릭 메뉴(그래프 배지와 커밋 메뉴에서 같이 쓴다)
struct RefMenu: View {
    @Environment(RepoStore.self) private var store
    let ref: RefLabel

    var body: some View {
        switch ref.kind {
        case .local, .remote:
            if let b = store.branch(named: ref.name) {
                Button(b.isRemote ? "체크아웃 (로컬 추적 브랜치)" : "체크아웃") { Task { await store.checkout(b) } }
                    .disabled(b.isCurrent)
                if let current = store.headBranch, !b.isCurrent {
                    Button("'\(b.name)'을(를) '\(current)'에 머지") { Task { await store.merge(b.name) } }
                    Button("'\(current)'을(를) '\(b.name)' 위로 리베이스") { Task { await store.rebase(onto: b.name) } }
                }
                Divider()
                Button("여기서 새 브랜치…") { store.requestNewBranch(from: b.target, label: b.name) }
                if !b.isRemote {
                    Button("새 워크트리에서 체크아웃…") { store.sheet = .addWorktree(branch: b.name, start: nil) }
                        .disabled(b.isCurrent || store.worktree(using: b.name) != nil)
                    Button("Push") { Task { await store.pushBranch(b) } }
                }
                Button("이름 복사") { store.copy(b.name) }
                Divider()
                Button(b.isRemote ? "원격에서 삭제…" : "삭제…", role: .destructive) { store.confirmDelete(b) }
                    .disabled(b.isCurrent)
            }
        case .tag:
            if let t = store.tags.first(where: { $0.name == ref.name }) {
                Button("태그 Push") { Task { await store.pushTag(t) } }
                Button("이름 복사") { store.copy(t.name) }
                Divider()
                Button("태그 삭제…", role: .destructive) { store.deleteTag(t) }
            }
        case .head:
            EmptyView()
        }
    }
}
