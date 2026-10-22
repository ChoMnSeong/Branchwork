import { agents, type AgentKind } from "../agents";
import { basename, dirname, joinPath } from "../env";
import { git } from "../git";
import { worktreeStats, type Worktree, type WorktreeStats } from "../models";
import * as P from "../parsers";
import { RepoDrop } from "./drop";

/** 워크트리·에이전트 세션 */
export abstract class RepoWorktrees extends RepoDrop {
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
}
