import { parseConflict, resolveConflict, type ConflictChoice } from "../conflict";
import { canEditLines, buildPatch } from "../diff";
import { joinPath } from "../env";
import { describe, gitBytes } from "../git";
import { ipc } from "../ipc";
import { changePaths, isWIP, sameDiffSource, type DiffDocument, type DiffLine, type DiffSource, type FileChange, type FileHistoryEntry, type Selection } from "../models";
import { settings } from "../settings";

const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff" };
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
    if (this.fileInspect) this.closeFileInspect();
    if (sameDiffSource(source, this.diffSource)) return;
    this.diffSource = source;
    this.diffSelection = new Set();
    this.diffAnchor = null;
    this.loadDiff(false);
  }

  closeDiff() {
    this.diffGen++;
    this.diffSource = null;
    this.diff = null;
    this.diffImages = null;
    this.diffSelection = new Set();
    this.diffLoading = false;
    this.emit();
  }

  // MARK: 충돌 해결(블록마다 고르고 저장한 뒤 해결됨으로 표시)

  /** 지금 진행 중인 작업에 맞는 양쪽 이름(머지·리베이스에서 '내 것'의 뜻이 다르다) */
  get conflictSides(): { ours: string; theirs: string } {
    switch (this.repoState) {
      case "rebasing":
        return { ours: "기준(위로 올리는 곳)", theirs: "내 커밋" };
      case "cherryPicking":
        return { ours: "현재 브랜치", theirs: "가져오는 커밋" };
      case "reverting":
        return { ours: "현재 브랜치", theirs: "되돌리는 변경" };
      default:
        return { ours: "현재 브랜치", theirs: "머지하는 브랜치" };
    }
  }

  async loadConflict(path: string) {
    if (!this.path) return;
    const text = (await ipc.readText(joinPath(this.path, path)).catch(() => null)) ?? "";
    this.conflictPath = path;
    this.conflictDoc = parseConflict(text);
    this.conflictChoices = new Map();
    this.emit();
  }

  chooseConflict(block: number, choice: ConflictChoice | null) {
    const m = new Map(this.conflictChoices);
    if (choice) m.set(block, choice);
    else m.delete(block);
    this.conflictChoices = m;
    this.emit();
  }

  /** 고른 대로 파일을 쓰고 해결됨으로 표시(스테이지) */
  async saveConflictResolution(c: FileChange) {
    const text = this.conflictDoc && resolveConflict(this.conflictDoc, this.conflictChoices);
    if (!this.path || text === null || text === undefined) return;
    try {
      await ipc.writeText(joinPath(this.path, c.path), text);
    } catch (e) {
      this.errorMessage = "파일을 저장하지 못했습니다.\n\n" + describe(e);
      this.emit();
      return;
    }
    if (await this.run("해결됨으로 표시 중…", ["add", "--", c.path])) this.closeConflict();
  }

  /** 파일 전체를 한쪽으로(git checkout --ours/--theirs) */
  async resolveWholeFile(c: FileChange, ours: boolean) {
    if (!(await this.run("충돌 해결 중…", ["checkout", ours ? "--ours" : "--theirs", "--", c.path]))) return;
    if (await this.run("해결됨으로 표시 중…", ["add", "--", c.path])) this.closeConflict();
  }

  /** 한쪽이 지운 파일: 남기기(스테이지) 또는 지우기 */
  async resolveDeleted(c: FileChange, keep: boolean) {
    if (await this.run("충돌 해결 중…", keep ? ["add", "--", c.path] : ["rm", "-q", "--", c.path])) this.closeConflict();
  }

  closeConflict() {
    this.conflictDoc = null;
    this.conflictChoices = new Map();
    this.conflictPath = null;
    this.emit();
  }

  // MARK: 파일 히스토리 · blame(가운데 영역에 띄운다)

  openFileHistory(path: string) {
    this.fileInspect = { mode: "history", path, rev: null };
    void this.loadFileInspect();
  }

  openBlame(path: string, rev: string | null = null) {
    this.fileInspect = { mode: "blame", path, rev };
    void this.loadFileInspect();
  }

  setFileInspectMode(mode: "history" | "blame") {
    if (!this.fileInspect || this.fileInspect.mode === mode) return;
    this.fileInspect = { ...this.fileInspect, mode };
    void this.loadFileInspect();
  }

  closeFileInspect() {
    this.fileInspect = null;
    this.fileHistory = [];
    this.fileHistoryDiff = null;
    this.fileHistorySelected = null;
    this.blameLines = [];
    this.fileInspectError = null;
    this.emit();
  }

  protected async loadFileInspect() {
    const f = this.fileInspect;
    if (!f || !this.path) return;
    this.fileInspectLoading = true;
    this.fileInspectError = null;
    this.emit();
    try {
      if (f.mode === "history") {
        const r = await this.g(["log", "--follow", "-M", "--name-only", "--format=" + P.fileHistoryFormat, "--", f.path]);
        if (this.fileInspect !== f) return;
        this.fileHistory = P.parseFileHistory(r.stdout);
        const first = this.fileHistory[0];
        if (first && !this.fileHistory.some((e) => e.commit.id === this.fileHistorySelected)) void this.selectHistory(first);
      } else {
        const r = await this.g(["blame", "--porcelain", ...(f.rev ? [f.rev] : []), "--", f.path]);
        if (this.fileInspect !== f) return;
        this.blameLines = P.parseBlame(r.stdout);
      }
    } catch (e) {
      if (this.fileInspect === f) this.fileInspectError = describe(e);
    }
    if (this.fileInspect === f) this.fileInspectLoading = false;
    this.emit();
  }

  /** 히스토리에서 커밋을 고르면 그 커밋에서 이 파일이 어떻게 바뀌었는지 */
  async selectHistory(e: FileHistoryEntry) {
    this.fileHistorySelected = e.commit.id;
    this.fileHistoryDiff = null;
    this.emit();
    try {
      const r = await this.g(["diff", "--no-ext-diff", "-M", e.commit.parents[0] ?? EMPTY_TREE, e.commit.id, "--", e.path]);
      if (this.fileHistorySelected !== e.commit.id) return;
      this.fileHistoryDiff = P.parseDiff(r.stdout);
    } catch (err) {
      this.fileHistoryDiff = { lines: [], isBinary: false, truncated: false, header: [], hunks: [], error: describe(err) };
    }
    this.emit();
  }

  // MARK: 보기 설정 · 줄 단위 스테이지

  /** 나란히 보기(왼쪽 이전, 오른쪽 이후) */
  get diffSplit() {
    return settings.get("diffSplit", false);
  }

  setDiffSplit(v: boolean) {
    settings.set("diffSplit", v);
    this.emit();
  }

  /** 공백만 바뀐 줄은 같은 것으로(git diff -w). 켜면 줄 단위 스테이지는 끈다(패치가 맞지 않아서). */
  get diffIgnoreWhitespace() {
    return settings.get("diffIgnoreWhitespace", false);
  }

  setDiffIgnoreWhitespace(v: boolean) {
    settings.set("diffIgnoreWhitespace", v);
    this.loadDiff(true);
  }

  /** 이 diff 에서 덩어리·줄 단위로 스테이지·언스테이지·버리기를 할 수 있는지 */
  get canEditDiffLines() {
    const s = this.diffSource;
    if (!s || s.kind !== "working" || !this.diff || this.diffIgnoreWhitespace) return false;
    if (s.change.kind === "untracked" || s.change.kind === "conflicted") return false;
    return canEditLines(this.diff);
  }

  /** 줄 누르기: 그냥 누르면 그 줄만 넣고 빼기, Shift 와 함께면 앞에 누른 줄부터 같은 덩어리 안에서 범위로 */
  toggleDiffLine(index: number, extend: boolean) {
    const lines = this.diff?.lines;
    const line: DiffLine | undefined = lines?.[index];
    if (!lines || !line || (line.kind !== "added" && line.kind !== "removed")) return;
    const next = new Set(this.diffSelection);
    if (extend && this.diffAnchor != null && lines[this.diffAnchor]?.hunk === line.hunk) {
      for (let i = Math.min(this.diffAnchor, index); i <= Math.max(this.diffAnchor, index); i++) {
        if (lines[i].kind === "added" || lines[i].kind === "removed") next.add(i);
      }
    } else if (next.has(index)) next.delete(index);
    else next.add(index);
    this.diffSelection = next;
    this.diffAnchor = index;
    this.emit();
  }

  /** 이 덩어리에서 고른 줄 수 */
  selectedCount(hunk: number) {
    let n = 0;
    for (const i of this.diffSelection) if (this.diff?.lines[i]?.hunk === hunk) n++;
    return n;
  }

  /** 덩어리(고른 줄이 있으면 그 줄만)를 스테이지·언스테이지·버리기 */
  async applyLines(action: "stage" | "unstage" | "discard", hunk: number) {
    const doc = this.diff;
    if (!doc || !this.canEditDiffLines) return;
    const picked = new Set([...this.diffSelection].filter((i) => doc.lines[i]?.hunk === hunk));
    const patch = buildPatch(doc, [hunk], picked.size ? picked : null, action !== "stage");
    if (!patch) return;
    const args = ["apply", "--recount", "--whitespace=nowarn", ...(action === "stage" ? ["--cached"] : action === "unstage" ? ["--cached", "--reverse"] : ["--reverse"]), "-"];
    const label = action === "stage" ? "스테이지 중…" : action === "unstage" ? "언스테이지 중…" : "변경 버리는 중…";
    if (await this.run(label, args, { input: patch })) {
      this.diffSelection = new Set();
      this.diffAnchor = null;
      this.emit();
    }
  }

  confirmDiscardLines(hunk: number) {
    const n = this.selectedCount(hunk);
    this.confirm = {
      title: n ? `고른 줄 ${n}개의 변경을 버릴까요?` : "이 덩어리의 변경을 버릴까요?",
      message: "작업 트리에서 그 부분이 커밋된(스테이지된) 상태로 돌아갑니다. 되돌릴 수 없습니다.",
      actionTitle: "버리기",
      destructive: true,
      action: () => this.applyLines("discard", hunk),
    };
    this.emit();
  }

  /** 이미지 파일이면 바뀌기 전·후를 읽는다(그 밖이면 null) */
  protected async loadDiffImages(source: DiffSource): Promise<{ old: string | null; new: string | null } | null> {
    const path = this.path;
    const c = source.change;
    const mime = IMAGE_EXT[c.path.split(".").pop()?.toLowerCase() ?? ""];
    if (!path || !mime) return null;
    const show = async (spec: string) => {
      const b = await gitBytes(["show", spec], path);
      return b ? `data:${mime};base64,${b}` : null;
    };
    let old: string | null = null,
      now: string | null = null;
    if (source.kind === "working") {
      if (c.staged) {
        if (c.kind !== "added") old = await show(`HEAD:${c.oldPath ?? c.path}`);
        if (c.kind !== "deleted") now = await show(`:${c.path}`);
      } else {
        if (c.kind !== "untracked") old = await show(`:${c.oldPath ?? c.path}`);
        if (c.kind !== "deleted") {
          const b = await ipc.readBase64(joinPath(path, c.path)).catch(() => null);
          now = b ? `data:${mime};base64,${b}` : null;
        }
      }
    } else if (source.kind === "commit") {
      if (c.kind !== "added" && source.parent) old = await show(`${source.parent}:${c.oldPath ?? c.path}`);
      if (c.kind !== "deleted") now = await show(`${source.sha}:${c.path}`);
    }
    return old || now ? { old, new: now } : null;
  }

  protected loadDiff(keepCurrent: boolean) {
    const source = this.diffSource;
    const path = this.path;
    if (!source || !path) {
      this.diff = null;
      return;
    }
    if (!keepCurrent) {
      this.diff = null;
      this.diffImages = null;
    }
    this.diffLoading = true;
    const ws = this.diffIgnoreWhitespace ? ["-w"] : [];
    const gen = ++this.diffGen;
    this.emit();
    void (async () => {
      let doc: DiffDocument;
      try {
        if (source.kind === "review") {
          // 서버가 준 덩어리만 있는 패치에 머리를 붙여 그대로 읽는다(git 실행 없음)
          const c = source.change;
          const old = c.oldPath ?? c.path;
          doc = source.patch
            ? P.parseDiff(`diff --git a/${old} b/${c.path}\n--- a/${old}\n+++ b/${c.path}\n${source.patch}`)
            : { lines: [], isBinary: true, truncated: false, header: [], hunks: [] };
        } else if (source.kind === "working" && source.change.kind === "untracked") {
          const head = await ipc.readHead(joinPath(path, source.change.path), 2_000_000);
          doc = head.binary ? { lines: [], isBinary: true, truncated: false, header: [], hunks: [] } : P.newFileDiff(head.text, head.truncated);
        } else {
          let args: string[];
          if (source.kind === "working") {
            args = source.change.staged
              ? ["diff", "--cached", "--no-ext-diff", "-M", ...ws, "--", ...changePaths(source.change)]
              : ["diff", "--no-ext-diff", ...ws, "--", ...changePaths(source.change)];
          } else {
            args = ["diff", "--no-ext-diff", "-M", ...ws, source.parent ?? EMPTY_TREE, source.sha, "--", ...changePaths(source.change)];
          }
          const r = await this.g(args);
          doc = P.parseDiff(r.stdout);
        }
      } catch (e) {
        doc = { lines: [], isBinary: false, truncated: false, error: describe(e), header: [], hunks: [] };
      }
      const images = await this.loadDiffImages(source).catch(() => null);
      if (gen !== this.diffGen) return;
      this.diff = doc;
      this.diffImages = images;
      // 다시 읽은 diff 에 없는 줄은 고른 것에서 뺀다
      this.diffSelection = new Set([...this.diffSelection].filter((i) => i < doc.lines.length && (doc.lines[i].kind === "added" || doc.lines[i].kind === "removed")));
      this.diffLoading = false;
      this.emit();
    })();
  }
}
