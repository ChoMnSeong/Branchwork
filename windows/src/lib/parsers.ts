import {
  changeKind,
  emptyStatus,
  type Branch,
  type Commit,
  type CommitDetail,
  type DiffDocument,
  type DiffKind,
  type FileChange,
  type LineStat,
  type Stash,
  type Tag,
  type WorkingStatus,
  type Worktree,
} from "./models";

/** git 의 기계용 출력(porcelain, -z, 커스텀 format)을 모델로 바꾼다. (맥 버전 Parsers.swift 와 같은 규칙) */

// 그래프 날짜는 정렬(--date-order) 기준과 같은 커밋 날짜(%ct)
export const logFormat = "%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%s%x1e";
export const refFormat = "%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)";
export const detailFormat = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B";
export const stashFormat = "%gd%x1f%H%x1f%gs";

const US = "\u001f";
const RS = "\u001e";

const words = (s: string) => s.split(" ").filter(Boolean);
const lines = (s: string) => s.split("\n").filter((l) => l.length > 0);

export function parseLog(text: string): Commit[] {
  const out: Commit[] = [];
  for (const rec of text.split(RS)) {
    const r = rec.replace(/^[\r\n]+/, "");
    if (!r) continue;
    const f = r.split(US);
    if (f.length < 6) continue;
    out.push({ id: f[0], parents: words(f[1]), author: f[2], email: f[3], date: Number(f[4]) || 0, subject: f[5] });
  }
  return out;
}

export function parseCommitDetail(text: string): CommitDetail | null {
  const f = text.split(US);
  if (f.length < 9) return null;
  const message = f.slice(8).join(US).trim();
  const nl = message.indexOf("\n");
  const summary = nl < 0 ? message : message.slice(0, nl);
  const body = message.slice(summary.length).trim();
  return {
    sha: f[0],
    parents: words(f[1]),
    author: f[2],
    email: f[3],
    date: Number(f[4]) || 0,
    committer: f[5],
    committerEmail: f[6],
    commitDate: Number(f[7]) || 0,
    summary,
    body,
  };
}

/** "ahead 2, behind 1" / "gone" */
export function parseTrack(s: string) {
  let ahead = 0,
    behind = 0,
    gone = false;
  for (const part of s.split(",")) {
    const w = words(part.trim());
    if (w[0] === "gone") gone = true;
    if (w.length === 2) {
      const n = Number(w[1]);
      if (w[0] === "ahead") ahead = n;
      else if (w[0] === "behind") behind = n;
    }
  }
  return { ahead, behind, gone };
}

const naturalDesc = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });

export function parseRefs(text: string): { locals: Branch[]; remotes: Branch[]; tags: Tag[] } {
  const locals: Branch[] = [];
  const remotes: Branch[] = [];
  const tags: Tag[] = [];
  for (const line of lines(text)) {
    const f = line.split(US);
    if (f.length < 6) continue;
    const [ref, obj, peeled, upstream, track] = f;
    if (ref.startsWith("refs/heads/")) {
      const t = parseTrack(track);
      locals.push({
        name: ref.slice(11),
        target: obj,
        upstream: upstream || null,
        ahead: t.ahead,
        behind: t.behind,
        upstreamGone: t.gone,
        isCurrent: f[5].trim() === "*",
        isRemote: false,
      });
    } else if (ref.startsWith("refs/remotes/")) {
      const name = ref.slice(13);
      if (name.endsWith("/HEAD")) continue;
      remotes.push({ name, target: obj, upstream: null, ahead: 0, behind: 0, upstreamGone: false, isCurrent: false, isRemote: true });
    } else if (ref.startsWith("refs/tags/")) {
      tags.push({ name: ref.slice(10), target: peeled || obj });
    }
  }
  tags.sort((a, b) => naturalDesc(a.name, b.name));
  return { locals, remotes, tags };
}

export function parseStashes(text: string): Stash[] {
  return lines(text)
    .map((l) => l.split(US))
    .filter((f) => f.length >= 3)
    .map((f) => ({ ref: f[0], hash: f[1], message: f[2] }));
}

/** `git remote -v` → 이름 순서와 fetch URL */
export function parseRemotes(text: string): { names: string[]; urls: Record<string, string> } {
  const names: string[] = [];
  const urls: Record<string, string> = {};
  for (const line of lines(text)) {
    const parts = line.split(/[\t ]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const name = parts[0];
    if (!names.includes(name)) names.push(name);
    if (parts.length < 3 || parts[2] === "(fetch)") urls[name] = parts[1];
  }
  return { names, urls };
}

/** `git worktree list --porcelain` (빈 줄로 구분된 블록) */
export function parseWorktrees(text: string): Worktree[] {
  const out: Worktree[] = [];
  text
    .replace(/\r/g, "")
    .split("\n\n")
    .forEach((block, i) => {
      let path: string | null = null,
        head: string | null = null,
        branch: string | null = null;
      let locked = false,
        prunable = false,
        bare = false;
      for (const line of lines(block)) {
        if (line.startsWith("worktree ")) path = line.slice(9);
        else if (line.startsWith("HEAD ")) head = line.slice(5);
        else if (line.startsWith("branch ")) {
          const ref = line.slice(7);
          branch = ref.startsWith("refs/heads/") ? ref.slice(11) : ref;
        } else if (line === "bare") bare = true;
        else if (line.startsWith("locked")) locked = true;
        else if (line.startsWith("prunable")) prunable = true;
      }
      if (!path || bare) return;
      out.push({ path, head, branch, isMain: i === 0, locked, prunable });
    });
  return out;
}

/** status --porcelain=v2 -z --branch */
export function parseStatus(text: string): WorkingStatus {
  const st = emptyStatus();
  const tokens = text.split("\0").filter((t) => t.length > 0);
  let i = 0;

  const add = (xy: string, path: string, orig: string | null) => {
    if (xy.length !== 2) return;
    if (xy[0] !== ".") st.staged.push({ path, oldPath: orig, kind: changeKind(xy[0]), staged: true });
    if (xy[1] !== ".") st.unstaged.push({ path, oldPath: null, kind: changeKind(xy[1]), staged: false });
  };
  /** 공백으로 n 칸 나누고 나머지는 경로(경로에 공백이 있을 수 있음) */
  const splitN = (t: string, n: number) => {
    const out: string[] = [];
    let rest = t;
    for (let k = 0; k < n - 1; k++) {
      const sp = rest.indexOf(" ");
      if (sp < 0) break;
      out.push(rest.slice(0, sp));
      rest = rest.slice(sp + 1);
    }
    out.push(rest);
    return out;
  };

  while (i < tokens.length) {
    const t = tokens[i++];
    if (t.startsWith("# ")) {
      const body = t.slice(2);
      const sp = body.indexOf(" ");
      if (sp < 0) continue;
      const key = body.slice(0, sp),
        val = body.slice(sp + 1);
      if (key === "branch.head") st.branch = val === "(detached)" ? null : val;
      else if (key === "branch.upstream") st.upstream = val;
      else if (key === "branch.ab") {
        for (const w of words(val)) {
          if (w.startsWith("+")) st.ahead = Number(w.slice(1)) || 0;
          if (w.startsWith("-")) st.behind = Number(w.slice(1)) || 0;
        }
      }
    } else if (t.startsWith("1 ")) {
      const f = splitN(t, 9);
      if (f.length === 9) add(f[1], f[8], null);
    } else if (t.startsWith("2 ")) {
      const f = splitN(t, 10);
      const orig = i < tokens.length ? tokens[i] : null;
      i++;
      if (f.length === 10) add(f[1], f[9], orig);
    } else if (t.startsWith("u ")) {
      const f = splitN(t, 11);
      if (f.length === 11) st.conflicted.push({ path: f[10], oldPath: null, kind: "conflicted", staged: false });
    } else if (t.startsWith("? ")) {
      st.unstaged.push({ path: t.slice(2), oldPath: null, kind: "untracked", staged: false });
    }
  }
  return st;
}

/** --name-status -z */
export function parseNameStatus(text: string): FileChange[] {
  const tokens = text.split("\0").filter((t) => t.length > 0);
  const out: FileChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++];
    const c = code[0];
    if (!c) continue;
    if (c === "R" || c === "C") {
      if (i + 1 >= tokens.length) break;
      out.push({ path: tokens[i + 1], oldPath: tokens[i], kind: c === "R" ? "renamed" : "copied", staged: false });
      i += 2;
    } else {
      if (i >= tokens.length) break;
      out.push({ path: tokens[i], oldPath: null, kind: changeKind(c), staged: false });
      i++;
    }
  }
  return out;
}

/** --numstat -z: "추가\t삭제\t경로\0", 이름 변경은 "추가\t삭제\t\0이전\0새\0" */
export function parseNumstat(text: string): Record<string, LineStat> {
  const tokens = text.split("\0");
  const out: Record<string, LineStat> = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i++].replace(/^\n/, "");
    const a = t.indexOf("\t");
    const b = a < 0 ? -1 : t.indexOf("\t", a + 1);
    if (a < 0 || b < 0) continue;
    const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
    const stat: LineStat = { added: num(t.slice(0, a)), deleted: num(t.slice(a + 1, b)) };
    const path = t.slice(b + 1);
    if (!path) {
      if (i + 1 >= tokens.length) break;
      out[tokens[i + 1]] = stat;
      i += 2;
    } else {
      out[path] = stat;
    }
  }
  return out;
}

function hunkStart(s: string, sign: string) {
  const m = s.match(new RegExp(` \\${sign}(\\d+)`));
  return m ? Number(m[1]) : 0;
}

export function parseDiff(text: string, maxLines = 20000): DiffDocument {
  const doc: DiffDocument = { lines: [], isBinary: false, truncated: false };
  let body = text.replace(/\r\n/g, "\n");
  if (body.endsWith("\n")) body = body.slice(0, -1);
  if (!body) return doc;

  let oldNo = 0,
    newNo = 0,
    inHunk = false,
    cols = 1;
  const push = (kind: DiffKind, t: string, o: number | null, n: number | null) => doc.lines.push({ kind, text: t, oldNo: o, newNo: n });

  for (const s of body.split("\n")) {
    if (doc.lines.length >= maxLines) {
      doc.truncated = true;
      break;
    }
    if (s.startsWith("@@")) {
      inHunk = true;
      cols = Math.max(1, (s.match(/^@+/)?.[0].length ?? 2) - 1); // "@@" 1열, 결합 diff "@@@" 2열
      oldNo = hunkStart(s, "-");
      newNo = hunkStart(s, "+");
      push("hunk", s, null, null);
      continue;
    }
    if (s.startsWith("diff ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      if (s.startsWith("Binary files") || s.startsWith("GIT binary patch")) doc.isBinary = true;
      if (
        s.startsWith("new file mode") ||
        s.startsWith("deleted file mode") ||
        s.startsWith("similarity") ||
        s.startsWith("rename ") ||
        s.startsWith("old mode") ||
        s.startsWith("new mode")
      )
        push("meta", s, null, null);
      continue;
    }
    if (s.startsWith("\\")) {
      push("meta", s, null, null);
      continue;
    }
    const marker = s.slice(0, cols);
    const content = s.slice(cols).replace(/\t/g, "    ");
    if (marker.includes("+") && !marker.includes("-")) {
      push("added", content, null, newNo++);
    } else if (marker.includes("-")) {
      push("removed", content, oldNo++, null);
    } else {
      push("context", content, oldNo++, newNo++);
    }
  }
  return doc;
}

/** 추적하지 않는 새 파일: 내용 전체를 추가된 줄로 */
export function newFileDiff(text: string, truncated: boolean, maxLines = 20000): DiffDocument {
  const doc: DiffDocument = { lines: [{ kind: "meta", text: "new file", oldNo: null, newNo: null }], isBinary: false, truncated };
  let body = text.replace(/\r\n/g, "\n");
  if (body.endsWith("\n")) body = body.slice(0, -1);
  if (!body) return { ...doc, lines: [] };
  const all = body.split("\n");
  doc.lines.push({ kind: "hunk", text: `@@ -0,0 +1,${all.length} @@`, oldNo: null, newNo: null });
  all.slice(0, maxLines).forEach((l, i) => doc.lines.push({ kind: "added", text: l.replace(/\t/g, "    "), oldNo: null, newNo: i + 1 }));
  if (all.length > maxLines) doc.truncated = true;
  return doc;
}
