import { describe, expect, it } from "vitest";
import { type ConflictChoice, parseConflict, resolveConflict } from "@/entities/git/lib/conflict";

describe("충돌 해결", () => {
  const text = "1\n<<<<<<< HEAD\ntwo-main\n=======\ntwo-other\n>>>>>>> other\n3\n<<<<<<< HEAD\nf-main\n=======\nf-other\n>>>>>>> other\n4\n";
  it("블록으로 나눔", () => {
    const d = parseConflict(text);
    expect(d.blocks.map((b) => [b.ours, b.theirs, b.oursLabel, b.theirsLabel])).toEqual([
      [["two-main"], ["two-other"], "HEAD", "other"],
      [["f-main"], ["f-other"], "HEAD", "other"],
    ]);
  });
  it("모두 골라야 합침", () => {
    const d = parseConflict(text);
    const c = new Map<number, ConflictChoice>([[0, { kind: "theirs" }]]);
    expect(resolveConflict(d, c)).toBeNull();
    c.set(1, { kind: "oursThenTheirs" });
    expect(resolveConflict(d, c)).toBe("1\ntwo-other\n3\nf-main\nf-other\n4\n");
  });
  it("CRLF·diff3·직접 고치기", () => {
    const d = parseConflict("x\r\n<<<<<<< HEAD\r\nmine\r\n||||||| base\r\norig\r\n=======\r\ntheirs\r\n>>>>>>> feature\r\ny\r\n");
    expect(d.blocks[0].base).toEqual(["orig"]);
    expect(resolveConflict(d, new Map([[0, { kind: "custom", text: "a\nb" }]]))).toBe("x\r\na\r\nb\r\ny\r\n");
  });
});
