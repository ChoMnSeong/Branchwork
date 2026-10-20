import { accounts } from "./accounts";
import { ai, clip, Prompts, splitMessage } from "./ai";
import { agents, type AgentHost, type AgentKind } from "./agents";
import { basename, dirname, joinPath, samePath, slash } from "./env";
import { describe, git, gitRaw, type GitOptions } from "./git";
import { layoutGraph } from "./graph";
import * as Hosting from "./hosting";
import { ipc } from "./ipc";
import {
  branchRemote,
  branchShort,
  changePaths,
  emptyStatus,
  fileName,
  isWIP,
  providerInfo,
  refOrder,
  sameDiffSource,
  sameTarget,
  short,
  statusCount,
  statusIsEmpty,
  WIP_ID,
  wipCommit,
  worktreeStats,
  type Branch,
  type CommitDetail,
  type ConfirmRequest,
  type DiffDocument,
  type DiffSource,
  type DropChoice,
  type DropRequest,
  type FileChange,
  type GraphEntry,
  type HostAccount,
  type Identity,
  type LineStat,
  type LoadingInfo,
  type LoadState,
  type PullMode,
  type PullRequest,
  type RefLabel,
  type RepoState,
  type RepoTarget,
  type ResetMode,
  type SearchScope,
  type Selection,
  type SheetKind,
  type Stash,
  type Tag,
  type WorkingStatus,
  type Worktree,
  type WorktreeStats,
} from "./models";
import { Observable } from "./observable";
import * as P from "./parsers";
import { addRecent } from "./settings";
import { TerminalSession, type TerminalSpec } from "./terminal";

export const branchPayload = "branchwork-branch:";
export const commitPayload = "branchwork-commit:";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** 열린 저장소 하나(=탭 하나)의 상태와 모든 git 작업. 화면은 이 객체만 바라본다. (맥 버전 RepoStore) */
export class RepoStore extends Observable implements AgentHost {
  readonly id = crypto.randomUUID();
  /** 지금 보이는 탭인지 — 뒤에 있는 탭은 파일이 바뀌어도 바로 다시 읽지 않고 돌아왔을 때 읽는다 */
  isActive = false;
  private pendingReload = false;

  // 저장소
  path: string | null = null;
  gitDir: string | null = null;
  get name() {
    return this.path ? basename(this.path) : "Branchwork";
  }

  // 데이터
  entries: GraphEntry[] = [];
  maxLanes = 1;
  commitIndex = new Map<string, number>();
  refsByCommit = new Map<string, RefLabel[]>();
  localBranches: Branch[] = [];
  remoteBranches: Branch[] = [];
  remotes: string[] = [];
  tags: Tag[] = [];
  stashes: Stash[] = [];
  status: WorkingStatus = emptyStatus();
  headHash: string | null = null;
  headBranch: string | null = null;
  repoState: RepoState = "clean";
  hasMore = false;
  private limit = 2000;

  // 선택·상세
  selection: Selection | null = null;
  detail: CommitDetail | null = null;
  detailFiles: FileChange[] = [];
  detailStats: Record<string, LineStat> = {};
  diffSource: DiffSource | null = null;
  diff: DiffDocument | null = null;
  diffLoading = false;
  scrollTarget: string | null = null;

  // 커밋 입력
  summary = "";
  message = "";
  amend = false;
  private mergeMessageFilled = false;

  // UI
  busy: string | null = null;
  errorMessage: string | null = null;
  sheet: SheetKind | null = null;
  confirm: ConfirmRequest | null = null;
  notRepoPrompt: string | null = null;
  dropRequest: DropRequest | null = null;
  loading: LoadingInfo | null = null;
  /** 탭이 처음 무엇을 보여 줄지 정했는지(그 전에는 로딩 화면) */
  booted = false;

  // 줄 수·나
  stagedStats: Record<string, LineStat> = {};
  unstagedStats: Record<string, LineStat> = {};
  me: Identity | null = null;

  // 검색
  searchText = "";
  searchScope: SearchScope = "commits";
  searchMatches: string[] = [];
  searchMatchSet = new Set<string>();
  searchUnloaded = 0;
  searching = false;
  searchFocusRequest = 0;
  private searchGen = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // 워크트리·호스팅·Claude
  worktrees: Worktree[] = [];
  worktreeStats: Record<string, WorktreeStats> = {};
  remoteURLs: Record<string, string> = {};
  target: RepoTarget | null = null;
  pullRequests: PullRequest[] = [];
  prState: LoadState = { kind: "idle" };
  aiWorking: string | null = null;
  aiNotice: string | null = null;
  explanations: Record<string, string> = {};
  explaining = new Set<string>();

  // 터미널 패널
  terminals: TerminalSession[] = [];
  activeTerminalID: string | null = null;
  showTerminal = false;

  /** 다른 저장소·워크트리를 새 탭으로 여는 동작(작업 공간이 넣어 준다) */
  openRepo: ((path: string) => void) | null = null;
  /** 이 탭을 앞으로(에이전트 세션으로 이동할 때) */
  activateTab: (() => void) | null = null;

  private reloadGeneration = 0;
  private watchIds: string[] = [];
  private unlisten: (() => void)[] = [];
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private detailGen = 0;
  private diffGen = 0;

  /** 화면이 바뀐 값을 다시 그리게 */
  changed() {
    this.emit();
  }

  get currentBranch() {
    return this.localBranches.find((b) => b.isCurrent) ?? null;
  }

  get selectedID(): string | null {
    if (!this.selection) return null;
    if (this.selection.kind === "wip") return WIP_ID;
    if (this.selection.kind === "commit") return this.selection.sha;
    return null;
  }

  /** 연결된 워크트리(메인이 아닌)로 연 탭인지 */
  get isLinkedWorktree() {
    return !!this.gitDir && slash(this.gitDir).includes("/worktrees/");
  }

  private g(args: string[], o: GitOptions = {}) {
    return git(args, this.path!, o);
  }

  // MARK: - 열기·닫기

  /** 폴더가 속한 저장소의 최상위 경로(저장소가 아니면 null) */
  static async toplevel(folder: string): Promise<string | null> {
    try {
      const r = await gitRaw(["rev-parse", "--show-toplevel"], folder);
      return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  /** 탭으로 돌아왔을 때: 뒤에 있는 동안 바뀐 게 있으면 다시 읽는다 */
  async activated() {
    if (!this.path) return;
    if (this.pendingReload) {
      this.pendingReload = false;
      await this.reload(true);
    }
  }

  async open(folder: string): Promise<{ kind: "opened" } | { kind: "notRepository"; path: string } | { kind: "failed"; message: string }> {
    const started = Date.now();
    this.loading = { title: `${basename(folder)} 여는 중`, step: "저장소 확인 중…" };
    this.emit();
    let r;
    try {
      r = await gitRaw(["rev-parse", "--show-toplevel", "--absolute-git-dir"], folder);
    } catch (e) {
      if (!this.path) this.loading = null;
      this.emit();
      return { kind: "failed", message: describe(e) };
    }
    if (r.status !== 0) {
      if (!this.path) this.loading = null;
      this.emit();
      if (r.stderr.includes("not a git repository")) return { kind: "notRepository", path: folder };
      return { kind: "failed", message: r.stderr.trim() };
    }
    const lines = r.stdout.trim().split(/\r?\n/);
    if (lines.length < 2) {
      this.loading = null;
      this.emit();
      return { kind: "failed", message: "저장소 경로를 확인하지 못했습니다." };
    }
    this.stopWatching();
    this.resetState();
    const top = lines[0].trim();
    this.loading = { title: `${basename(top)} 여는 중`, step: "커밋과 브랜치 읽는 중…" };
    this.path = top;
    this.gitDir = lines[1].trim();
    addRecent(top);
    this.emit();
    try {
      const n = await this.g(["config", "user.name"], { ok: [0, 1] });
      const e = await this.g(["config", "user.email"], { ok: [0, 1] });
      if (n.stdout.trim()) this.me = { name: n.stdout.trim(), email: e.stdout.trim() };
    } catch {
      /* 없음 */
    }
    await this.startWatching();
    await this.reload();
    this.selectDefault();
    // 로딩 화면이 번쩍 지나가지 않게 애니메이션 한 호흡(약 0.9초)은 보여 준다
    const shown = Date.now() - started;
    if (shown < 900) await new Promise((res) => setTimeout(res, 900 - shown));
    this.loading = null;
    this.emit();
    return { kind: "opened" };
  }

  async openInPlace(folder: string) {
    const r = await this.open(folder);
    if (r.kind === "notRepository") this.notRepoPrompt = r.path;
    else if (r.kind === "failed") this.errorMessage = r.message;
    this.booted = true;
    this.emit();
  }

  /** 다른 저장소·워크트리 열기: 빈 탭이면 이 자리에, 저장소가 열린 탭이면 새 탭으로 */
  async openOrReport(folder: string) {
    if (!this.path) {
      await this.openInPlace(folder);
      return;
    }
    const top = await RepoStore.toplevel(folder);
    if (!top) {
      this.notRepoPrompt = folder;
      this.emit();
      return;
    }
    if (samePath(top, this.path)) return;
    this.openRepo?.(top);
  }

  close() {
    this.closeAllTerminals();
    this.stopWatching();
    this.resetState();
    this.path = null;
    this.gitDir = null;
    this.emit();
  }

  private async startWatching() {
    if (!this.path) return;
    const dirs = [this.path];
    // 연결된 워크트리는 HEAD·refs 가 저장소 밖(.git/worktrees, 공용 .git)에 있어 그쪽도 본다
    try {
      const common = (await this.g(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
      for (const d of [this.gitDir, common]) {
        if (d && !slash(d).toLowerCase().startsWith(slash(this.path).toLowerCase() + "/") && !dirs.some((x) => samePath(x, d))) dirs.push(d);
      }
    } catch {
      /* 무시 */
    }
    for (const d of dirs) {
      const id = `${this.id}-${this.watchIds.length}`;
      try {
        await ipc.watchStart(id, d);
        this.watchIds.push(id);
        this.unlisten.push(await ipc.onWatch(id, (paths) => this.fileSystemChanged(paths)));
      } catch {
        /* 감시를 못 해도 새로 고침(F5)으로 볼 수 있다 */
      }
    }
  }

  private stopWatching() {
    for (const id of this.watchIds) void ipc.watchStop(id);
    for (const u of this.unlisten) u();
    this.watchIds = [];
    this.unlisten = [];
  }

  private resetState() {
    this.entries = [];
    this.maxLanes = 1;
    this.commitIndex = new Map();
    this.refsByCommit = new Map();
    this.localBranches = [];
    this.remoteBranches = [];
    this.remotes = [];
    this.tags = [];
    this.stashes = [];
    this.status = emptyStatus();
    this.headHash = null;
    this.headBranch = null;
    this.repoState = "clean";
    this.hasMore = false;
    this.limit = 2000;
    this.selection = null;
    this.detail = null;
    this.detailFiles = [];
    this.diffSource = null;
    this.diff = null;
    this.summary = "";
    this.message = "";
    this.amend = false;
    this.mergeMessageFilled = false;
    this.worktrees = [];
    this.remoteURLs = {};
    this.target = null;
    this.pullRequests = [];
    this.prState = { kind: "idle" };
    this.aiWorking = null;
    this.aiNotice = null;
    this.explanations = {};
    this.explaining = new Set();
    this.detailGen++;
    this.diffGen++;
  }

  async pickAndOpen() {
    const p = await ipc.pickFolder("Git 저장소 폴더를 선택하세요");
    if (p) await this.openOrReport(p);
  }

  async pickAndInit() {
    const p = await ipc.pickFolder("새 Git 저장소를 만들 폴더를 선택하세요");
    if (p) await this.initRepository(p);
  }

  async initRepository(folder: string) {
    try {
      await git(["init"], folder);
      await this.openOrReport(folder);
    } catch (e) {
      this.fail(e);
    }
  }

  async clone(remote: string, parent: string, folder: string) {
    this.busy = "복제 중…";
    if (!this.path) this.loading = { title: `${folder} 복제 중`, step: "원격 저장소에서 받는 중…" };
    this.emit();
    try {
      await git(["clone", "--", remote, folder], parent, { timeoutMs: 3_600_000, env: await accounts.gitEnvironment(null, null) });
      this.busy = null;
      await this.openOrReport(joinPath(parent, folder));
    } catch (e) {
      this.busy = null;
      if (!this.path) this.loading = null;
      this.fail(e);
    }
  }

  fail(e: unknown) {
    this.errorMessage = describe(e);
    this.emit();
  }

  // MARK: - 새로 고침

  private latestReload: Promise<void> | null = null;

  /** 저장소를 다시 읽는다. 도중에 더 새 읽기가 시작되면 그것까지 기다린다(부른 쪽이 늘 최신 상태를 보게). */
  async reload(quiet = false) {
    const p = this.readAll(quiet);
    this.latestReload = p;
    await p;
    while (this.latestReload && this.latestReload !== p) {
      const q: Promise<void> = this.latestReload;
      await q;
      if (this.latestReload === q) break;
    }
  }

  private async readAll(quiet: boolean) {
    const path = this.path;
    if (!path) return;
    const gen = ++this.reloadGeneration;
    try {
      const [st, lg, rf, sh, hd, rm, wt, un, sn] = await Promise.all([
        this.g(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]),
        this.g(["log", "--exclude=refs/stash", "--all", "--date-order", "-n", String(this.limit + 1), "--format=" + P.logFormat], { ok: [0, 128] }),
        this.g(["for-each-ref", "--format=" + P.refFormat, "refs/heads", "refs/remotes", "refs/tags"]),
        this.g(["stash", "list", "--format=" + P.stashFormat], { ok: [0, 1, 128] }),
        this.g(["rev-parse", "--verify", "-q", "HEAD"], { ok: [0, 1, 128] }),
        this.g(["remote", "-v"]),
        this.g(["worktree", "list", "--porcelain"], { ok: [0, 128] }),
        this.g(["diff", "--no-ext-diff", "--numstat", "-z"], { ok: [0, 128] }),
        this.g(["diff", "--cached", "--no-ext-diff", "-M", "--numstat", "-z"], { ok: [0, 128] }),
      ]);
      if (gen !== this.reloadGeneration || this.path !== path) return;

      const newStatus = P.parseStatus(st.stdout);
      const head = hd.status === 0 ? hd.stdout.trim() : null;
      let commits = P.parseLog(lg.stdout);
      const more = commits.length > this.limit;
      if (more) commits = commits.slice(0, this.limit);
      if (!statusIsEmpty(newStatus)) commits.unshift(wipCommit(head));
      if (this.loading) {
        this.loading = { ...this.loading, step: `커밋 ${commits.length}개로 그래프 그리는 중…` };
        this.emit();
      }
      const layout = layoutGraph(commits);

      const refs = P.parseRefs(rf.stdout);
      this.status = newStatus;
      this.headHash = head;
      this.headBranch = newStatus.branch;
      this.localBranches = refs.locals;
      this.remoteBranches = refs.remotes;
      this.tags = refs.tags;
      this.stashes = P.parseStashes(sh.stdout);
      const parsed = P.parseRemotes(rm.stdout);
      this.remotes = parsed.names;
      this.remoteURLs = parsed.urls;
      this.worktrees = P.parseWorktrees(wt.stdout);
      this.unstagedStats = P.parseNumstat(un.stdout);
      this.stagedStats = P.parseNumstat(sn.stdout);
      const newTarget = Hosting.findTarget(
        this.remotes,
        this.remoteURLs,
        accounts.accountsFor("gitlab").map((a) => new URL(a.server).host.toLowerCase()),
      );
      if (!sameTarget(newTarget, this.target)) {
        this.target = newTarget;
        void this.loadPullRequests();
      }
      this.hasMore = more;
      this.maxLanes = layout.maxLanes;
      this.entries = commits.map((c, i) => ({ commit: c, row: layout.rows[i] }));
      this.commitIndex = new Map();
      this.entries.forEach((e, i) => {
        if (!this.commitIndex.has(e.commit.id)) this.commitIndex.set(e.commit.id, i);
      });
      this.refsByCommit = this.buildRefMap(head);
      this.repoState = await this.detectState();
      await this.prefillMergeMessage();
      this.fixSelection();
      if (this.searchMatchSet.size) this.searchMatches = this.entries.filter((e) => this.searchMatchSet.has(e.commit.id)).map((e) => e.commit.id);
      this.emit();
    } catch (e) {
      if (gen !== this.reloadGeneration || quiet) return;
      this.fail(e);
    }
  }

  async loadMore() {
    this.limit += 3000;
    await this.reload();
  }

  private fileSystemChanged(paths: string[]) {
    if (!this.path || !paths.length) return;
    if (!this.isActive) {
      this.pendingReload = true;
      return;
    }
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      if (this.busy == null) void this.reload(true);
    }, 500);
  }

  private buildRefMap(head: string | null) {
    const map = new Map<string, RefLabel[]>();
    const add = (k: string, r: RefLabel) => {
      const l = map.get(k);
      if (l) l.push(r);
      else map.set(k, [r]);
    };
    if (!this.headBranch && head) add(head, { name: "HEAD", kind: "head", isCurrent: true });
    for (const b of this.localBranches) add(b.target, { name: b.name, kind: "local", isCurrent: b.isCurrent });
    for (const b of this.remoteBranches) add(b.target, { name: b.name, kind: "remote", isCurrent: false });
    for (const t of this.tags) add(t.target, { name: t.name, kind: "tag", isCurrent: false });
    for (const l of map.values()) l.sort((a, b) => (a.isCurrent ? 0 : 1) - (b.isCurrent ? 0 : 1) || refOrder[a.kind] - refOrder[b.kind]);
    return map;
  }

  private async detectState(): Promise<RepoState> {
    const g = this.gitDir;
    if (!g) return "clean";
    const has = (p: string) => ipc.exists(joinPath(g, p));
    const [rm, ra, mh, ch, rh] = await Promise.all([has("rebase-merge"), has("rebase-apply"), has("MERGE_HEAD"), has("CHERRY_PICK_HEAD"), has("REVERT_HEAD")]);
    if (rm || ra) return "rebasing";
    if (mh) return "merging";
    if (ch) return "cherryPicking";
    if (rh) return "reverting";
    return "clean";
  }

  /** 머지·cherry-pick 충돌 중이면 git 이 준비한 MERGE_MSG 로 커밋 메시지를 한 번 채운다 */
  private async prefillMergeMessage() {
    if (this.repoState === "clean") {
      this.mergeMessageFilled = false;
      return;
    }
    if (this.mergeMessageFilled || this.summary || this.message || !this.gitDir) return;
    const text = await ipc.readText(joinPath(this.gitDir, "MERGE_MSG"));
    if (!text) return;
    this.mergeMessageFilled = true;
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => !l.startsWith("#"));
    this.summary = (lines[0] ?? "").trim();
    this.message = lines.slice(1).join("\n").trim();
  }

  private fixSelection() {
    const sel = this.selection;
    if (!sel) this.selectDefault();
    else if (sel.kind === "commit" && !this.commitIndex.has(sel.sha) && !this.stashes.some((s) => s.hash === sel.sha)) this.selectDefault();
    const ds = this.diffSource;
    if (ds?.kind === "working") {
      const all = [...this.status.staged, ...this.status.unstaged, ...this.status.conflicted];
      const match = all.find((c) => c.path === ds.change.path && c.staged === ds.change.staged);
      if (match) {
        this.diffSource = { kind: "working", change: match };
        this.loadDiff(true);
      } else this.closeDiff();
    }
  }

  selectDefault() {
    if (!statusIsEmpty(this.status) || !this.headHash) {
      this.select({ kind: "wip" });
      this.scrollTarget = this.entries[0]?.commit.id ?? null;
    } else {
      this.select({ kind: "commit", sha: this.headHash });
      this.scrollTarget = this.headHash;
    }
  }

  // MARK: - 선택

  select(sel: Selection | null) {
    if (JSON.stringify(sel) === JSON.stringify(this.selection)) return;
    this.selection = sel;
    this.closeDiff();
    this.detail = null;
    this.detailFiles = [];
    this.detailStats = {};
    const gen = ++this.detailGen;
    this.emit();
    if (sel?.kind !== "commit" || !this.path) return;
    const sha = sel.sha;
    void (async () => {
      try {
        const show = await this.g(["show", "-s", "--format=" + P.detailFormat, sha]);
        const d = P.parseCommitDetail(show.stdout);
        const base = d?.parents[0] ?? EMPTY_TREE;
        const [files, num] = await Promise.all([
          this.g(["diff-tree", "-r", "-M", "--name-status", "-z", base, sha]),
          this.g(["diff-tree", "-r", "-M", "--numstat", "-z", base, sha]),
        ]);
        if (gen !== this.detailGen) return;
        this.detail = d;
        this.detailFiles = P.parseNameStatus(files.stdout);
        this.detailStats = P.parseNumstat(num.stdout);
        this.emit();
      } catch (e) {
        if (gen === this.detailGen) this.fail(e);
      }
    })();
  }

  /** 사이드바에서 브랜치·태그를 누르면 그래프에서 해당 커밋을 찾아 보여 준다 */
  reveal(sha: string) {
    if (this.commitIndex.has(sha) || this.stashes.some((s) => s.hash === sha)) {
      this.select({ kind: "commit", sha });
      this.scrollTarget = sha;
      this.emit();
    } else if (this.busy == null) {
      void this.revealLoadingHistory(sha);
    }
  }

  /** 그래프에 아직 없는 오래된 커밋이면 기록을 더 불러와(2000 → 8000 → …) 찾아 보여 준다 */
  private async revealLoadingHistory(sha: string) {
    this.busy = "이전 기록 불러오는 중…";
    this.emit();
    while (!this.commitIndex.has(sha) && this.hasMore && this.limit < 1_000_000) {
      this.limit *= 4;
      await this.reload();
    }
    this.busy = null;
    if (this.commitIndex.has(sha)) {
      this.select({ kind: "commit", sha });
      this.scrollTarget = sha;
    } else this.errorMessage = "이 커밋은 그래프에 포함되지 않는 기록에 있습니다.";
    this.emit();
  }

  moveSelection(delta: number) {
    if (!this.entries.length) return;
    const id = this.selectedID;
    const current = id ? this.commitIndex.get(id) ?? -1 : -1;
    const next = Math.max(0, Math.min(this.entries.length - 1, current + delta));
    const e = this.entries[next];
    this.select(isWIP(e.commit) ? { kind: "wip" } : { kind: "commit", sha: e.commit.id });
    this.scrollTarget = e.commit.id;
    this.emit();
  }

  // MARK: - Diff

  openDiff(source: DiffSource) {
    if (sameDiffSource(source, this.diffSource)) return;
    this.diffSource = source;
    this.loadDiff(false);
  }

  closeDiff() {
    this.diffGen++;
    this.diffSource = null;
    this.diff = null;
    this.diffLoading = false;
    this.emit();
  }

  private loadDiff(keepCurrent: boolean) {
    const source = this.diffSource;
    const path = this.path;
    if (!source || !path) {
      this.diff = null;
      return;
    }
    if (!keepCurrent) this.diff = null;
    this.diffLoading = true;
    const gen = ++this.diffGen;
    this.emit();
    void (async () => {
      let doc: DiffDocument;
      try {
        if (source.kind === "working" && source.change.kind === "untracked") {
          const head = await ipc.readHead(joinPath(path, source.change.path), 2_000_000);
          doc = head.binary ? { lines: [], isBinary: true, truncated: false } : P.newFileDiff(head.text, head.truncated);
        } else {
          let args: string[];
          if (source.kind === "working") {
            args = source.change.staged
              ? ["diff", "--cached", "--no-ext-diff", "-M", "--", ...changePaths(source.change)]
              : ["diff", "--no-ext-diff", "--", ...changePaths(source.change)];
          } else {
            args = ["diff", "--no-ext-diff", "-M", source.parent ?? EMPTY_TREE, source.sha, "--", ...changePaths(source.change)];
          }
          const r = await this.g(args);
          doc = P.parseDiff(r.stdout);
        }
      } catch (e) {
        doc = { lines: [], isBinary: false, truncated: false, error: describe(e) };
      }
      if (gen !== this.diffGen) return;
      this.diff = doc;
      this.diffLoading = false;
      this.emit();
    })();
  }

  // MARK: - 작업 실행

  /** git 명령 하나를 실행하고 저장소를 다시 읽는다. 실패하면 git 의 메시지를 그대로 보여 준다. */
  async run(label: string, args: string[], o: { network?: boolean; input?: string } = {}): Promise<boolean> {
    if (!this.path || this.busy != null) return false;
    this.busy = label;
    this.emit();
    try {
      await this.g(args, {
        input: o.input,
        timeoutMs: o.network ? 900_000 : 300_000,
        env: o.network ? await accounts.gitEnvironment(this.target, this.path) : {},
      });
      // 다 읽을 때까지 busy 로 두어 파일 감시가 같은 변경으로 또 읽지 않게 한다
      await this.reload();
      return true;
    } catch (e) {
      this.fail(e);
      await this.reload(true);
      return false;
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  private get defaultRemote() {
    return this.remotes.includes("origin") ? "origin" : this.remotes[0] ?? null;
  }

  async fetch() {
    if (await this.run("Fetch 중…", ["fetch", "--all", "--prune"], { network: true })) await this.loadPullRequests();
  }

  async pull(mode: PullMode = "standard") {
    const args = ["pull"];
    if (mode === "fastForward") args.push("--ff-only");
    if (mode === "merge") args.push("--no-rebase");
    if (mode === "rebase") args.push("--rebase");
    await this.run("Pull 중…", args, { network: true });
  }

  async push(force = false) {
    const branch = this.headBranch;
    if (!branch || !this.headHash) {
      this.errorMessage = "Push 할 브랜치가 없습니다. 분리된 HEAD 이거나 아직 커밋이 없습니다.";
      this.emit();
      return;
    }
    const args = ["push"];
    if (force) args.push("--force-with-lease");
    if (!this.status.upstream) {
      const remote = this.defaultRemote;
      if (!remote) {
        this.errorMessage = "원격 저장소가 없습니다. 터미널에서 `git remote add origin <URL>` 로 먼저 추가하세요.";
        this.emit();
        return;
      }
      args.push("-u", remote, branch);
    }
    if (await this.run("Push 중…", args, { network: true })) await this.loadPullRequests();
  }

  async pushBranch(b: Branch) {
    if (b.isCurrent) return this.push();
    const remote = b.upstream ? b.upstream.split("/")[0] : this.defaultRemote;
    if (!remote) {
      this.errorMessage = "원격 저장소가 없습니다.";
      this.emit();
      return;
    }
    await this.run("Push 중…", ["push", ...(b.upstream ? [] : ["-u"]), remote, b.name], { network: true });
  }

  /** 지금 열린 곳이 아닌 다른 워크트리가 이 브랜치를 쓰고 있으면 그 워크트리 */
  worktreeUsing(branch: string) {
    return this.worktrees.find((w) => w.branch === branch && !samePath(w.path, this.path)) ?? null;
  }

  async checkout(b: Branch) {
    if (!b.isRemote) {
      const w = this.worktreeUsing(b.name);
      if (w) {
        this.ask({
          title: `'${b.name}'은(는) 다른 워크트리에서 쓰는 중입니다`,
          message: `${w.path}\n한 브랜치는 워크트리 하나에서만 체크아웃할 수 있습니다. 그 워크트리를 열까요?`,
          actionTitle: "워크트리 열기",
          destructive: false,
          action: () => this.openOrReport(w.path),
        });
        return;
      }
    }
    if (b.isRemote) {
      const s = branchShort(b);
      if (this.localBranches.some((x) => x.name === s)) await this.run("체크아웃 중…", ["switch", s]);
      else await this.run("체크아웃 중…", ["switch", "-c", s, "--track", b.name]);
    } else if (!b.isCurrent) {
      await this.run("체크아웃 중…", ["switch", b.name]);
    }
  }

  checkoutDetached(sha: string) {
    return this.run("체크아웃 중…", ["switch", "--detach", sha]);
  }

  requestNewBranch(start?: string, label?: string) {
    const s = start ?? this.headHash ?? "HEAD";
    this.sheet = { kind: "newBranch", start: s, label: label ?? this.headBranch ?? short(s) };
    this.emit();
  }

  createBranch(name: string, start: string, checkout: boolean) {
    return this.run("브랜치 만드는 중…", checkout ? ["switch", "-c", name, start] : ["branch", name, start]);
  }

  ask(c: ConfirmRequest) {
    this.confirm = { destructive: true, ...c };
    this.emit();
  }

  confirmDelete(b: Branch) {
    if (b.isRemote) {
      const remote = branchRemote(b);
      if (!remote) return;
      this.ask({
        title: `원격 브랜치 '${b.name}'을(를) 삭제할까요?`,
        message: `${remote} 서버에서 브랜치가 삭제됩니다. 다른 사람도 쓰는 브랜치라면 주의하세요.`,
        actionTitle: "원격에서 삭제",
        action: () => this.run("원격 브랜치 삭제 중…", ["push", remote, "--delete", branchShort(b)], { network: true }),
      });
    } else {
      this.ask({
        title: `브랜치 '${b.name}'을(를) 삭제할까요?`,
        message: "머지되지 않은 커밋이 있으면 git 이 삭제를 거부합니다. 그때는 '강제 삭제'를 쓰세요.",
        actionTitle: "삭제",
        action: () => this.run("브랜치 삭제 중…", ["branch", "-d", b.name]),
      });
    }
  }

  confirmForceDelete(b: Branch) {
    this.ask({
      title: `브랜치 '${b.name}'을(를) 강제로 삭제할까요?`,
      message: "머지되지 않은 커밋도 함께 버려집니다.",
      actionTitle: "강제 삭제",
      action: () => this.run("브랜치 삭제 중…", ["branch", "-D", b.name]),
    });
  }

  merge(name: string) {
    return this.run("머지 중…", ["merge", name]);
  }
  rebase(onto: string) {
    return this.run("리베이스 중…", ["rebase", onto]);
  }
  cherryPick(sha: string) {
    return this.run("Cherry-pick 중…", ["cherry-pick", sha]);
  }
  revert(sha: string) {
    return this.run("Revert 중…", ["revert", "--no-edit", sha]);
  }

  reset(sha: string, mode: ResetMode) {
    const action = () => this.run("Reset 중…", ["reset", `--${mode}`, sha]);
    if (mode === "hard") {
      this.ask({
        title: `${short(sha)}(으)로 Hard reset 할까요?`,
        message: "커밋하지 않은 변경과 이후 커밋이 현재 브랜치에서 사라집니다.",
        actionTitle: "Hard reset",
        action,
      });
    } else void action();
  }

  createTag(name: string, message: string, sha: string) {
    return this.run("태그 만드는 중…", message.trim() ? ["tag", "-a", name, "-m", message, sha] : ["tag", name, sha]);
  }

  deleteTag(t: Tag) {
    this.ask({
      title: `태그 '${t.name}'을(를) 삭제할까요?`,
      message: "로컬 태그만 삭제됩니다.",
      actionTitle: "삭제",
      action: () => this.run("태그 삭제 중…", ["tag", "-d", t.name]),
    });
  }

  async pushTag(t: Tag) {
    const remote = this.defaultRemote;
    if (!remote) {
      this.errorMessage = "원격 저장소가 없습니다.";
      this.emit();
      return;
    }
    await this.run("태그 Push 중…", ["push", remote, "refs/tags/" + t.name], { network: true });
  }

  // 스태시

  stash(message: string, includeUntracked: boolean) {
    const args = ["stash", "push"];
    if (includeUntracked) args.push("--include-untracked");
    if (message.trim()) args.push("-m", message.trim());
    return this.run("Stash 중…", args);
  }
  stashApply(s: Stash) {
    return this.run("Stash 적용 중…", ["stash", "apply", s.ref]);
  }
  stashPop(s?: Stash) {
    return this.run("Stash Pop 중…", ["stash", "pop", ...(s ? [s.ref] : [])]);
  }
  stashDrop(s: Stash) {
    this.ask({
      title: `${s.ref}을(를) 버릴까요?`,
      message: s.message,
      actionTitle: "버리기",
      action: () => this.run("Stash 버리는 중…", ["stash", "drop", s.ref]),
    });
  }

  // 스테이지·커밋

  stage(changes: FileChange[]) {
    if (!changes.length) return Promise.resolve(false);
    return this.run("스테이지 중…", ["add", "-A", "--", ...changes.flatMap(changePaths)]);
  }

  unstage(changes: FileChange[]) {
    if (!changes.length) return Promise.resolve(false);
    const paths = changes.flatMap(changePaths);
    return this.headHash
      ? this.run("언스테이지 중…", ["restore", "--staged", "--", ...paths])
      : this.run("언스테이지 중…", ["rm", "--cached", "-r", "-q", "--", ...paths]);
  }

  stageAll() {
    return this.run("스테이지 중…", ["add", "-A"]);
  }

  unstageAll() {
    return this.headHash ? this.run("언스테이지 중…", ["reset", "-q"]) : this.run("언스테이지 중…", ["rm", "--cached", "-r", "-q", "."]);
  }

  confirmDiscard(c: FileChange) {
    this.ask({
      title: `'${fileName(c.path)}'의 변경을 버릴까요?`,
      message: c.kind === "untracked" ? "추적하지 않는 새 파일이 삭제됩니다." : "작업 트리의 수정 내용이 사라집니다.",
      actionTitle: "변경 버리기",
      action: () =>
        c.kind === "untracked"
          ? this.run("변경 버리는 중…", ["clean", "-f", "-q", "--", c.path])
          : this.run("변경 버리는 중…", ["restore", "--worktree", "--", ...changePaths(c)]),
    });
  }

  confirmDiscardAll() {
    this.ask({
      title: "모든 변경을 버릴까요?",
      message: "스테이지된 것과 안 된 것, 추적하지 않는 새 파일까지 모두 사라집니다. 되돌릴 수 없습니다.",
      actionTitle: "모두 버리기",
      action: async () => {
        if (this.headHash && !(await this.run("되돌리는 중…", ["reset", "--hard", "-q"]))) return;
        await this.run("정리 중…", ["clean", "-fd", "-q"]);
      },
    });
  }

  get canCommit() {
    return (
      this.busy == null &&
      !!this.summary.trim() &&
      (this.status.staged.length > 0 || this.amend || this.repoState === "merging") &&
      this.status.conflicted.length === 0
    );
  }

  setSummary(v: string) {
    this.summary = v;
    this.emit();
  }
  setMessage(v: string) {
    this.message = v;
    this.emit();
  }

  async setAmend(on: boolean) {
    this.amend = on;
    this.emit();
    if (!on || this.summary || this.message || !this.path || !this.headHash) return;
    try {
      const text = (await this.g(["log", "-1", "--format=%B"])).stdout.trim();
      const nl = text.indexOf("\n");
      this.summary = nl < 0 ? text : text.slice(0, nl);
      this.message = nl < 0 ? "" : text.slice(nl + 1).trim();
      this.emit();
    } catch {
      /* 무시 */
    }
  }

  async commit() {
    if (!this.canCommit) return;
    const text = [this.summary.trim(), this.message.trim()].filter(Boolean).join("\n\n");
    const args = ["commit", "-F", "-"];
    if (this.amend) args.push("--amend");
    if (await this.run("커밋 중…", args, { input: text + "\n" })) {
      this.summary = "";
      this.message = "";
      this.amend = false;
      this.mergeMessageFilled = false;
      this.emit();
    }
  }

  // 진행 중인 머지·리베이스

  abortOperation() {
    const args: Record<RepoState, string[] | null> = {
      merging: ["merge", "--abort"],
      rebasing: ["rebase", "--abort"],
      cherryPicking: ["cherry-pick", "--abort"],
      reverting: ["revert", "--abort"],
      clean: null,
    };
    const a = args[this.repoState];
    if (!a) return;
    this.ask({
      title: `${this.repoStateTitle}을(를) 중단할까요?`,
      message: "작업을 시작하기 전 상태로 돌아갑니다.",
      actionTitle: "중단",
      action: async () => {
        await this.run("중단하는 중…", a);
        this.summary = "";
        this.message = "";
        this.emit();
      },
    });
  }

  get repoStateTitle() {
    return { clean: "", merging: "머지 진행 중", rebasing: "리베이스 진행 중", cherryPicking: "Cherry-pick 진행 중", reverting: "Revert 진행 중" }[this.repoState];
  }

  async continueOperation() {
    switch (this.repoState) {
      case "rebasing":
        await this.run("리베이스 계속…", ["rebase", "--continue"]);
        break;
      case "cherryPicking":
        await this.run("Cherry-pick 계속…", ["cherry-pick", "--continue"]);
        break;
      case "reverting":
        await this.run("Revert 계속…", ["revert", "--continue"]);
        break;
      case "merging":
        await this.commit();
        break;
    }
  }

  // MARK: - 기타

  revealFile(c: FileChange) {
    if (this.path) void ipc.reveal(joinPath(this.path, c.path)).catch((e) => this.fail(e));
  }

  copy(text: string) {
    void navigator.clipboard.writeText(text);
  }

  openUrl(url: string) {
    void ipc.openUrl(url).catch((e) => this.fail(e));
  }

  // MARK: - 검색

  get isSearching() {
    return !!this.searchText.trim();
  }

  get searchPosition(): number | null {
    const id = this.selectedID;
    const i = id ? this.searchMatches.indexOf(id) : -1;
    return i < 0 ? null : i + 1;
  }

  requestSearchFocus() {
    this.searchFocusRequest++;
    this.emit();
  }

  setSearch(text: string, scope?: SearchScope) {
    this.searchText = text;
    if (scope) this.searchScope = scope;
    this.updateSearch();
  }

  updateSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const gen = ++this.searchGen;
    const q = this.searchText.trim();
    const path = this.path;
    if (!q || !path) {
      this.clearSearchResults();
      return;
    }
    const scope = this.searchScope;
    if (scope === "commits") {
      // 1) 불러온 커밋에서 즉시: 제목·작성자·이메일·SHA·브랜치/태그 이름
      const lower = q.toLowerCase();
      const found = new Set<string>();
      for (const e of this.entries) {
        const c = e.commit;
        if (isWIP(c)) continue;
        if (
          c.subject.toLowerCase().includes(lower) ||
          c.author.toLowerCase().includes(lower) ||
          c.email.toLowerCase().includes(lower) ||
          c.id.startsWith(lower) ||
          (this.refsByCommit.get(c.id) ?? []).some((r) => r.name.toLowerCase().includes(lower))
        )
          found.add(c.id);
      }
      this.applySearch(found, true);
    } else {
      this.searchMatches = [];
      this.searchMatchSet = new Set();
    }
    // 2) git 으로 더 깊게(메시지 본문, 파일 경로, 코드 변경) — 입력이 멈추면 실행
    this.searching = true;
    this.emit();
    this.searchTimer = setTimeout(async () => {
      const args = ["log", "--exclude=refs/stash", "--all", "--format=%H"];
      if (scope === "commits") args.push("-n", "20000", "-i", "-F", "--grep=" + q);
      else if (scope === "files") args.push("-n", "20000", "--", `:(glob,icase)**/*${q}*`);
      else args.push("-n", "1000", "-G", q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      let out = "";
      try {
        out = (await git(args, path, { timeoutMs: 180_000 })).stdout;
      } catch {
        out = "";
      }
      if (gen !== this.searchGen) return;
      this.searching = false;
      const found = new Set(out.split(/\r?\n/).filter(Boolean));
      if (scope === "commits") for (const id of this.searchMatchSet) found.add(id);
      this.applySearch(found, scope !== "commits" || !this.searchMatches.length);
      this.emit();
    }, scope === "commits" ? 350 : 500);
  }

  private applySearch(found: Set<string>, jump: boolean) {
    const ordered = this.entries.filter((e) => found.has(e.commit.id)).map((e) => e.commit.id);
    this.searchMatches = ordered;
    this.searchMatchSet = new Set(ordered);
    let unloaded = 0;
    for (const id of found) if (!this.searchMatchSet.has(id)) unloaded++;
    this.searchUnloaded = unloaded;
    // 지금 고른 커밋이 결과가 아니면 첫 결과로 이동
    if (jump && ordered.length && !this.searchMatchSet.has(this.selectedID ?? "")) {
      this.select({ kind: "commit", sha: ordered[0] });
      this.scrollTarget = ordered[0];
    }
    this.emit();
  }

  clearSearchResults() {
    this.searchMatches = [];
    this.searchMatchSet = new Set();
    this.searchUnloaded = 0;
    this.searching = false;
    this.emit();
  }

  clearSearch() {
    this.searchGen++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchText = "";
    this.clearSearchResults();
  }

  nextMatch() {
    this.stepMatch(1);
  }
  previousMatch() {
    this.stepMatch(-1);
  }

  private stepMatch(d: number) {
    const m = this.searchMatches;
    if (!m.length) return;
    let cur = m.indexOf(this.selectedID ?? "");
    if (cur < 0) cur = d > 0 ? -1 : 0;
    const sha = m[(cur + d + m.length) % m.length];
    this.select({ kind: "commit", sha });
    this.scrollTarget = sha;
    this.emit();
  }

  /** 아직 그래프에 없는 결과가 있으면 기록을 더 불러와 다시 찾는다 */
  async loadMoreForSearch() {
    await this.loadMore();
    this.updateSearch();
  }

  // MARK: - 그래프 끌어다 놓기 (머지·리베이스·빨리 감기·cherry-pick)

  branchNamed(name: string) {
    return this.localBranches.find((b) => b.name === name) ?? this.remoteBranches.find((b) => b.name === name) ?? null;
  }

  private fullRef(name: string) {
    const b = this.branchNamed(name);
    if (b) return b.isRemote ? `refs/remotes/${b.name}` : `refs/heads/${b.name}`;
    return name;
  }

  async isAncestor(a: string, b: string) {
    if (!this.path) return false;
    try {
      return (await gitRaw(["merge-base", "--is-ancestor", a, b], this.path)).status === 0;
    } catch {
      return false;
    }
  }

  /** 커밋 줄에 무언가를 놓았을 때. 그 줄의 브랜치(현재 브랜치 우선, 없으면 로컬, 원격 순)를 대상으로 삼는다. */
  handleDrop(payload: string, entry: GraphEntry) {
    if (isWIP(entry.commit) || this.busy != null) return;
    const refs = this.refsByCommit.get(entry.commit.id) ?? [];
    const target =
      refs.find((r) => r.kind === "local" && r.isCurrent)?.name ??
      refs.find((r) => r.kind === "local")?.name ??
      refs.find((r) => r.kind === "remote")?.name ??
      null;
    if (payload.startsWith(branchPayload)) {
      const source = payload.slice(branchPayload.length);
      if (target) {
        if (target !== source) void this.offerBranchDrop(source, target);
      } else this.offerBranchOnCommit(source, entry.commit.id);
    } else if (payload.startsWith(commitPayload)) {
      const sha = payload.slice(commitPayload.length);
      if (sha !== entry.commit.id) this.offerCommitDrop(sha, target);
    }
  }

  private setDrop(r: DropRequest) {
    this.dropRequest = r;
    this.emit();
  }

  private async offerBranchDrop(source: string, target: string) {
    const current = this.headBranch;
    const sourceRef = this.fullRef(source),
      targetRef = this.fullRef(target);
    const targetIsLocal = this.localBranches.some((b) => b.name === target);
    const sourceIsLocal = this.localBranches.some((b) => b.name === source);
    if (await this.isAncestor(sourceRef, targetRef)) {
      this.setDrop({ title: `'${source}'은(는) 이미 '${target}'에 들어 있습니다`, message: "머지할 새 커밋이 없습니다.", choices: [] });
      return;
    }
    const choices: DropChoice[] = [];
    // 대상이 원본의 조상이면 머지 커밋 없이 앞으로 옮기기만 하면 된다
    if (targetIsLocal && (await this.isAncestor(targetRef, sourceRef))) {
      if (target === current) {
        choices.push({ title: `'${target}'(현재)을(를) '${source}'까지 빨리 감기 (fast-forward)`, action: () => this.run("빨리 감는 중…", ["merge", "--ff-only", source]) });
      } else {
        choices.push({
          title: `'${target}'을(를) '${source}'까지 빨리 감기 (fast-forward)`,
          action: () => this.run("빨리 감는 중…", ["fetch", ".", `${sourceRef}:refs/heads/${target}`]),
        });
      }
    }
    if (target === current) {
      choices.push({ title: `'${source}'을(를) '${target}'(현재)에 머지`, action: () => this.merge(source) });
      choices.push({ title: `'${target}'(현재)을(를) '${source}' 위로 리베이스`, action: () => this.rebase(source) });
    } else if (source === current) {
      choices.push({ title: `'${source}'(현재)을(를) '${target}' 위로 리베이스`, action: () => this.rebase(target) });
      choices.push({ title: `'${target}'을(를) '${source}'(현재)에 머지`, action: () => this.merge(target) });
    } else {
      if (targetIsLocal)
        choices.push({
          title: `'${target}' 체크아웃 후 '${source}' 머지`,
          action: async () => {
            if (await this.run("체크아웃 중…", ["switch", target])) await this.merge(source);
          },
        });
      if (sourceIsLocal)
        choices.push({
          title: `'${source}' 체크아웃 후 '${target}' 위로 리베이스`,
          action: async () => {
            if (await this.run("체크아웃 중…", ["switch", source])) await this.rebase(target);
          },
        });
    }
    this.setDrop({
      title: `'${source}'  →  '${target}'`,
      message: choices.length ? "무엇을 할까요? 충돌이 나면 오른쪽에서 해결할 수 있습니다." : "여기에서 할 수 있는 작업이 없습니다.",
      choices,
    });
  }

  private offerBranchOnCommit(source: string, sha: string) {
    const s = short(sha);
    const choices: DropChoice[] = [];
    if (source === this.headBranch) {
      choices.push({ title: `이 커밋(${s})을 '${source}'(현재)에 머지`, action: () => this.merge(sha) });
      choices.push({ title: `'${source}'(현재)을(를) 이 커밋(${s}) 위로 리베이스`, action: () => this.rebase(sha) });
    } else if (this.localBranches.some((b) => b.name === source)) {
      choices.push({
        title: `'${source}' 체크아웃 후 이 커밋(${s}) 위로 리베이스`,
        action: async () => {
          if (await this.run("체크아웃 중…", ["switch", source])) await this.rebase(sha);
        },
      });
    }
    this.setDrop({ title: `'${source}'  →  커밋 ${s}`, message: choices.length ? "무엇을 할까요?" : "여기에서 할 수 있는 작업이 없습니다.", choices });
  }

  private offerCommitDrop(sha: string, target: string | null) {
    if (!target) return;
    const s = short(sha);
    const choices: DropChoice[] = [];
    if (target === this.headBranch) {
      choices.push({ title: `커밋 ${s}을(를) '${target}'(현재)에 cherry-pick`, action: () => this.cherryPick(sha) });
    } else if (this.localBranches.some((b) => b.name === target)) {
      choices.push({
        title: `'${target}' 체크아웃 후 커밋 ${s} cherry-pick`,
        action: async () => {
          if (await this.run("체크아웃 중…", ["switch", target])) await this.cherryPick(sha);
        },
      });
    }
    this.setDrop({
      title: `커밋 ${s}  →  '${target}'`,
      message: choices.length ? "무엇을 할까요?" : "원격 브랜치에는 바로 cherry-pick 할 수 없습니다.",
      choices,
    });
  }

  // MARK: - 워크트리

  /** 기본 위치: <저장소 상위>/<저장소 이름>-worktrees/<브랜치> */
  defaultWorktreePath(branch: string) {
    if (!this.path) return "";
    return joinPath(dirname(this.path), `${basename(this.path)}-worktrees`, branch.replace(/\//g, "-"));
  }

  async addWorktree(path: string, branch: string, createNew: boolean, start: string | null, launchClaude: boolean, task: string) {
    const args = ["worktree", "add"];
    if (createNew) args.push("-b", branch, path, ...(start ? [start] : []));
    else args.push(path, branch);
    if (!(await this.run("워크트리 만드는 중…", args))) return false;
    if (launchClaude) await this.startAgent(path, task);
    return true;
  }

  confirmRemove(w: Worktree, force = false) {
    this.ask({
      title: `워크트리 '${basename(w.path)}'을(를) 제거할까요?`,
      message: force
        ? `${w.path}\n커밋하지 않은 변경도 함께 지워집니다.`
        : `${w.path}\n폴더가 지워지고, 브랜치와 커밋은 그대로 남습니다. 커밋하지 않은 변경이 있으면 git 이 거부합니다.`,
      actionTitle: force ? "강제 제거" : "제거",
      action: () => this.run("워크트리 제거 중…", ["worktree", "remove", ...(force ? ["--force"] : []), w.path]),
    });
  }

  pruneWorktrees() {
    return this.run("워크트리 정리 중…", ["worktree", "prune"]);
  }

  /** 코딩 에이전트(Claude Code·Codex·Gemini CLI)를 아래 터미널 탭에서 시작 */
  async startAgent(path: string, task = "", mode: string | null = null, kind: AgentKind = agents.defaultKind) {
    try {
      await agents.start(this, kind, path, task, mode);
    } catch (e) {
      this.fail(e);
    }
  }

  /** 워크트리마다 변경 파일 수와 원격 대비 ↑↓ (에이전트 패널 카드) */
  async refreshWorktreeStats() {
    const list = this.worktrees.filter((w) => !w.prunable);
    const result: Record<string, WorktreeStats> = {};
    await Promise.all(
      list.map(async (w) => {
        try {
          const r = await git(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=normal"], w.path);
          result[w.path] = worktreeStats(P.parseStatus(r.stdout));
        } catch {
          /* 폴더가 사라짐 */
        }
      }),
    );
    if (JSON.stringify(result) !== JSON.stringify(this.worktreeStats)) {
      this.worktreeStats = result;
      this.emit();
    }
  }

  // MARK: - GitHub / GitLab

  /** 이 저장소의 PR·MR 에 쓰는 계정(같은 서버에 여럿이면 저장소마다 고른 것) */
  get hostingAccount(): HostAccount | null {
    return this.target ? accounts.accountFor(this.target, this.path) : null;
  }

  /** 사용자가 눌렀을 때: 이미 연결한 계정이 이 저장소 서버에도 통하는지 직접 확인 */
  async tryExistingAccounts() {
    const t = this.target;
    if (!t) return;
    if (!(await accounts.discoverAlias(t, false))) {
      this.errorMessage = `연결된 ${providerInfo[t.provider].title} 계정으로는 ${t.host} 에 접속되지 않습니다. 이 서버의 토큰으로 계정을 추가해 주세요.`;
      this.emit();
    } else await this.loadPullRequests();
  }

  useAccount(a: HostAccount) {
    if (this.path) accounts.setPreferred(a, this.path);
  }

  async loadPullRequests() {
    const t = this.target;
    if (!t) {
      this.pullRequests = [];
      this.prState = { kind: "idle" };
      this.emit();
      return;
    }
    // 연결된 계정 서버의 다른 주소(같은 IP)면 그 계정으로 확인해 이어 쓴다
    if (!this.hostingAccount && accounts.accountsFor(t.provider).length) await accounts.discoverAlias(t, true);
    const acct = this.hostingAccount;
    const token = acct ? await accounts.token(acct) : null;
    if (!acct || !token) {
      // 사내 GitLab 이면 설정 화면에 그 서버 주소를 미리 채워 둔다
      if (t.provider === "gitlab") accounts.suggestedGitLabServer = `https://${t.host}`;
      this.pullRequests = [];
      this.prState = { kind: "needsAccount" };
      this.emit();
      return;
    }
    this.prState = { kind: "loading" };
    this.emit();
    try {
      const list = await Hosting.pullRequests(t, token, accountApiBaseOf(acct));
      if (!sameTarget(this.target, t)) return;
      this.pullRequests = list;
      this.prState = { kind: "loaded" };
    } catch (e) {
      if (!sameTarget(this.target, t)) return;
      this.prState = { kind: "failed", message: describe(e) };
    }
    this.emit();
  }

  /** PR 브랜치 체크아웃: 같은 저장소 브랜치면 추적 브랜치로, 포크면 pr/번호 로컬 브랜치로 가져온다 */
  async checkoutPullRequest(pr: PullRequest) {
    const t = this.target;
    if (!t) return;
    const remoteName = `${t.remote}/${pr.source}`;
    if (!pr.fromFork) {
      if (!this.remoteBranches.some((b) => b.name === remoteName)) {
        if (!(await this.run("가져오는 중…", ["fetch", t.remote, pr.source], { network: true }))) return;
      }
      const b = this.remoteBranches.find((x) => x.name === remoteName);
      if (b) {
        await this.checkout(b);
        return;
      }
    }
    const ref = t.provider === "github" ? `refs/pull/${pr.number}/head` : `refs/merge-requests/${pr.number}/head`;
    const local = `${providerInfo[t.provider].requestShort.toLowerCase()}/${pr.number}`;
    if (this.headBranch === local) await this.run("가져오는 중…", ["pull", "--ff-only", t.remote, ref], { network: true });
    else if (await this.run("가져오는 중…", ["fetch", t.remote, `+${ref}:refs/heads/${local}`], { network: true }))
      await this.run("체크아웃 중…", ["switch", local]);
  }

  /** PR 대상 브랜치 후보: 원격 브랜치 이름(원격 접두사 제외) */
  pullRequestBaseCandidates() {
    const t = this.target;
    if (!t) return [];
    return this.remoteBranches.filter((b) => branchRemote(b) === t.remote && branchShort(b) !== this.headBranch).map(branchShort);
  }

  async defaultBaseBranch() {
    const candidates = this.pullRequestBaseCandidates();
    const t = this.target,
      acct = this.hostingAccount;
    if (t && acct) {
      const token = await accounts.token(acct);
      if (token) {
        try {
          const b = await Hosting.defaultBranch(t, token, accountApiBaseOf(acct));
          if (b && candidates.includes(b)) return b;
        } catch {
          /* 아래 */
        }
      }
    }
    return ["main", "master", "develop"].find((b) => candidates.includes(b)) ?? candidates[0] ?? null;
  }

  async createPullRequest(title: string, body: string, base: string, draft: boolean) {
    const t = this.target,
      branch = this.headBranch;
    if (!t || !branch) return;
    const acct = this.hostingAccount;
    const token = acct ? await accounts.token(acct) : null;
    if (!acct || !token) {
      this.errorMessage = `${providerInfo[t.provider].title}(${t.host}) 계정을 먼저 연결하세요(설정 > 계정).`;
      this.emit();
      return;
    }
    // 원격에 브랜치가 없거나 올리지 않은 커밋이 있으면 먼저 push
    if (!this.status.upstream) {
      if (!(await this.run("Push 중…", ["push", "-u", t.remote, branch], { network: true }))) return;
    } else if (this.status.ahead > 0) {
      if (!(await this.run("Push 중…", ["push"], { network: true }))) return;
    }
    this.busy = `${providerInfo[t.provider].requestShort} 만드는 중…`;
    this.emit();
    try {
      const pr = await Hosting.createPullRequest(t, token, accountApiBaseOf(acct), { title, body, source: branch, target: base, draft });
      this.busy = null;
      await this.loadPullRequests();
      this.select({ kind: "pullRequest", number: pr.number });
      this.openUrl(pr.url);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  // MARK: - Claude

  async generateCommitMessage() {
    if (!this.path || this.aiWorking) return;
    this.aiWorking = `${ai.short} 가 커밋 메시지를 쓰는 중…`;
    this.aiNotice = null;
    this.emit();
    try {
      const diff = (await this.g(["diff", "--cached", "--no-ext-diff", "-M", "--stat", "--patch"])).stdout;
      if (!diff.trim()) {
        this.errorMessage = "스테이지된 변경이 없습니다. 먼저 파일을 스테이지하세요.";
        return;
      }
      let recent = "";
      try {
        recent = (await this.g(["log", "-15", "--format=%s"])).stdout.trim();
      } catch {
        /* 첫 커밋 */
      }
      const clipped = clip(diff);
      const prompt = `Branch: ${this.headBranch ?? "(detached HEAD)"}\n\nRecent commit messages (style reference):\n${recent || "(none)"}\n\nStaged changes:\n${clipped.text}`;
      const text = await ai.complete(Prompts.commit, prompt, "low");
      const [s, b] = splitMessage(text);
      this.summary = s;
      this.message = b;
      if (clipped.omitted > 0) this.aiNotice = `변경이 길어 앞부분만 ${ai.short} 에 보냈습니다(${Math.floor(clipped.omitted / 1000)}K자 생략).`;
    } catch (e) {
      this.errorMessage = describe(e);
    } finally {
      this.aiWorking = null;
      this.emit();
    }
  }

  async explainCommit(sha: string) {
    if (!this.path || this.explaining.has(sha)) return;
    this.explaining.add(sha);
    this.emit();
    try {
      const show = (
        await this.g(["show", "--stat", "--patch", "--diff-merges=first-parent", "--no-ext-diff", "--format=commit %H%nAuthor: %an%nDate: %ad%n%n%B", sha])
      ).stdout;
      const clipped = clip(show);
      let text = await ai.complete(Prompts.explain, clipped.text, "medium");
      if (clipped.omitted > 0) text += "\n\n(변경이 길어 앞부분만 보고 설명했습니다.)";
      this.explanations = { ...this.explanations, [sha]: text };
    } catch (e) {
      this.errorMessage = describe(e);
    } finally {
      this.explaining.delete(sha);
      this.emit();
    }
  }

  /** PR 제목·본문 초안: base 이후 커밋들과 diff 로 작성 */
  async draftPullRequest(base: string): Promise<[string, string] | null> {
    const t = this.target;
    if (!this.path || !t) return null;
    const baseRef = this.remoteBranches.some((b) => b.name === `${t.remote}/${base}`) ? `${t.remote}/${base}` : base;
    try {
      const log = (await this.g(["log", "--format=- %s%n%b", `${baseRef}..HEAD`])).stdout;
      const diff = (await this.g(["diff", "--no-ext-diff", "--stat", "--patch", `${baseRef}...HEAD`])).stdout;
      if (!log.trim() && !diff.trim()) {
        this.errorMessage = `'${base}' 와 비교해 새 커밋이 없습니다.`;
        this.emit();
        return null;
      }
      const clipped = clip(diff);
      const prompt = `Branch ${this.headBranch ?? ""} into ${base}.\n\nCommits:\n${log.trim()}\n\nDiff:\n${clipped.text}`;
      return splitMessage(await ai.complete(Prompts.pullRequest, prompt, "low"));
    } catch (e) {
      this.fail(e);
      return null;
    }
  }

  // MARK: - 터미널 패널

  get activeTerminal(): TerminalSession | null {
    return this.terminals.find((t) => t.id === this.activeTerminalID) ?? this.terminals[this.terminals.length - 1] ?? null;
  }

  /** Ctrl+` : 터미널 패널 보이기/숨기기(처음이면 저장소 폴더에서 셸을 하나 연다) */
  toggleTerminal() {
    if (this.showTerminal) this.showTerminal = false;
    else if (!this.terminals.length) this.newTerminal();
    else this.showTerminal = true;
    this.emit();
  }

  newTerminal(path?: string, spec: Partial<TerminalSpec> = {}): TerminalSession {
    const dir = path ?? this.path ?? "";
    const s = new TerminalSession({ ...spec, directory: dir });
    s.subscribe(() => this.emit());
    this.terminals = [...this.terminals, s];
    this.activeTerminalID = s.id;
    this.showTerminal = true;
    this.emit();
    return s;
  }

  selectTerminal(s: TerminalSession) {
    this.activeTerminalID = s.id;
    s.unseenOutput = false;
    this.emit();
  }

  focusTerminal(s: TerminalSession) {
    this.activateTab?.();
    this.showTerminal = true;
    this.selectTerminal(s);
    setTimeout(() => s.focus(), 50);
  }

  closeTerminal(s: TerminalSession) {
    s.dispose();
    this.terminals = this.terminals.filter((t) => t !== s);
    if (this.activeTerminalID === s.id) this.activeTerminalID = this.terminals[this.terminals.length - 1]?.id ?? null;
    if (!this.terminals.length) this.showTerminal = false;
    this.emit();
  }

  closeAllTerminals() {
    for (const t of this.terminals) t.dispose();
    this.terminals = [];
    this.activeTerminalID = null;
    this.showTerminal = false;
  }

  // 요약 문자열

  get subtitle() {
    if (!this.headBranch) return this.headHash ? `분리된 HEAD · ${short(this.headHash)}` : "";
    let s = this.headBranch;
    if (this.status.upstream) {
      s += `  →  ${this.status.upstream}`;
      if (this.status.ahead) s += `  ↑${this.status.ahead}`;
      if (this.status.behind) s += `  ↓${this.status.behind}`;
    }
    if (this.repoState !== "clean") s += `  ·  ${this.repoStateTitle}`;
    return s;
  }

  get wipCount() {
    return statusCount(this.status);
  }
}

function accountApiBaseOf(a: HostAccount) {
  return a.provider === "github" ? "https://api.github.com" : a.server + "/api/v4";
}

