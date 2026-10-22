

export const LANE_W = 22;
export const ROW_H = 30;
export const LEFT_PAD = 6;
const MAX_LANES = 16;
/** 왼쪽 브랜치·태그 칸 너비 */
export const REF_W = 190;
/** 커밋 동그라미(프로필) 지름 */
export const AVATAR = 20;

export const graphWidth = (lanes: number) => Math.max(44, Math.min(lanes, MAX_LANES) * LANE_W + LEFT_PAD * 2);
