import { joinPath } from "../env";
import { describe } from "../git";
import { ipc } from "../ipc";
import { changePaths, isWIP, sameDiffSource, type DiffDocument, type DiffSource, type Selection } from "../models";
import * as P from "../parsers";
import { EMPTY_TREE, RepoCore } from "./core";

/** 선택한 커밋·작업 영역의 상세와 diff */
export abstract class RepoSelection extends RepoCore {
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
  protected async revealLoadingHistory(sha: string) {
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

  protected loadDiff(keepCurrent: boolean) {
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
}
