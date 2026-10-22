import { describe, expect, it } from "vitest";
import { sameSnapshot, undoSummary, undoTitle, type RefSnapshot } from "../src/lib/repo/undo-model";

const snap = (refs: Record<string, string>, headRef: string | null, head: string | null): RefSnapshot => ({ refs, headRef, head });

describe("되돌리기 기록", () => {
  it("작업 이름", () => {
    const after = snap({}, "refs/heads/feature/x", "b");
    expect(undoTitle(["commit", "-F", "-"], "새 파일 추가\n\n본문\n", after)).toBe("커밋 '새 파일 추가'");
    expect(undoTitle(["commit", "-F", "-", "--amend"], "고침\n", after)).toBe("커밋 고치기 '고침'");
    expect(undoTitle(["switch", "-c", "feature/x", "abc"], undefined, after)).toBe("브랜치 'feature/x' 만들고 체크아웃");
    expect(undoTitle(["switch", "main"], undefined, snap({}, "refs/heads/main", "a"))).toBe("'main' 체크아웃");
    expect(undoTitle(["merge", "side"], undefined, after)).toBe("'side' 머지");
    expect(undoTitle(["branch", "-D", "old"], undefined, after)).toBe("브랜치 'old' 삭제");
  });

  it("같은 상태인지", () => {
    const a = snap({ "refs/heads/main": "1" }, "refs/heads/main", "1");
    expect(sameSnapshot(a, snap({ "refs/heads/main": "1" }, "refs/heads/main", "1"))).toBe(true);
    expect(sameSnapshot(a, snap({ "refs/heads/main": "2" }, "refs/heads/main", "2"))).toBe(false);
    expect(sameSnapshot(a, snap({ "refs/heads/main": "1", "refs/heads/x": "1" }, "refs/heads/main", "1"))).toBe(false);
  });

  it("되돌리면 무엇이 바뀌는지", () => {
    const before = snap({ "refs/heads/main": "aaaaaaa1", "refs/heads/old": "bbbbbbb2" }, "refs/heads/main", "aaaaaaa1");
    const after = snap({ "refs/heads/main": "aaaaaaa1", "refs/heads/feature/x": "aaaaaaa1" }, "refs/heads/feature/x", "aaaaaaa1");
    expect(undoSummary({ title: "", soft: false, before, after }).split("\n")).toEqual([
      "'main'(으)로 돌아갑니다.",
      "만든 브랜치 'feature/x' 을(를) 지웁니다.",
      "지운 브랜치 'old' 을(를) bbbbbbb 에 되살립니다.",
    ]);
    const commit = { title: "", soft: true, before: snap({ "refs/heads/main": "1111111a" }, "refs/heads/main", "1111111a"), after: snap({ "refs/heads/main": "2222222b" }, "refs/heads/main", "2222222b") };
    expect(undoSummary(commit)).toBe("커밋을 취소하고, 그 변경은 스테이지된 상태로 남깁니다.");
  });
});
