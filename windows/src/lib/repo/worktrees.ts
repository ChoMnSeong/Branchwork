import { agents, type AgentKind } from "../agents";
import { basename, dirname, joinPath } from "../env";
import { git } from "../git";
import { worktreeStats, type Worktree, type WorktreeStats } from "../models";
import * as P from "../parsers";
import { RepoRebase } from "./rebase";
import { t } from "../i18n";

/** 워크트리·에이전트 세션 */
export abstract class RepoWorktrees extends RepoRebase {
  /** 기본 위치: <저장소 상위>/<저장소 이름>-worktrees/<브랜치> */
  defaultWorktreePath(branch: string) {
    if (!this.path) return "";
    return joinPath(dirname(this.path), `${basename(this.path)}-worktrees`, branch.replace(/\//g, "-"));
  }

  async addWorktree(path: string, branch: string, createNew: boolean, start: string | null, launchClaude: boolean, task: string) {
    const args = ["worktree", "add"];
    if (createNew) args.push("-b", branch, path, ...(start ? [start] : []));
    else args.push(path, branch);
    if (!(await this.run(t("Creating worktree…"), args))) return false;
    if (launchClaude) await this.startAgent(path, task);
    return true;
  }

  confirmRemove(w: Worktree, force = false) {
    this.ask({
      title: t("Remove worktree '{0}'?", basename(w.path)),
      message: force
        ? t("{0}\nUncommitted changes are deleted too.", w.path)
        : t("{0}\nThe folder is deleted; the branch and commits stay. git refuses if there are uncommitted changes.", w.path),
      actionTitle: force ? t("Force remove") : t("Remove"),
      action: () => this.run(t("Removing worktree…"), ["worktree", "remove", ...(force ? ["--force"] : []), w.path]),
    });
  }

  pruneWorktrees() {
    return this.run(t("Pruning worktrees…"), ["worktree", "prune"]);
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
}
