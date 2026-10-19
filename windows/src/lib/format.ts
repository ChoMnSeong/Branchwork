/** 레인 색. 흰 글자를 올려도 읽히도록 채도·명도를 맞췄다. (맥 버전과 같은 색) */
export const laneColors = [
  "rgb(41,133,245)", // 파랑
  "rgb(237,107,41)", // 주황
  "rgb(46,158,92)", // 초록
  "rgb(199,77,204)", // 자주
  "rgb(204,148,20)", // 황토
  "rgb(20,153,168)", // 청록
  "rgb(224,69,102)", // 빨강
  "rgb(122,102,235)", // 보라
];

export function laneColor(i: number) {
  const n = laneColors.length;
  return laneColors[((i % n) + n) % n];
}

/** 실행마다 바뀌지 않는 문자열 해시(색 고정용) */
export function stableHash(s: string) {
  let h = 5381;
  for (const ch of s) h = ((h * 33) + (ch.codePointAt(0) ?? 0)) & 0x7fffffff;
  return h;
}

const relative = new Intl.RelativeTimeFormat("ko", { numeric: "auto", style: "short" });

/** 일주일 이내는 "3시간 전", 그보다 오래면 날짜 */
export function shortDate(sec: number) {
  const diff = Date.now() / 1000 - sec;
  if (diff < 7 * 86400) {
    if (diff < 60) return "방금";
    if (diff < 3600) return relative.format(-Math.floor(diff / 60), "minute");
    if (diff < 86400) return relative.format(-Math.floor(diff / 3600), "hour");
    return relative.format(-Math.floor(diff / 86400), "day");
  }
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function longDate(sec: number) {
  const d = new Date(sec * 1000);
  const h = d.getHours();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${ampm} ${h12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const trimmed = (s: string) => s.trim();

/** 브랜치 이름으로 쓸 수 있는지 대략 확인 */
export function validBranchName(n: string) {
  const s = n.trim();
  return !!s && !/\s/.test(s) && !s.startsWith("-") && !s.includes("..") && !/[~^:?*[\\]/.test(s) && !s.endsWith("/") && !s.endsWith(".lock");
}
