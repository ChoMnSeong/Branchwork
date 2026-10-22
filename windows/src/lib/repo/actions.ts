import { accounts } from "../accounts";
import { samePath } from "../env";
import {
  branchRemote,
  branchShort,
  changePaths,
  fileName,
  short,
  type Branch,
  type ConfirmRequest,
  type FileChange,
  type PullMode,
  type RepoState,
  type ResetMode,
  type Stash,
  type Tag,
} from "../models";

import { RepoSearch } from "./search";
import type { RefSnapshot } from "./undo-model";

/** git 작업: 실행·Fetch·Pull·Push·브랜치·태그·스태시·스테이지·커밋·진행 중인 머지/리베이스 */
export abstract class RepoActions extends RepoSearch {
  // 되돌리기(repo/undo.ts)
  protected abstract refSnapshot(): Promise<RefSnapshot | null>;
  protected abstract recordUndo(args: string[], input: string | undefined, before: RefSnapshot, after: RefSnapshot): void;

  /**
   * git 명령 하나를 실행하고 저장소를 다시 읽는다. 실패하면 git 의 메시지를 그대로 보여 준다.
   * 전후로 브랜치·태그·HEAD 를 기록해 두어 '되돌리기'로 되돌릴 수 있게 한다(머지·리베이스가 진행 중일 때는 빼고).
   */
  async run(label: string, args: string[], o: { network?: boolean; input?: string } = {}): Promise<boolean> {
    if (!this.path || this.busy != null) return false;
    this.busy = label;
    this.emit();
    const before = this.repoState === "clean" ? await this.refSnapshot() : null;
    try {
      await this.g(args, {
        input: o.input,
        timeoutMs: o.network ? 900_000 : 300_000,
        env: o.network ? await accounts.gitEnvironment(this.target, this.path) : {},
      });
      const after = before ? await this.refSnapshot() : null;
      if (before && after) this.recordUndo(args, o.input, before, after);
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

  protected get defaultRemote() {
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
}
