

export const LANE_W = 22;
export const ROW_H = 30;
export const LEFT_PAD = 6;
const MAX_LANES = 16;
/** 왼쪽 브랜치·태그 칸 너비 */
export const REF_W = 190;
/** 커밋 동그라미(프로필) 지름 */
export const AVATAR = 20;

export const graphWidth = (lanes: number) => Math.max(44, Math.min(lanes, MAX_LANES) * LANE_W + LEFT_PAD * 2);

/** 그래프 행의 칸 너비. 좁은 화면에서는 커밋 메시지 칸을 지키려고 다른 칸을 숨기거나 줄인다. */
export interface GraphColumns {
  ref: number;
  graph: number;
  author: boolean;
  date: boolean;
  sha: boolean;
}

const MESSAGE_MIN = 180;
const REF_MID = 150;
const REF_MIN = 110;
const GRAPH_MIN = 66;

/**
 * SHA → 날짜 칸을 숨기고, 브랜치 칸을 조금 줄이고, 작성자 칸을 숨기고, 브랜치 칸을 더 줄이고,
 * 그래도 모자라면 그래프 칸(오른쪽 레인은 잘림)을 줄인다.
 */
export function graphColumns(width: number, graph: number): GraphColumns {
  const c: GraphColumns = { ref: REF_W, graph, author: true, date: true, sha: true };
  // 메시지 왼쪽 여백 8, 행 오른쪽 여백 12
  const short = () => MESSAGE_MIN - (width - (c.ref + c.graph + 8 + 12 + (c.author ? 120 : 0) + (c.date ? 90 : 0) + (c.sha ? 64 : 0)));
  const shrinkRef = (min: number) => {
    if (short() > 0) c.ref = Math.max(min, c.ref - short());
  };
  if (short() > 0) c.sha = false;
  if (short() > 0) c.date = false;
  shrinkRef(REF_MID);
  if (short() > 0) c.author = false;
  shrinkRef(REF_MIN);
  if (short() > 0) c.graph = Math.max(Math.min(graph, GRAPH_MIN), c.graph - short());
  return c;
}
