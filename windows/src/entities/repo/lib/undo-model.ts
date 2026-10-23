import { t } from "@/shared/i18n";
/** 되돌리기의 기록 형식과 설명 글(화면·git 과 무관한 부분 — 단위 테스트용으로 따로 둔다) */

/** 로컬 브랜치·태그와 HEAD 의 위치(되돌리기의 '전'과 '후') */
export interface RefSnapshot {
  /** refs/heads/*, refs/tags/* → 가리키는 객체 */
  refs: Record<string, string>;
  /** HEAD 가 가리키는 브랜치(refs/heads/x). 분리된 HEAD 면 null */
  headRef: string | null;
  /** HEAD 커밋(아직 커밋이 없으면 null) */
  head: string | null;
}

/** 되돌릴 수 있는 git 작업 하나 */
export interface UndoPoint {
  title: string;
  /** 커밋·amend 는 되돌려도 변경을 스테이지된 채로 남긴다(reset --soft). 그 밖에는 작업 트리까지(reset --keep) */
  soft: boolean;
  before: RefSnapshot;
  after: RefSnapshot;
}

export const shortRef = (ref: string | null) => (ref ? ref.replace(/^refs\/(heads|tags)\//, "") : null);

export function sameSnapshot(a: RefSnapshot, b: RefSnapshot) {
  const ka = Object.keys(a.refs);
  return a.headRef === b.headRef && a.head === b.head && ka.length === Object.keys(b.refs).length && ka.every((k) => a.refs[k] === b.refs[k]);
}

/** 되돌리면 무엇이 바뀌는지(확인 창에 보여 줌) */
export function undoSummary(p: UndoPoint): string {
  const { before, after } = p;
  const lines: string[] = [];
  if (before.headRef !== after.headRef) lines.push(t("Returns to '{0}'.", shortRef(before.headRef) ?? t("Detached HEAD")));
  if (before.headRef && before.refs[before.headRef] !== after.refs[before.headRef] && before.refs[before.headRef]) {
    lines.push(
      p.soft
        ? t("Undoes the commit and leaves its changes staged.")
        : t("Moves '{0}' back to the previous commit ({1}). Uncommitted changes are kept.", shortRef(before.headRef), before.refs[before.headRef].slice(0, 7)),
    );
  }
  for (const ref of [...new Set([...Object.keys(before.refs), ...Object.keys(after.refs)])].sort()) {
    if (ref === before.headRef) continue;
    const name = shortRef(ref);
    const kind = ref.startsWith("refs/tags/") ? t("tag") : t("branch");
    const old = before.refs[ref],
      now = after.refs[ref];
    if (!old && now) lines.push(t("Deletes the {0} '{1}' that was created.", kind, name));
    else if (old && !now) lines.push(t("Restores the deleted {0} '{1}' at {2}.", kind, name, old.slice(0, 7)));
    else if (old && now && old !== now) lines.push(t("Moves {0} '{1}' back to {2}.", kind, name, old.slice(0, 7)));
  }
  return lines.join("\n");
}

export function undoTitle(args: string[], input: string | undefined, after: RefSnapshot): string {
  while (args[0] === "-c") args = args.slice(2); // git -c 설정 이름=값 …
  const last = args[args.length - 1] ?? "";
  switch (args[0]) {
    case "commit": {
      const subject = input?.split("\n")[0].trim() ?? "";
      return (args.includes("--amend") ? t("Amend commit") : t("Commit")) + (subject ? ` '${subject}'` : "");
    }
    case "switch":
    case "checkout":
      if (args.includes("-c") || args.includes("-b")) return t("Create and check out branch '{0}'", shortRef(after.headRef) ?? last);
      return t("Check out '{0}'", shortRef(after.headRef) ?? last.slice(0, 7));
    case "merge":
      return args.includes("--ff-only") ? t("Fast-forward to '{0}'", last) : t("Merge '{0}'", last);
    case "rebase":
      return args.includes("-i") ? t("Clean up commits") : t("Rebase onto '{0}'", last);
    case "reset":
      return `Reset(${(args[1] ?? "").replace(/^--/, "")})`;
    case "cherry-pick":
      return "Cherry-pick";
    case "revert":
      return "Revert";
    case "pull":
      return "Pull";
    case "fetch":
      return t("Fast-forward");
    case "branch":
      return args.includes("-d") || args.includes("-D") ? t("Delete branch '{0}'", last) : t("Create branch '{0}'", args[1] ?? last);
    case "tag":
      return args.includes("-d") ? t("Delete tag '{0}'", last) : t("Create tag");
    case "worktree":
      return t("Create worktree");
    default:
      return `git ${args[0] ?? ""}`;
  }
}
