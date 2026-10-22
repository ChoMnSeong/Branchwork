import { describe, expect, it } from "vitest";
import { buildPatch, canEditLines, splitRows, wordRanges } from "../src/lib/diff";
import { parseDiff } from "../src/lib/parsers";

const DIFF = [
  "diff --git a/f.txt b/f.txt",
  "index 1111111..2222222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -2,3 +2,3 @@",
  " 2",
  "-3",
  "+three",
  " 4",
  "@@ -14,4 +14,4 @@",
  " 14",
  "-15",
  "-16",
  "+fifteen",
  "+sixteen",
  " 17",
  "",
].join("\n");

describe("diff 해석", () => {
  it("덩어리·머리·원문", () => {
    const d = parseDiff(DIFF);
    expect(d.hunks.map((h) => [h.oldStart, h.oldCount, h.newStart, h.newCount])).toEqual([
      [2, 3, 2, 3],
      [14, 4, 14, 4],
    ]);
    expect(d.header[0]).toBe("diff --git a/f.txt b/f.txt");
    expect(canEditLines(d)).toBe(true);
    expect(d.lines.find((l) => l.text === "three")?.hunk).toBe(0);
  });

  it("CRLF 파일: 화면에는 \\r 없이, 패치용 원문에는 그대로", () => {
    const d = parseDiff(DIFF.replace("+three\n", "+three\r\n"));
    const l = d.lines.find((x) => x.kind === "added" && x.text === "three")!;
    expect(l.raw).toBe("three\r");
  });
});

describe("줄 단위 패치", () => {
  const d = parseDiff(DIFF);
  it("덩어리 하나 스테이지", () => {
    expect(buildPatch(d, [1], null, false)).toBe(
      ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -14,4 +14,4 @@", " 14", "-15", "-16", "+fifteen", "+sixteen", " 17", ""].join("\n"),
    );
  });
  it("고른 줄만 스테이지: 고르지 않은 - 는 문맥, + 는 뺌", () => {
    const sixteen = d.lines.findIndex((l) => l.text === "sixteen");
    expect(buildPatch(d, [1], new Set([sixteen]), false)).toBe(
      ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -14,4 +14,5 @@", " 14", " 15", " 16", "+sixteen", " 17", ""].join("\n"),
    );
  });
  it("거꾸로(언스테이지·버리기): 고르지 않은 + 는 문맥, - 는 뺌", () => {
    const rm15 = d.lines.findIndex((l) => l.text === "15");
    expect(buildPatch(d, [1], new Set([rm15]), true)).toBe(
      ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -14,5 +14,4 @@", " 14", "-15", " fifteen", " sixteen", " 17", ""].join("\n"),
    );
  });
  it("새 파일은 줄 단위로 못 함", () => {
    expect(canEditLines(parseDiff(DIFF.replace("index 1111111..2222222 100644", "new file mode 100644")))).toBe(false);
  });
});

describe("나란히 보기 · 단어 단위", () => {
  it("지운 줄과 더한 줄을 짝지음", () => {
    const d = parseDiff(DIFF);
    const rows = splitRows(d.lines);
    const pair = rows.find((r) => r.left !== undefined && d.lines[r.left].text === "15");
    expect(pair && d.lines[pair.right!].text).toBe("fifteen");
  });
  it("바뀐 단어 위치", () => {
    expect(wordRanges("let total = price * qty", "let total = price * quantity + fee")).toEqual([[[20, 23]], [[20, 34]]]);
    expect(wordRanges("완전히 다른 줄", "something else entirely")).toEqual([[], []]);
  });
});
