import { describe, expect, it } from "vitest";
import { layoutGraph } from "../src/lib/graph";
import { parseDiff, parseLog, parseNameStatus, parseNumstat, parseRefs, parseStatus, parseTrack, parseWorktrees } from "../src/lib/parsers";

const US = "\u001f",
  RS = "\u001e";

describe("parsers", () => {
  it("log", () => {
    const text = ["a1", "b1 c1", "홍길동", "h@x", "1700000000", "제목 하나"].join(US) + RS + "\n" + ["b1", "", "B", "b@x", "1690000000", "first"].join(US) + RS;
    const c = parseLog(text);
    expect(c).toHaveLength(2);
    expect(c[0].parents).toEqual(["b1", "c1"]);
    expect(c[0].subject).toBe("제목 하나");
    expect(c[1].parents).toEqual([]);
  });

  it("status v2 with spaces, rename, untracked, conflict", () => {
    const tokens = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaa bbb dir/my file.txt",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt",
      "old name.txt",
      "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
      "? 새 파일.md",
    ];
    const st = parseStatus(tokens.join("\0") + "\0");
    expect(st.branch).toBe("main");
    expect(st.upstream).toBe("origin/main");
    expect(st.ahead).toBe(2);
    expect(st.behind).toBe(1);
    expect(st.unstaged.map((c) => c.path)).toEqual(["dir/my file.txt", "새 파일.md"]);
    expect(st.staged[0]).toMatchObject({ path: "new name.txt", oldPath: "old name.txt", kind: "renamed" });
    expect(st.conflicted[0].path).toBe("conflict.txt");
  });

  it("refs and tracking", () => {
    const line = (...f: string[]) => f.join(US);
    const text = [
      line("refs/heads/main", "m1", "", "origin/main", "ahead 1, behind 2", "*"),
      line("refs/heads/feature/x", "f1", "", "", "", " "),
      line("refs/remotes/origin/HEAD", "m1", "", "", "", " "),
      line("refs/remotes/origin/main", "m0", "", "", "", " "),
      line("refs/tags/v1.10", "t1", "c1", "", "", " "),
      line("refs/tags/v1.9", "t2", "", "", "", " "),
    ].join("\n");
    const r = parseRefs(text);
    expect(r.locals.map((b) => [b.name, b.isCurrent, b.ahead, b.behind])).toEqual([
      ["main", true, 1, 2],
      ["feature/x", false, 0, 0],
    ]);
    expect(r.remotes.map((b) => b.name)).toEqual(["origin/main"]);
    expect(r.tags.map((t) => [t.name, t.target])).toEqual([
      ["v1.10", "c1"],
      ["v1.9", "t2"],
    ]);
    expect(parseTrack("gone").gone).toBe(true);
  });

  it("name-status and numstat with renames", () => {
    expect(parseNameStatus(["M", "a.txt", "R100", "old.txt", "new.txt", "A", "b.txt"].join("\0") + "\0").map((c) => [c.kind, c.path, c.oldPath])).toEqual([
      ["modified", "a.txt", null],
      ["renamed", "new.txt", "old.txt"],
      ["added", "b.txt", null],
    ]);
    const ns = parseNumstat(["3\t1\ta.txt", "2\t0\t", "old.txt", "new.txt", "-\t-\timg.png", ""].join("\0"));
    expect(ns["a.txt"]).toEqual({ added: 3, deleted: 1 });
    expect(ns["new.txt"]).toEqual({ added: 2, deleted: 0 });
    expect(ns["img.png"]).toEqual({ added: null, deleted: null });
  });

  it("worktrees", () => {
    const w = parseWorktrees("worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/repo-worktrees/x\nHEAD def\nbranch refs/heads/x\nlocked\n\n");
    expect(w.map((x) => [x.path, x.branch, x.isMain, x.locked])).toEqual([
      ["C:/repo", "main", true, false],
      ["C:/repo-worktrees/x", "x", false, true],
    ]);
  });

  it("diff with CRLF and line numbers", () => {
    const d = parseDiff("diff --git a/x b/x\r\nindex 1..2\r\n--- a/x\r\n+++ b/x\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+c\r\n");
    expect(d.lines.map((l) => [l.kind, l.text, l.oldNo, l.newNo])).toEqual([
      ["hunk", "@@ -1,2 +1,2 @@", null, null],
      ["context", "a", 1, 1],
      ["removed", "b", 2, null],
      ["added", "c", null, 2],
    ]);
  });
});

describe("graph", () => {
  it("lays out a merge on two lanes", () => {
    const c = (id: string, parents: string[]) => ({ id, parents, author: "", email: "", date: 0, subject: id });
    // m 은 a(첫 부모)와 b 를 머지, a·b 는 base 에서 갈라짐
    const { rows, maxLanes } = layoutGraph([c("m", ["a", "b"]), c("b", ["base"]), c("a", ["base"]), c("base", [])]);
    expect(maxLanes).toBe(2);
    expect(rows[0].column).toBe(0);
    expect(rows[1].column).toBe(1);
    expect(rows[2].column).toBe(0);
    expect(rows[3].column).toBe(0);
    expect(rows[0].segments.some((s) => s.x1 === 0 && s.x2 === 1)).toBe(true);
  });
});
