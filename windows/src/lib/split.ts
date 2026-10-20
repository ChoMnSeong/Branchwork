import type { FileChange } from "./models";

export interface SplitGroup {
  id: string;
  message: string;
  files: string[];
}

/** AI 의 JSON 답을 계획으로. 모르는 경로는 버리고, 빠진 파일은 마지막 묶음으로 모은다. */
export function parseSplitPlan(text: string, changes: FileChange[]): SplitGroup[] {
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 가 나눈 결과를 읽지 못했습니다(JSON 아님). 다시 시도해 보세요.");
  let data: { commits?: { message?: string; files?: string[] }[] };
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("AI 가 나눈 결과를 읽지 못했습니다(JSON 형식 오류). 다시 시도해 보세요.");
  }
  const known = new Map<string, string>();
  for (const c of changes) {
    known.set(c.path, c.path);
    if (c.oldPath) known.set(c.oldPath, c.path);
  }
  const used = new Set<string>();
  const groups: SplitGroup[] = [];
  for (const c of data.commits ?? []) {
    const files: string[] = [];
    for (const f of c.files ?? []) {
      const p = known.get(String(f).replace(/\\/g, "/").replace(/^\.\//, ""));
      if (p && !used.has(p)) {
        used.add(p);
        files.push(p);
      }
    }
    if (files.length) groups.push({ id: crypto.randomUUID(), message: String(c.message ?? "").trim(), files });
  }
  const rest = changes.map((c) => c.path).filter((p) => !used.has(p));
  if (rest.length) groups.push({ id: crypto.randomUUID(), message: groups.length ? "" : "Chore: 변경 사항", files: rest });
  if (!groups.length) throw new Error("AI 가 커밋을 나누지 못했습니다.");
  return groups;
}
