import { t } from "@/shared/i18n";
import type { FileChange } from "../model/types";

export interface SplitGroup {
  id: string;
  message: string;
  files: string[];
}

/** AI 의 JSON 답을 계획으로. 모르는 경로는 버리고, 빠진 파일은 마지막 묶음으로 모은다. */
export function parseSplitPlan(text: string, changes: FileChange[]): SplitGroup[] {
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(t("Couldn't read the AI's split (not JSON). Please try again."));
  let data: { commits?: { message?: string; files?: string[] }[] };
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(t("Couldn't read the AI's split (invalid JSON). Please try again."));
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
  if (rest.length) groups.push({ id: crypto.randomUUID(), message: groups.length ? "" : t("Chore: update"), files: rest });
  if (!groups.length) throw new Error(t("The AI couldn't split the commits."));
  return groups;
}
