import { describe, expect, it } from "vitest";
import { graphColumns, graphWidth } from "../src/components/graph/metrics";

const msg = (w: number, c: ReturnType<typeof graphColumns>) => w - (c.ref + c.graph + 20 + (c.author ? 120 : 0) + (c.date ? 90 : 0) + (c.sha ? 64 : 0));

describe("그래프 칸 너비", () => {
  it("넓으면 모든 칸", () => {
    const c = graphColumns(1100, graphWidth(5));
    expect(c).toEqual({ ref: 190, graph: graphWidth(5), author: true, date: true, sha: true });
  });
  it("좁아지면 SHA → 날짜 → (브랜치 칸 줄이기) → 작성자 순으로 숨기고 메시지 칸을 지킨다", () => {
    const g = graphWidth(7);
    for (const w of [900, 800, 700, 650, 600, 560, 520, 480]) {
      const c = graphColumns(w, g);
      expect(msg(w, c)).toBeGreaterThanOrEqual(180);
      if (!c.date) expect(c.sha).toBe(false);
      if (!c.author) expect(c.date).toBe(false);
    }
    expect(graphColumns(650, g)).toMatchObject({ author: true, date: false, sha: false });
  });
  it("아주 좁으면 그래프 칸도 줄이되(레인은 잘림) 너무 작게는 안 줄인다", () => {
    const c = graphColumns(420, graphWidth(14));
    expect(c.ref).toBe(110);
    expect(c.graph).toBeGreaterThanOrEqual(66);
    expect(c.graph).toBeLessThan(graphWidth(14));
  });
});
