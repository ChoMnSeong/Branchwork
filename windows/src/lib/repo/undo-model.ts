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
  if (before.headRef !== after.headRef) lines.push(`'${shortRef(before.headRef) ?? "분리된 HEAD"}'(으)로 돌아갑니다.`);
  if (before.headRef && before.refs[before.headRef] !== after.refs[before.headRef] && before.refs[before.headRef]) {
    lines.push(
      p.soft
        ? "커밋을 취소하고, 그 변경은 스테이지된 상태로 남깁니다."
        : `'${shortRef(before.headRef)}' 를 이전 커밋(${before.refs[before.headRef].slice(0, 7)})으로 되돌립니다. 커밋하지 않은 변경은 그대로 둡니다.`,
    );
  }
  for (const ref of [...new Set([...Object.keys(before.refs), ...Object.keys(after.refs)])].sort()) {
    if (ref === before.headRef) continue;
    const name = shortRef(ref);
    const kind = ref.startsWith("refs/tags/") ? "태그" : "브랜치";
    const old = before.refs[ref],
      now = after.refs[ref];
    if (!old && now) lines.push(`만든 ${kind} '${name}' 을(를) 지웁니다.`);
    else if (old && !now) lines.push(`지운 ${kind} '${name}' 을(를) ${old.slice(0, 7)} 에 되살립니다.`);
    else if (old && now && old !== now) lines.push(`${kind} '${name}' 을(를) ${old.slice(0, 7)} 로 되돌립니다.`);
  }
  return lines.join("\n");
}

export function undoTitle(args: string[], input: string | undefined, after: RefSnapshot): string {
  const last = args[args.length - 1] ?? "";
  switch (args[0]) {
    case "commit": {
      const subject = input?.split("\n")[0].trim() ?? "";
      return (args.includes("--amend") ? "커밋 고치기" : "커밋") + (subject ? ` '${subject}'` : "");
    }
    case "switch":
    case "checkout":
      if (args.includes("-c") || args.includes("-b")) return `브랜치 '${shortRef(after.headRef) ?? last}' 만들고 체크아웃`;
      return `'${shortRef(after.headRef) ?? last.slice(0, 7)}' 체크아웃`;
    case "merge":
      return args.includes("--ff-only") ? `'${last}' 까지 빨리 감기` : `'${last}' 머지`;
    case "rebase":
      return `'${last}' 위로 리베이스`;
    case "reset":
      return `Reset(${(args[1] ?? "").replace(/^--/, "")})`;
    case "cherry-pick":
      return "Cherry-pick";
    case "revert":
      return "Revert";
    case "pull":
      return "Pull";
    case "fetch":
      return "빨리 감기";
    case "branch":
      return args.includes("-d") || args.includes("-D") ? `브랜치 '${last}' 삭제` : `브랜치 '${args[1] ?? last}' 만들기`;
    case "tag":
      return args.includes("-d") ? `태그 '${last}' 삭제` : "태그 만들기";
    case "worktree":
      return "워크트리 만들기";
    default:
      return `git ${args[0] ?? ""}`;
  }
}
