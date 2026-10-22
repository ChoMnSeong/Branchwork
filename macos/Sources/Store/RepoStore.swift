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
    var limit = 2000
    var emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

    // MARK: 선택·상세
    var selection: Selection?
    var detail: CommitDetail?
    var detailFiles: [FileChange] = []
    var diffSource: DiffSource?
    var diff: DiffDocument?
    var diffLoading = false
    var scrollTarget: String?

    // MARK: 커밋 입력
    var summary = ""
    var message = ""
    var amend = false
    var mergeMessageFilled = false

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

    // CI/CD (GitLab 파이프라인 · GitHub Actions)
    var ciPipelines: [CIPipeline] = []
    var ciState: LoadState = .idle
    var ciJobs: [Int: [CIJob]] = [:]
    var ciDeployments: [Int: [CIDeployment]] = [:]
    /// 진행 중인 버튼 동작(같은 버튼을 두 번 누르지 않게)
    var ciBusy: Set<String> = []
    var ciCurrentBranchOnly = UserDefaults.standard.bool(forKey: "ciCurrentBranchOnly") {
        didSet { UserDefaults.standard.set(ciCurrentBranchOnly, forKey: "ciCurrentBranchOnly") }
    }

    private var watcher: FileWatcher?
    private var reloadGeneration = 0
    private var watchTask: Task<Void, Never>?
    var detailTask: Task<Void, Never>?
    var diffTask: Task<Void, Never>?

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
            if let t = newTarget, t.provider == .github { AvatarStore.shared.noteGitHubRepo(t.path) }
            if newTarget != target {
                target = newTarget
                resetCI()
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
}
