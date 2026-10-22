import SwiftUI
import AppKit

/// git 작업: 실행·Fetch·Pull·Push·브랜치·태그·스태시·스테이지·커밋·머지/리베이스
extension RepoStore {
    // MARK: - 작업 실행

    /// git 명령 하나를 실행하고 저장소를 다시 읽는다. 실패하면 git 의 메시지를 그대로 보여 준다.
    /// 전후로 브랜치·태그·HEAD 를 기록해 두어 '되돌리기'로 되돌릴 수 있게 한다(머지·리베이스가 진행 중일 때는 빼고).
    @discardableResult
    func run(_ label: String, _ args: [String], network: Bool = false, input: String? = nil) async -> Bool {
        guard let url, busy == nil else { return false }
        busy = label
        defer { busy = nil }
        let before = repoState == .clean ? await refSnapshot() : nil
        do {
            try await Git.run(args, in: url, input: input, timeout: network ? 900 : 300,
                              env: network ? AccountStore.shared.gitEnvironment(target: target, repoPath: url.path) : [:])
            if let before, let after = await refSnapshot() { recordUndo(args: args, input: input, before: before, after: after) }
            await reload()
            return true
        } catch {
            errorMessage = describe(error)
            await reload(quiet: true)
            return false
        }
    }

    private var defaultRemote: String? {
        remotes.contains("origin") ? "origin" : remotes.first
    }

    func fetch() async {
        if await run("Fetch 중…", ["fetch", "--all", "--prune"], network: true) { await loadPullRequests() }
    }

    func pull(_ mode: PullMode = .standard) async {
        var args = ["pull"]
        switch mode {
        case .standard: break
        case .fastForward: args.append("--ff-only")
        case .merge: args.append("--no-rebase")
        case .rebase: args.append("--rebase")
        }
        await run("Pull 중…", args, network: true)
    }

    func push(force: Bool = false) async {
        guard let branch = headBranch, headHash != nil else {
            errorMessage = "Push 할 브랜치가 없습니다. 분리된 HEAD 이거나 아직 커밋이 없습니다."
            return
        }
        var args = ["push"]
        if force { args.append("--force-with-lease") }
        if status.upstream == nil {
            guard let remote = defaultRemote else {
                errorMessage = "원격 저장소가 없습니다. 터미널에서 `git remote add origin <URL>` 로 먼저 추가하세요."
                return
            }
            args += ["-u", remote, branch]
        }
        if await run("Push 중…", args, network: true) { await loadPullRequests() }
    }

    func pushBranch(_ b: Branch) async {
        if b.isCurrent { await push(); return }
        guard let remote = b.upstream.flatMap({ $0.split(separator: "/").first.map(String.init) }) ?? defaultRemote else {
            errorMessage = "원격 저장소가 없습니다."
            return
        }
        await run("Push 중…", ["push"] + (b.upstream == nil ? ["-u"] : []) + [remote, b.name], network: true)
    }

    func checkout(_ b: Branch) async {
        if !b.isRemote, let w = worktree(using: b.name) {
            confirm = ConfirmRequest(title: "'\(b.name)'은(는) 다른 워크트리에서 쓰는 중입니다",
                                     message: "\(w.path)\n한 브랜치는 워크트리 하나에서만 체크아웃할 수 있습니다. 그 워크트리를 열까요?",
                                     actionTitle: "워크트리 열기", destructive: false) { [weak self] in
                await self?.openOrReport(URL(fileURLWithPath: w.path, isDirectory: true))
            }
            return
        }
        if b.isRemote {
            let short = b.shortName
            if localBranches.contains(where: { $0.name == short }) {
                await run("체크아웃 중…", ["switch", short])
            } else {
                await run("체크아웃 중…", ["switch", "-c", short, "--track", b.name])
            }
        } else if !b.isCurrent {
            await run("체크아웃 중…", ["switch", b.name])
        }
    }

    func checkoutDetached(_ sha: String) async {
        await run("체크아웃 중…", ["switch", "--detach", sha])
    }

    func requestNewBranch(from start: String? = nil, label: String? = nil) {
        let s = start ?? headHash ?? "HEAD"
        sheet = .newBranch(start: s, label: label ?? headBranch ?? String(s.prefix(7)))
    }

    func createBranch(_ name: String, at start: String, checkout: Bool) async {
        let args = checkout ? ["switch", "-c", name, start] : ["branch", name, start]
        await run("브랜치 만드는 중…", args)
    }

    func confirmDelete(_ b: Branch) {
        if b.isRemote {
            guard let remote = b.remote else { return }
            confirm = ConfirmRequest(title: "원격 브랜치 '\(b.name)'을(를) 삭제할까요?",
                                     message: "\(remote) 서버에서 브랜치가 삭제됩니다. 다른 사람도 쓰는 브랜치라면 주의하세요.",
                                     actionTitle: "원격에서 삭제") { [weak self] in
                await self?.run("원격 브랜치 삭제 중…", ["push", remote, "--delete", b.shortName], network: true)
            }
        } else {
            confirm = ConfirmRequest(title: "브랜치 '\(b.name)'을(를) 삭제할까요?",
                                     message: "머지되지 않은 커밋이 있으면 git 이 삭제를 거부합니다. 그때는 '강제 삭제'를 쓰세요.",
                                     actionTitle: "삭제") { [weak self] in
                await self?.run("브랜치 삭제 중…", ["branch", "-d", b.name])
            }
        }
    }

    func confirmForceDelete(_ b: Branch) {
        confirm = ConfirmRequest(title: "브랜치 '\(b.name)'을(를) 강제로 삭제할까요?",
                                 message: "머지되지 않은 커밋도 함께 버려집니다.",
                                 actionTitle: "강제 삭제") { [weak self] in
            await self?.run("브랜치 삭제 중…", ["branch", "-D", b.name])
        }
    }

    func merge(_ name: String) async {
        await run("머지 중…", ["merge", name])
    }

    func rebase(onto name: String) async {
        await run("리베이스 중…", ["rebase", name])
    }

    func cherryPick(_ sha: String) async {
        await run("Cherry-pick 중…", ["cherry-pick", sha])
    }

    func revert(_ sha: String) async {
        await run("Revert 중…", ["revert", "--no-edit", sha])
    }

    func reset(to sha: String, mode: ResetMode) {
        let action: @MainActor () async -> Void = { [weak self] in
            await self?.run("Reset 중…", ["reset", "--\(mode.rawValue)", sha])
        }
        if mode == .hard {
            confirm = ConfirmRequest(title: "\(String(sha.prefix(7)))(으)로 Hard reset 할까요?",
                                     message: "커밋하지 않은 변경과 이후 커밋이 현재 브랜치에서 사라집니다.",
                                     actionTitle: "Hard reset", action: action)
        } else {
            Task { await action() }
        }
    }

    func createTag(_ name: String, message: String, at sha: String) async {
        let args = message.trimmed.isEmpty ? ["tag", name, sha] : ["tag", "-a", name, "-m", message, sha]
        await run("태그 만드는 중…", args)
    }

    func deleteTag(_ t: Tag) {
        confirm = ConfirmRequest(title: "태그 '\(t.name)'을(를) 삭제할까요?",
                                 message: "로컬 태그만 삭제됩니다.", actionTitle: "삭제") { [weak self] in
            await self?.run("태그 삭제 중…", ["tag", "-d", t.name])
        }
    }

    func pushTag(_ t: Tag) async {
        guard let remote = defaultRemote else { errorMessage = "원격 저장소가 없습니다."; return }
        await run("태그 Push 중…", ["push", remote, "refs/tags/" + t.name], network: true)
    }

    // MARK: 스태시

    func stash(message: String, includeUntracked: Bool) async {
        var args = ["stash", "push"]
        if includeUntracked { args.append("--include-untracked") }
        if !message.trimmed.isEmpty { args += ["-m", message.trimmed] }
        await run("Stash 중…", args)
    }

    func stashApply(_ s: Stash) async { await run("Stash 적용 중…", ["stash", "apply", s.ref]) }

    func stashPop(_ s: Stash? = nil) async {
        await run("Stash Pop 중…", ["stash", "pop"] + (s.map { [$0.ref] } ?? []))
    }

    func stashDrop(_ s: Stash) {
        confirm = ConfirmRequest(title: "\(s.ref)을(를) 버릴까요?", message: s.message,
                                 actionTitle: "버리기") { [weak self] in
            await self?.run("Stash 버리는 중…", ["stash", "drop", s.ref])
        }
    }

    // MARK: 스테이지·커밋

    func stage(_ changes: [FileChange]) async {
        guard !changes.isEmpty else { return }
        await run("스테이지 중…", ["add", "-A", "--"] + changes.flatMap(\.paths))
    }

    func unstage(_ changes: [FileChange]) async {
        guard !changes.isEmpty else { return }
        let paths = changes.flatMap(\.paths)
        if headHash == nil {
            await run("언스테이지 중…", ["rm", "--cached", "-r", "-q", "--"] + paths)
        } else {
            await run("언스테이지 중…", ["restore", "--staged", "--"] + paths)
        }
    }

    func stageAll() async { await run("스테이지 중…", ["add", "-A"]) }

    func unstageAll() async {
        if headHash == nil {
            await run("언스테이지 중…", ["rm", "--cached", "-r", "-q", "."])
        } else {
            await run("언스테이지 중…", ["reset", "-q"])
        }
    }

    func confirmDiscard(_ c: FileChange) {
        confirm = ConfirmRequest(title: "'\(c.fileName)'의 변경을 버릴까요?",
                                 message: c.kind == .untracked ? "추적하지 않는 새 파일이 삭제됩니다." : "작업 트리의 수정 내용이 사라집니다.",
                                 actionTitle: "변경 버리기") { [weak self] in
            if c.kind == .untracked {
                await self?.run("변경 버리는 중…", ["clean", "-f", "-q", "--", c.path])
            } else {
                await self?.run("변경 버리는 중…", ["restore", "--worktree", "--"] + c.paths)
            }
        }
    }

    func confirmDiscardAll() {
        confirm = ConfirmRequest(title: "모든 변경을 버릴까요?",
                                 message: "스테이지된 것과 안 된 것, 추적하지 않는 새 파일까지 모두 사라집니다. 되돌릴 수 없습니다.",
                                 actionTitle: "모두 버리기") { [weak self] in
            guard let self else { return }
            if self.headHash != nil {
                guard await self.run("되돌리는 중…", ["reset", "--hard", "-q"]) else { return }
            }
            await self.run("정리 중…", ["clean", "-fd", "-q"])
        }
    }

    var canCommit: Bool {
        busy == nil && !summary.trimmed.isEmpty
            && (!status.staged.isEmpty || amend || repoState == .merging)
            && status.conflicted.isEmpty
    }

    func setAmend(_ on: Bool) async {
        amend = on
        guard on, summary.isEmpty, message.isEmpty, let url, headHash != nil,
              let r = try? await Git.run(["log", "-1", "--format=%B"], in: url) else { return }
        let text = r.output.trimmed
        let first = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        summary = first
        message = String(text.dropFirst(first.count)).trimmed
    }

    func commit() async {
        guard canCommit else { return }
        let text = [summary.trimmed, message.trimmed].filter { !$0.isEmpty }.joined(separator: "\n\n")
        var args = ["commit", "-F", "-"]
        if amend { args.append("--amend") }
        if await run("커밋 중…", args, input: text + "\n") {
            summary = ""
            message = ""
            amend = false
            mergeMessageFilled = false
        }
    }

    // MARK: 진행 중인 머지·리베이스

    func abortOperation() {
        let args: [String]
        switch repoState {
        case .merging: args = ["merge", "--abort"]
        case .rebasing: args = ["rebase", "--abort"]
        case .cherryPicking: args = ["cherry-pick", "--abort"]
        case .reverting: args = ["revert", "--abort"]
        case .clean: return
        }
        confirm = ConfirmRequest(title: "\(repoState.title)을(를) 중단할까요?",
                                 message: "작업을 시작하기 전 상태로 돌아갑니다.", actionTitle: "중단") { [weak self] in
            await self?.run("중단하는 중…", args)
            self?.summary = ""
            self?.message = ""
        }
    }

    func continueOperation() async {
        switch repoState {
        case .rebasing: await run("리베이스 계속…", ["rebase", "--continue"])
        case .cherryPicking: await run("Cherry-pick 계속…", ["cherry-pick", "--continue"])
        case .reverting: await run("Revert 계속…", ["revert", "--continue"])
        case .merging: await commit()
        case .clean: break
        }
    }

    // MARK: - 기타

    func revealInFinder(_ c: FileChange) {
        guard let url else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url.appendingPathComponent(c.path)])
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func describe(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
