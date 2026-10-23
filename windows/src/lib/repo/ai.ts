import { ai, clip, Prompts, splitMessage } from "../ai";
import { joinPath } from "../env";
import { describe } from "../git";
import { ipc } from "../ipc";
import type { FileChange } from "../models";
import { parseSplitPlan, type SplitGroup } from "../split";
import { RepoHosting } from "./hosting";
import { t } from "../i18n";

/** AI: 커밋 메시지·설명·PR 글, 나눠서 커밋 */
export abstract class RepoAI extends RepoHosting {
  // MARK: 나눠서 커밋 — AI 가 변경 파일을 주요 내용별로 묶고, 확인한 뒤 차례로 커밋한다

  /** 나눌 수 있는 변경(충돌 파일 제외, 스테이지 여부 상관없이) */
  get splittableChanges(): FileChange[] {
    const seen = new Set<string>();
    const out: FileChange[] = [];
    for (const c of [...this.status.staged, ...this.status.unstaged]) {
      if (seen.has(c.path)) continue;
      seen.add(c.path);
      out.push(c);
    }
    return out;
  }

  async planSplit() {
    if (!this.path || this.aiWorking) return;
    const changes = this.splittableChanges;
    if (changes.length < 2) {
      this.errorMessage = t("Splitting needs changes in at least two files.");
      this.emit();
      return;
    }
    if (this.status.conflicted.length) {
      this.errorMessage = t("Resolve the conflicts first.");
      this.emit();
      return;
    }
    this.aiWorking = t("{0} is splitting the changes by topic…", ai.shortFor("commit"));
    this.aiNotice = null;
    this.emit();
    try {
      // 스테이지 여부와 상관없이 HEAD 와 비교한 변경 + 새 파일 내용
      const tracked = this.headHash
        ? (await this.g(["diff", "HEAD", "--no-ext-diff", "-M", "--stat", "--patch"])).stdout
        : (await this.g(["diff", "--cached", "--no-ext-diff", "--stat", "--patch"])).stdout;
      const untracked = changes.filter((c) => c.kind === "untracked").slice(0, 40);
      let newFiles = "";
      for (const c of untracked) {
        const head = await ipc.readHead(joinPath(this.path, c.path), 6000).catch(() => null);
        newFiles += `\n=== ${c.path} (new file) ===\n${head ? (head.binary ? "(binary)" : head.text) : "(unreadable)"}\n`;
      }
      let recent = "";
      try {
        recent = (await this.g(["log", "-15", "--format=%s"])).stdout.trim();
      } catch {
        /* 첫 커밋 */
      }
      const list = changes.map((c) => `- ${c.path}${c.oldPath ? ` (renamed from ${c.oldPath})` : ""} [${c.kind}]`).join("\n");
      const clipped = clip(tracked + newFiles, 300_000);
      const prompt = `Branch: ${this.headBranch ?? "(detached HEAD)"}\n\nRecent commit messages (style reference):\n${recent || "(none)"}\n\nChanged files (use these exact paths):\n${list}\n\nChanges:\n${clipped.text}`;
      const text = await ai.write("commit", Prompts.split, prompt, "medium");
      this.splitPlan = parseSplitPlan(text, changes);
      if (clipped.omitted > 0) this.aiNotice = t("The diff was long, so only the beginning was used for splitting ({0}K characters omitted).", Math.floor(clipped.omitted / 1000));
      this.sheet = { kind: "splitCommits" };
    } catch (e) {
      this.errorMessage = describe(e);
    } finally {
      this.aiWorking = null;
      this.emit();
    }
  }

  /** 확인한 계획대로: 인덱스를 비우고 묶음마다 스테이지 → 커밋 */
  async applySplit(groups: SplitGroup[]) {
    const plan = groups.filter((g) => g.files.length && g.message.trim());
    if (!this.path || !plan.length || this.busy != null) return false;
    const byPath = new Map(this.splittableChanges.map((c) => [c.path, c]));
    this.busy = t("Splitting commits…");
    this.emit();
    let done = 0;
    try {
      if (this.headHash) await this.g(["reset", "-q"]);
      else await this.g(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "."]);
      for (const g of plan) {
        this.busy = t("Creating commit {0}/{1}…", done + 1, plan.length);
        this.emit();
        const paths = g.files.flatMap((p) => {
          const c = byPath.get(p);
          return c?.oldPath ? [c.oldPath, p] : [p];
        });
        await this.g(["add", "-A", "--", ...paths], { env: { GIT_LITERAL_PATHSPECS: "1" } });
        await this.g(["commit", "-F", "-"], { input: g.message.trim() + "\n", timeoutMs: 300_000 });
        done++;
      }
      this.summary = "";
      this.message = "";
      this.splitPlan = null;
      return true;
    } catch (e) {
      this.errorMessage = t("Committed {1} of {0} and stopped.\n\n{2}", plan.length, done, describe(e));
      return false;
    } finally {
      this.busy = null;
      await this.reload(true);
      this.emit();
    }
  }

  // 진행 중인 머지·리베이스

  // MARK: - 글 작성(커밋 메시지·설명·PR)

  async generateCommitMessage() {
    if (!this.path || this.aiWorking) return;
    this.aiWorking = t("{0} is writing the commit message…", ai.shortFor("commit"));
    this.aiNotice = null;
    this.emit();
    try {
      const diff = (await this.g(["diff", "--cached", "--no-ext-diff", "-M", "--stat", "--patch"])).stdout;
      if (!diff.trim()) {
        this.errorMessage = t("No staged changes. Stage files first.");
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
      const text = await ai.write("commit", Prompts.commit, prompt, "low");
      const [s, b] = splitMessage(text);
      this.summary = s;
      this.message = b;
      if (clipped.omitted > 0) this.aiNotice = t("The diff was long, so only the beginning was sent to {0} ({1}K characters omitted).", ai.shortFor("commit"), Math.floor(clipped.omitted / 1000));
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
      let text = await ai.write("explain", Prompts.explain, clipped.text, "medium");
      if (clipped.omitted > 0) text += t("\n\n(The diff was long, so only the beginning was explained.)");
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
    const target = this.target;
    if (!this.path || !target) return null;
    const baseRef = this.remoteBranches.some((b) => b.name === `${target.remote}/${base}`) ? `${target.remote}/${base}` : base;
    try {
      const log = (await this.g(["log", "--format=- %s%n%b", `${baseRef}..HEAD`])).stdout;
      const diff = (await this.g(["diff", "--no-ext-diff", "--stat", "--patch", `${baseRef}...HEAD`])).stdout;
      if (!log.trim() && !diff.trim()) {
        this.errorMessage = t("No new commits compared with '{0}'.", base);
        this.emit();
        return null;
      }
      const clipped = clip(diff);
      const prompt = `Branch ${this.headBranch ?? ""} into ${base}.\n\nCommits:\n${log.trim()}\n\nDiff:\n${clipped.text}`;
      return splitMessage(await ai.write("pullRequest", Prompts.pullRequest, prompt, "low"));
    } catch (e) {
      this.fail(e);
      return null;
    }
  }
}
