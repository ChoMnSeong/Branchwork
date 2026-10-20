import SwiftUI
import AppKit
import Observation

/// 열린 저장소 하나의 상태와 모든 git 작업. 화면은 이 객체만 바라본다.
@MainActor @Observable
final class RepoStore: Identifiable {
    let id = UUID()
    /// 지금 보이는 탭인지 — 뒤에 있는 탭은 파일이 바뀌어도 바로 다시 읽지 않고 돌아왔을 때 읽는다
    var isActive = false
    private var pendingReload = false

    // MARK: 저장소
    private(set) var url: URL?
    private(set) var gitDir: URL?
    var name: String { url?.lastPathComponent ?? "Branchwork" }

    // MARK: 데이터
    private(set) var entries: [GraphEntry] = []
    private(set) var maxLanes = 1
    private(set) var commitIndex: [String: Int] = [:]
    private(set) var refsByCommit: [String: [RefLabel]] = [:]
    private(set) var localBranches: [Branch] = []
    private(set) var remoteBranches: [Branch] = []
    private(set) var remotes: [String] = []
    private(set) var tags: [Tag] = []
    private(set) var stashes: [Stash] = []
    private(set) var status = WorkingStatus()
    private(set) var headHash: String?
    private(set) var headBranch: String?
    private(set) var repoState: RepoState = .clean
    private(set) var hasMore = false
    private var limit = 2000
    private var emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

    // MARK: 선택·상세
    private(set) var selection: Selection?
    private(set) var detail: CommitDetail?
    private(set) var detailFiles: [FileChange] = []
    private(set) var diffSource: DiffSource?
    private(set) var diff: DiffDocument?
    private(set) var diffLoading = false
    var scrollTarget: String?

    // MARK: 커밋 입력
    var summary = ""
    var message = ""
    private(set) var amend = false
    private var mergeMessageFilled = false

    // MARK: UI
    var busy: String?
    var errorMessage: String?
    var sheet: SheetKind?
    var confirm: ConfirmRequest?
    var notRepoPrompt: URL?
    private(set) var recents: [URL] = Recents.load()

    // MARK: 그래프 끌어다 놓기
    var dropRequest: DropRequest?

    // MARK: 터미널 패널
    var terminals: [TerminalSession] = []
    var activeTerminalID: UUID?
    var showTerminal = false

    // MARK: 로딩 화면
    weak var window: NSWindow?
    var loading: LoadingInfo?
    /// 창이 처음 무엇을 보여 줄지 정했는지(그 전에는 로딩 화면)
    var booted = false

    // MARK: 줄 수·나
    var detailStats: [String: LineStat] = [:]
    var stagedStats: [String: LineStat] = [:]
    var unstagedStats: [String: LineStat] = [:]
    var me: Identity?

    // MARK: 검색
    var searchText = ""
    var searchScope: SearchScope = .commits
    var searchMatches: [String] = []
    var searchMatchSet: Set<String> = []
    var searchUnloaded = 0
    var searching = false
    var searchFocusRequest = 0
    var searchTask: Task<Void, Never>?

    // MARK: 워크트리·호스팅·Claude
    var worktrees: [Worktree] = []
    var worktreeStats: [String: WorktreeStats] = [:]
    private(set) var remoteURLs: [String: String] = [:]
    var target: RepoTarget?
    var pullRequests: [PullRequest] = []
    var prState: LoadState = .idle
    var aiWorking: String?
    var aiNotice: String?
    var explanations: [String: String] = [:]
    var explaining: Set<String> = []
    var splitPlan: [SplitGroup]?

    private var watcher: FileWatcher?
    private var reloadGeneration = 0
    private var watchTask: Task<Void, Never>?
    private var detailTask: Task<Void, Never>?
    private var diffTask: Task<Void, Never>?

    var currentBranch: Branch? { localBranches.first { $0.isCurrent } }

    // MARK: - 열기·닫기

    /// 폴더가 속한 저장소의 최상위 경로(저장소가 아니면 nil)
    static func toplevel(of folder: URL) async -> URL? {
        guard let r = try? await Git.raw(["rev-parse", "--show-toplevel"], in: folder), r.status == 0 else { return nil }
        let p = r.output.trimmed
        return p.isEmpty ? nil : URL(fileURLWithPath: p, isDirectory: true)
    }

    /// 연결된 워크트리(메인이 아닌)로 연 탭인지
    var isLinkedWorktree: Bool { gitDir?.path.contains("/worktrees/") ?? false }

    /// 탭으로 돌아왔을 때: 뒤에 있는 동안 바뀐 게 있으면 다시 읽는다
    func activated() async {
        guard url != nil else { return }
        if pendingReload {
            pendingReload = false
            await reload(quiet: true)
        }
    }

    @discardableResult
    func open(_ folder: URL) async -> OpenResult {
        let started = Date()
        loading = LoadingInfo(title: "\(folder.lastPathComponent) 여는 중", step: "저장소 확인 중…")
        defer { if url == nil { loading = nil } }
        let r: GitResult
        do {
            r = try await Git.raw(["rev-parse", "--show-toplevel", "--absolute-git-dir"], in: folder)
        } catch {
            return .failed(describe(error))
        }
        guard r.status == 0 else {
            if r.stderr.contains("not a git repository") { return .notRepository(folder) }
            return .failed(r.stderr.trimmed)
        }
        let lines = r.output.split(separator: "\n").map(String.init)
        guard lines.count >= 2 else { return .failed("저장소 경로를 확인하지 못했습니다.") }

        resetState()
        let top = URL(fileURLWithPath: lines[0], isDirectory: true)
        loading = LoadingInfo(title: "\(top.lastPathComponent) 여는 중", step: "커밋과 브랜치 읽는 중…")
        url = top
        gitDir = URL(fileURLWithPath: lines[1], isDirectory: true)
        recents = Recents.add(top)
        if let t = try? await Git.run(["hash-object", "-t", "tree", "/dev/null"], in: top) {
            emptyTree = t.output.trimmed
        }
        if let n = try? await Git.run(["config", "user.name"], in: top, ok: [0, 1]),
           let e = try? await Git.run(["config", "user.email"], in: top, ok: [0, 1]), !n.output.trimmed.isEmpty {
            me = Identity(name: n.output.trimmed, email: e.output.trimmed)
        }
        watcher = FileWatcher(path: top.path) { [weak self] paths in
            Task { @MainActor in self?.fileSystemChanged(paths) }
        }
        await reload()
        selectDefault()
        // 로딩 화면이 번쩍 지나가지 않게 애니메이션 한 호흡(약 0.9초)은 보여 준다
        let shown = Date().timeIntervalSince(started)
        if shown < 0.9 { try? await Task.sleep(for: .milliseconds(Int((0.9 - shown) * 1000))) }
        loading = nil
        return .opened
    }

    /// 다른 저장소·워크트리를 새 탭으로 여는 동작(창이 넣어 준다)
    var openRepo: ((URL) -> Void)?

    /// 다른 저장소·워크트리 열기: 빈 창이면 이 자리에, 저장소가 열린 창이면 새 탭으로
    /// (이미 열린 저장소면 그 탭이 앞으로 온다)
    func openOrReport(_ folder: URL) async {
        guard url != nil, let openRepo else { await openInPlace(folder); return }
        guard let top = await Self.toplevel(of: folder) else { notRepoPrompt = folder; return }
        if top.standardizedFileURL.path == url?.standardizedFileURL.path { return }
        openRepo(top)
    }

    func openInPlace(_ folder: URL) async {
        switch await open(folder) {
        case .opened: break
        case .notRepository(let u): notRepoPrompt = u
        case .failed(let m): errorMessage = m
        }
    }

    func close() {
        closeAllTerminals()
        watcher = nil
        resetState()
        url = nil
        gitDir = nil
    }

    func forgetRecent(_ u: URL) {
        recents = Recents.remove(u)
    }

    func presentOpenPanel() {
        let p = NSOpenPanel()
        p.canChooseDirectories = true
        p.canChooseFiles = false
        p.allowsMultipleSelection = false
        p.prompt = "열기"
        p.message = "Git 저장소 폴더를 선택하세요"
        if p.runModal() == .OK, let u = p.url {
            Task { await openOrReport(u) }
        }
    }

    func presentInitPanel() {
        let p = NSOpenPanel()
        p.canChooseDirectories = true
        p.canChooseFiles = false
        p.canCreateDirectories = true
        p.prompt = "여기에 만들기"
        p.message = "새 Git 저장소를 만들 폴더를 선택하세요"
        if p.runModal() == .OK, let u = p.url {
            Task { await initRepository(at: u) }
        }
    }

    func initRepository(at folder: URL) async {
        do {
            try await Git.run(["init"], in: folder)
            await openOrReport(folder)
        } catch {
            errorMessage = describe(error)
        }
    }

    func clone(remote: String, parent: URL, folder: String) async {
        busy = "복제 중…"
        if url == nil { loading = LoadingInfo(title: "\(folder) 복제 중", step: "원격 저장소에서 받는 중…") }
        do {
            try await Git.run(["clone", "--", remote, folder], in: parent, timeout: 3600,
                              env: AccountStore.shared.gitEnvironment(target: nil, repoPath: nil))
            busy = nil
            await openOrReport(parent.appendingPathComponent(folder, isDirectory: true))
        } catch {
            busy = nil
            if url == nil { loading = nil }
            errorMessage = describe(error)
        }
    }

    private func resetState() {
        entries = []; maxLanes = 1; commitIndex = [:]; refsByCommit = [:]
        localBranches = []; remoteBranches = []; remotes = []; tags = []; stashes = []
        status = WorkingStatus(); headHash = nil; headBranch = nil; repoState = .clean
        hasMore = false; limit = 2000
        selection = nil; detail = nil; detailFiles = []; diffSource = nil; diff = nil
        summary = ""; message = ""; amend = false; mergeMessageFilled = false
        worktrees = []; remoteURLs = [:]; target = nil; pullRequests = []; prState = .idle
        aiWorking = nil; aiNotice = nil; explanations = [:]; explaining = []
        detailTask?.cancel(); diffTask?.cancel(); watchTask?.cancel()
    }

    // MARK: - 새로 고침

    func reload(quiet: Bool = false) async {
        guard let url else { return }
        reloadGeneration += 1
        let gen = reloadGeneration
        do {
            async let statusR = Git.run(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], in: url)
            async let logR = Git.run(["log", "--exclude=refs/stash", "--all", "--date-order", "-n", String(limit + 1),
                                      "--format=" + Parsers.logFormat], in: url, ok: [0, 128])
            async let refsR = Git.run(["for-each-ref", "--format=" + Parsers.refFormat,
                                       "refs/heads", "refs/remotes", "refs/tags"], in: url)
            async let stashR = Git.run(["stash", "list", "--format=" + Parsers.stashFormat], in: url, ok: [0, 1, 128])
            async let headR = Git.run(["rev-parse", "--verify", "-q", "HEAD"], in: url, ok: [0, 1, 128])
            async let remoteR = Git.run(["remote", "-v"], in: url)
            async let worktreeR = Git.run(["worktree", "list", "--porcelain"], in: url, ok: [0, 128])
            async let unstagedNumR = Git.run(["diff", "--no-ext-diff", "--numstat", "-z"], in: url, ok: [0, 128])
            async let stagedNumR = Git.run(["diff", "--cached", "--no-ext-diff", "-M", "--numstat", "-z"], in: url, ok: [0, 128])
            let (st, lg, rf, sh, hd, rm, wt) = try await (statusR, logR, refsR, stashR, headR, remoteR, worktreeR)
            let (un, sn) = try await (unstagedNumR, stagedNumR)
            guard gen == reloadGeneration, self.url == url else { return }

            let newStatus = Parsers.status(st.data)
            let head = hd.status == 0 ? hd.output.trimmed : nil
            var commits = Parsers.log(lg.data)
            let more = commits.count > limit
            if more { commits.removeLast(commits.count - limit) }
            if !newStatus.isEmpty { commits.insert(.wip(parent: head), at: 0) }
            if loading != nil { loading?.step = "커밋 \(commits.count)개로 그래프 그리는 중…" }
            let list = commits
            let layout = await Task.detached(priority: .userInitiated) { GraphLayout.compute(list) }.value
            guard gen == reloadGeneration, self.url == url else { return }

            let refs = Parsers.refs(rf.output)
            status = newStatus
            headHash = head
            headBranch = newStatus.branch
            localBranches = refs.locals
            remoteBranches = refs.remotes
            tags = refs.tags
            stashes = Parsers.stashes(sh.output)
            let parsedRemotes = Parsers.remotes(rm.output)
            remotes = parsedRemotes.names
            remoteURLs = parsedRemotes.urls
            worktrees = Parsers.worktrees(wt.output)
            unstagedStats = Parsers.numstat(un.data)
            stagedStats = Parsers.numstat(sn.data)
            let newTarget = Hosting.target(remotes: remotes, urls: remoteURLs,
                                           gitlabHosts: AccountStore.shared.accounts(for: .gitlab).map(\.host))
            if newTarget != target {
                target = newTarget
                Task { await loadPullRequests() }
            }
            hasMore = more
            maxLanes = layout.maxLanes
            entries = zip(list, layout.rows).map { GraphEntry(commit: $0, row: $1) }
            commitIndex = Dictionary(entries.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
            refsByCommit = buildRefMap(head: head)
            repoState = detectState()
            prefillMergeMessage()
            fixSelection()
            if !searchMatchSet.isEmpty {
                searchMatches = entries.compactMap { searchMatchSet.contains($0.id) ? $0.id : nil }
            }
        } catch {
            guard gen == reloadGeneration, !quiet else { return }
            errorMessage = describe(error)
        }
    }

    func loadMore() async {
        limit += 3000
        await reload()
    }

    private func fileSystemChanged(_ paths: [String]) {
        guard let root = url?.path else { return }
        let git = gitDir?.path ?? root + "/.git"
        let relevant = paths.contains { p in
            !(p.hasPrefix(git + "/objects") || p.hasPrefix(git + "/logs"))
        }
        guard relevant else { return }
        guard isActive else { pendingReload = true; return }
        watchTask?.cancel()
        watchTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled, busy == nil else { return }
            await reload(quiet: true)
        }
    }

    private func buildRefMap(head: String?) -> [String: [RefLabel]] {
        var map: [String: [RefLabel]] = [:]
        if headBranch == nil, let head {
            map[head, default: []].append(RefLabel(name: "HEAD", kind: .head, isCurrent: true))
        }
        for b in localBranches {
            map[b.target, default: []].append(RefLabel(name: b.name, kind: .local, isCurrent: b.isCurrent))
        }
        for b in remoteBranches {
            map[b.target, default: []].append(RefLabel(name: b.name, kind: .remote, isCurrent: false))
        }
        for t in tags {
            map[t.target, default: []].append(RefLabel(name: t.name, kind: .tag, isCurrent: false))
        }
        for k in map.keys {
            map[k]?.sort { ($0.isCurrent ? 0 : 1, $0.kind.rawValue) < ($1.isCurrent ? 0 : 1, $1.kind.rawValue) }
        }
        return map
    }

    private func detectState() -> RepoState {
        guard let g = gitDir else { return .clean }
        let fm = FileManager.default
        func has(_ p: String) -> Bool { fm.fileExists(atPath: g.appendingPathComponent(p).path) }
        if has("rebase-merge") || has("rebase-apply") { return .rebasing }
        if has("MERGE_HEAD") { return .merging }
        if has("CHERRY_PICK_HEAD") { return .cherryPicking }
        if has("REVERT_HEAD") { return .reverting }
        return .clean
    }

    /// 머지·cherry-pick 충돌 중이면 git 이 준비한 MERGE_MSG 로 커밋 메시지를 한 번 채운다.
    private func prefillMergeMessage() {
        guard repoState != .clean else { mergeMessageFilled = false; return }
        guard !mergeMessageFilled, summary.isEmpty, message.isEmpty, let g = gitDir,
              let text = try? String(contentsOf: g.appendingPathComponent("MERGE_MSG"), encoding: .utf8) else { return }
        mergeMessageFilled = true
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.hasPrefix("#") }.map(String.init)
        summary = lines.first?.trimmed ?? ""
        message = lines.dropFirst().joined(separator: "\n").trimmed
    }

    private func fixSelection() {
        switch selection {
        case .wip?:
            break
        case .commit(let sha)?:
            if commitIndex[sha] == nil && !stashes.contains(where: { $0.hash == sha }) { selectDefault() }
        case .pullRequest?:
            break
        case nil:
            selectDefault()
        }
        if case .working(let c)? = diffSource {
            let all = status.staged + status.unstaged + status.conflicted
            if let match = all.first(where: { $0.path == c.path && $0.staged == c.staged }) {
                diffSource = .working(match)
                loadDiff(keepCurrent: true)
            } else {
                closeDiff()
            }
        }
    }

    func selectDefault() {
        if !status.isEmpty || headHash == nil {
            select(.wip)
            scrollTarget = entries.first?.id
        } else if let h = headHash {
            select(.commit(h))
            scrollTarget = h
        }
    }

    // MARK: - 선택

    func select(_ sel: Selection?) {
        guard sel != selection else { return }
        selection = sel
        closeDiff()
        detailTask?.cancel()
        detail = nil
        detailFiles = []
        detailStats = [:]
        guard case .commit(let sha)? = sel, let url else { return }
        let empty = emptyTree
        detailTask = Task {
            do {
                let show = try await Git.run(["show", "-s", "--format=" + Parsers.detailFormat, sha], in: url)
                let d = Parsers.commitDetail(show.output)
                let base = d?.parents.first ?? empty
                async let filesR = Git.run(["diff-tree", "-r", "-M", "--name-status", "-z", base, sha], in: url)
                async let numR = Git.run(["diff-tree", "-r", "-M", "--numstat", "-z", base, sha], in: url)
                let (files, num) = try await (filesR, numR)
                guard !Task.isCancelled, self.selection == .commit(sha) else { return }
                self.detail = d
                self.detailFiles = Parsers.nameStatus(files.data)
                self.detailStats = Parsers.numstat(num.data)
            } catch {
                guard !Task.isCancelled else { return }
                self.errorMessage = describe(error)
            }
        }
    }

    /// 사이드바에서 브랜치·태그를 누르면 그래프에서 해당 커밋을 찾아 보여 준다.
    func reveal(_ sha: String) {
        if commitIndex[sha] != nil || stashes.contains(where: { $0.hash == sha }) {
            select(.commit(sha))
            scrollTarget = sha
        } else if busy == nil {
            Task { await revealLoadingHistory(sha) }
        }
    }

    /// 그래프에 아직 없는 오래된 커밋이면 기록을 더 불러와(2000 → 8000 → …) 찾아 보여 준다.
    private func revealLoadingHistory(_ sha: String) async {
        busy = "이전 기록 불러오는 중…"
        while commitIndex[sha] == nil, hasMore, limit < 1_000_000 {
            limit *= 4
            await reload()
        }
        busy = nil
        if commitIndex[sha] != nil {
            select(.commit(sha))
            scrollTarget = sha
        } else {
            errorMessage = "이 커밋은 그래프에 포함되지 않는 기록에 있습니다."
        }
    }

    func moveSelection(_ delta: Int) {
        guard !entries.isEmpty else { return }
        let current: Int
        switch selection {
        case .wip?: current = commitIndex[Commit.wipID] ?? -1
        case .commit(let s)?: current = commitIndex[s] ?? -1
        case .pullRequest?, nil: current = -1
        }
        let next = max(0, min(entries.count - 1, current + delta))
        let e = entries[next]
        select(e.commit.isWIP ? .wip : .commit(e.id))
        scrollTarget = e.id
    }

    // MARK: - Diff

    func openDiff(_ source: DiffSource) {
        guard source != diffSource else { return }
        diffSource = source
        loadDiff(keepCurrent: false)
    }

    func closeDiff() {
        diffTask?.cancel()
        diffSource = nil
        diff = nil
        diffLoading = false
    }

    private func loadDiff(keepCurrent: Bool) {
        diffTask?.cancel()
        guard let source = diffSource, let url else { diff = nil; return }
        if !keepCurrent { diff = nil }
        diffLoading = true
        let empty = emptyTree
        diffTask = Task {
            var args: [String]
            var ok: Set<Int32> = [0]
            switch source {
            case .working(let c):
                if c.kind == .untracked {
                    args = ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", c.path]
                    ok = [0, 1]
                } else if c.staged {
                    args = ["diff", "--cached", "--no-ext-diff", "-M", "--"] + c.paths
                } else {
                    args = ["diff", "--no-ext-diff", "--"] + c.paths
                }
            case .commit(let sha, let c, let parent):
                args = ["diff", "--no-ext-diff", "-M", parent ?? empty, sha, "--"] + c.paths
            }
            do {
                let r = try await Git.run(args, in: url, ok: ok)
                let doc = await Task.detached { Parsers.diff(r.output) }.value
                guard !Task.isCancelled, self.diffSource == source else { return }
                self.diff = doc
            } catch {
                guard !Task.isCancelled, self.diffSource == source else { return }
                self.diff = DiffDocument(error: describe(error))
            }
            self.diffLoading = false
        }
    }

    // MARK: - 작업 실행

    /// git 명령 하나를 실행하고 저장소를 다시 읽는다. 실패하면 git 의 메시지를 그대로 보여 준다.
    @discardableResult
    func run(_ label: String, _ args: [String], network: Bool = false, input: String? = nil) async -> Bool {
        guard let url, busy == nil else { return false }
        busy = label
        defer { busy = nil }
        do {
            try await Git.run(args, in: url, input: input, timeout: network ? 900 : 300,
                              env: network ? AccountStore.shared.gitEnvironment(target: target, repoPath: url.path) : [:])
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
