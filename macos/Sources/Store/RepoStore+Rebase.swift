import Foundation

/// 인터랙티브 리베이스(커밋 정리): 현재 브랜치의 커밋을 합치기·순서 바꾸기·메시지 고치기·빼기
extension RepoStore {
    /// 이 커밋부터 HEAD 까지를 정리하는 창을 연다
    func startInteractiveRebase(from sha: String) async {
        guard let url, let branch = headBranch else { return }
        guard repoState == .clean else {
            errorMessage = String(localized: "You can't clean up commits right now (\(repoState.title)).")
            return
        }
        guard await isAncestor(sha, of: "HEAD") else {
            errorMessage = String(localized: "You can only clean up commits that are on the current branch '\(branch)'.")
            return
        }
        let base = (try? await Git.run(["rev-parse", "--verify", "-q", "\(sha)^"], in: url))?.output.trimmed
        let range = base.map { "\($0)..HEAD" } ?? "HEAD"
        guard let r = try? await Git.run(["log", "--format=%H%x1f%P%x1f%an%x1f%B%x1e", range], in: url) else {
            errorMessage = String(localized: "Couldn't read the commit list.")
            return
        }
        var items: [RebaseItem] = []
        for rec in r.output.split(separator: "\u{1e}") {
            let f = rec.trimmingCharacters(in: .newlines).split(separator: "\u{1f}", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
            guard f.count == 4 else { continue }
            if f[1].split(separator: " ").count > 1 {
                errorMessage = String(localized: "There's a merge commit in the range. Pick a commit above the merge commit.")
                return
            }
            items.append(RebaseItem(sha: f[0], message: f[3].trimmingCharacters(in: .newlines), author: f[2]))
        }
        guard !items.isEmpty else { return }
        // 가장 오래된 커밋이 이미 올라간 브랜치에 있으면, 정리한 뒤 강제 푸시가 필요하다
        var pushed = false
        if let up = status.upstream { pushed = await isAncestor(items[items.count - 1].sha, of: up) }
        rebasePlan = RebasePlan(base: base, items: items, pushed: pushed)
        sheet = .interactiveRebase
    }

    /// 계획대로 git rebase -i 를 돌린다(할 일 목록은 미리 만들어 편집기 대신 복사해 넣는다)
    func runInteractiveRebase(_ plan: RebasePlan) async {
        guard let gitDir, plan.problem == nil else { return }
        let dir = gitDir.appendingPathComponent("branchwork-rebase")
        try? FileManager.default.removeItem(at: dir)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for item in plan.items where item.action == .reword {
                try Data(item.newMessage.utf8).write(to: dir.appendingPathComponent("msg-\(item.sha)"))
            }
            let todo = plan.todo { dir.appendingPathComponent("msg-\($0)").path }
            try Data(todo.utf8).write(to: dir.appendingPathComponent("todo"))
        } catch {
            errorMessage = String(localized: "Couldn't write the cleanup plan.\n\n") + describe(error)
            return
        }
        let editor = "cp " + RebasePlan.shellQuote(dir.appendingPathComponent("todo").path)
        let ok = await run(String(localized: "Cleaning up commits…"), ["-c", "sequence.editor=\(editor)", "rebase", "-i", "--autostash", plan.base ?? "--root"])
        rebasePlan = nil
        // 충돌로 멈추면 남은 메시지 고치기에 파일이 필요하다
        if ok && repoState == .clean { try? FileManager.default.removeItem(at: dir) }
    }
}
