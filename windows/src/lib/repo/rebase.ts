import { joinPath, slash } from "../env";
import { describe, gitRaw } from "../git";
import { ipc } from "../ipc";
import { repoStateTitle } from "../models";
import { makePlan, planProblem, rebaseItem, rebaseTodo, shellQuote, type RebaseItem, type RebasePlan } from "../rebase";
import { RepoDrop } from "./drop";
import { t } from "../i18n";

/** 인터랙티브 리베이스(커밋 정리): 현재 브랜치의 커밋을 합치기·순서 바꾸기·메시지 고치기·빼기 (맥 버전 RepoStore+Rebase.swift) */
export abstract class RepoRebase extends RepoDrop {
  /** 이 커밋부터 HEAD 까지를 정리하는 창을 연다 */
  async startInteractiveRebase(sha: string) {
    const branch = this.headBranch;
    if (!this.path || !branch) return;
    const fail = (m: string) => {
      this.errorMessage = m;
      this.emit();
    };
    if (this.repoState !== "clean") return fail(t("You can't clean up commits right now ({0}).", repoStateTitle[this.repoState]));
    if (!(await this.isAncestor(sha, "HEAD"))) return fail(t("You can only clean up commits that are on the current branch '{0}'.", branch));
    const parent = await gitRaw(["rev-parse", "--verify", "-q", `${sha}^`], this.path);
    const base = parent.status === 0 ? parent.stdout.trim() : null;
    const r = await gitRaw(["log", "--format=%H%x1f%P%x1f%an%x1f%B%x1e", base ? `${base}..HEAD` : "HEAD"], this.path);
    if (r.status !== 0) return fail(t("Couldn't read the commit list."));
    const items: RebaseItem[] = [];
    for (const rec of r.stdout.split("\x1e")) {
      const f = rec.replace(/^[\r\n]+|[\r\n]+$/g, "").split("\x1f");
      if (f.length < 4) continue;
      if (f[1].split(" ").filter(Boolean).length > 1) return fail(t("There's a merge commit in the range. Pick a commit above the merge commit."));
      items.push(rebaseItem(f[0], f.slice(3).join("\x1f").replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, ""), f[2]));
    }
    if (!items.length) return;
    // 가장 오래된 커밋이 이미 올라간 브랜치에 있으면, 정리한 뒤 강제 푸시가 필요하다
    const up = this.status.upstream;
    const pushed = !!up && (await this.isAncestor(items[items.length - 1].sha, up));
    this.rebasePlan = makePlan(base, items, pushed);
    this.sheet = { kind: "interactiveRebase" };
    this.emit();
  }

  /** 계획대로 git rebase -i 를 돌린다(할 일 목록은 미리 만들어 편집기 대신 복사해 넣는다) */
  async runInteractiveRebase(plan: RebasePlan) {
    if (!this.gitDir || planProblem(plan)) return;
    const dir = joinPath(this.gitDir, "branchwork-rebase");
    const file = (name: string) => slash(joinPath(dir, name));
    try {
      await ipc.remove(dir);
      for (const i of plan.items) if (i.action === "reword") await ipc.writeText(file(`msg-${i.sha}`), i.newMessage);
      await ipc.writeText(file("todo"), rebaseTodo(plan, (sha) => file(`msg-${sha}`)));
    } catch (e) {
      this.errorMessage = t("Couldn't write the cleanup plan.\n\n") + describe(e);
      this.emit();
      return;
    }
    const ok = await this.run(t("Cleaning up commits…"), ["-c", `sequence.editor=cp ${shellQuote(file("todo"))}`, "rebase", "-i", "--autostash", plan.base ?? "--root"]);
    this.rebasePlan = null;
    // 충돌로 멈추면 남은 메시지 고치기에 파일이 필요하다
    if (ok && this.repoState === "clean") await ipc.remove(dir);
  }
}
