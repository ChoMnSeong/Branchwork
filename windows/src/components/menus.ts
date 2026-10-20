import { short, type Branch, type Commit, type RefLabel, isWIP } from "../lib/models";
import type { RepoStore } from "../lib/repo";
import type { MenuItem } from "./ui";

/** 브랜치·태그 배지 우클릭 메뉴(그래프 배지와 커밋 메뉴에서 같이 쓴다) */
export function refMenu(store: RepoStore, ref: RefLabel): MenuItem[] {
  if (ref.kind === "local" || ref.kind === "remote") {
    const b = store.branchNamed(ref.name);
    if (!b) return [];
    return b.isRemote ? remoteBranchMenu(store, b) : localBranchMenu(store, b);
  }
  if (ref.kind === "tag") {
    const t = store.tags.find((x) => x.name === ref.name);
    if (!t) return [];
    return [
      { label: "이 태그로 이동", onClick: () => store.reveal(t.target) },
      { label: "태그 Push", onClick: () => void store.pushTag(t) },
      { label: "이름 복사", onClick: () => store.copy(t.name) },
      "divider",
      { label: "태그 삭제…", danger: true, onClick: () => store.deleteTag(t) },
    ];
  }
  return [];
}

export function localBranchMenu(store: RepoStore, b: Branch): MenuItem[] {
  const current = store.headBranch;
  const w = store.worktreeUsing(b.name);
  const items: MenuItem[] = [{ label: "체크아웃", disabled: b.isCurrent, onClick: () => void store.checkout(b) }];
  if (current && !b.isCurrent) {
    items.push(
      { label: `'${b.name}'을(를) '${current}'에 머지`, onClick: () => void store.merge(b.name) },
      { label: `'${current}'을(를) '${b.name}' 위로 리베이스`, onClick: () => void store.rebase(b.name) },
    );
  }
  items.push(
    "divider",
    { label: "여기서 새 브랜치…", onClick: () => store.requestNewBranch(b.target, b.name) },
    {
      label: "새 워크트리에서 체크아웃…",
      disabled: b.isCurrent || !!w,
      onClick: () => {
        store.sheet = { kind: "addWorktree", branch: b.name, start: null };
        store.changed();
      },
    },
  );
  if (w) {
    items.push(
      { label: "이 브랜치의 워크트리 열기", onClick: () => void store.openOrReport(w.path) },
      { label: "워크트리에서 에이전트 실행", onClick: () => void store.startAgent(w.path) },
    );
  }
  items.push(
    { label: "Push", onClick: () => void store.pushBranch(b) },
    { label: "이름 복사", onClick: () => store.copy(b.name) },
    "divider",
    { label: "삭제…", danger: true, disabled: b.isCurrent, onClick: () => store.confirmDelete(b) },
    { label: "강제 삭제…", danger: true, disabled: b.isCurrent, onClick: () => store.confirmForceDelete(b) },
  );
  return items;
}

export function remoteBranchMenu(store: RepoStore, b: Branch): MenuItem[] {
  const current = store.headBranch;
  const items: MenuItem[] = [{ label: "체크아웃 (로컬 추적 브랜치)", onClick: () => void store.checkout(b) }];
  if (current) {
    items.push(
      { label: `'${b.name}'을(를) '${current}'에 머지`, onClick: () => void store.merge(b.name) },
      { label: `'${current}'을(를) '${b.name}' 위로 리베이스`, onClick: () => void store.rebase(b.name) },
    );
  }
  items.push(
    "divider",
    { label: "여기서 새 브랜치…", onClick: () => store.requestNewBranch(b.target, b.name) },
    { label: "이름 복사", onClick: () => store.copy(b.name) },
    "divider",
    { label: "원격에서 삭제…", danger: true, onClick: () => store.confirmDelete(b) },
  );
  return items;
}

/** 그래프 행 우클릭 메뉴 */
export function commitMenu(store: RepoStore, c: Commit): MenuItem[] {
  const sheet = (s: RepoStore["sheet"]) => {
    store.sheet = s;
    store.changed();
  };
  if (isWIP(c)) {
    return [
      { label: "모두 스테이지", onClick: () => void store.stageAll() },
      { label: "Stash…", onClick: () => sheet({ kind: "stash" }) },
      "divider",
      { label: "모든 변경 버리기…", danger: true, onClick: () => store.confirmDiscardAll() },
    ];
  }
  const items: MenuItem[] = [];
  const branches = (store.refsByCommit.get(c.id) ?? []).filter((r) => r.kind === "local" || r.kind === "remote");
  for (const r of branches) items.push({ label: `브랜치 '${r.name}'`, submenu: refMenu(store, r) });
  if (branches.length) items.push("divider");
  const current = store.headBranch;
  if (current && c.id !== store.headHash) {
    items.push(
      { label: `이 커밋을 '${current}'에 머지`, onClick: () => void store.merge(c.id) },
      { label: `'${current}'을(를) 이 커밋 위로 리베이스`, onClick: () => void store.rebase(c.id) },
      "divider",
    );
  }
  items.push(
    { label: "여기서 새 브랜치…", onClick: () => store.requestNewBranch(c.id, short(c.id)) },
    { label: "여기에 태그…", onClick: () => sheet({ kind: "tag", sha: c.id }) },
    { label: "여기서 워크트리 만들기…", onClick: () => sheet({ kind: "addWorktree", branch: null, start: c.id }) },
    "divider",
    { label: "이 커밋 체크아웃 (분리된 HEAD)", onClick: () => void store.checkoutDetached(c.id) },
    { label: "Cherry-pick", disabled: c.id === store.headHash, onClick: () => void store.cherryPick(c.id) },
    { label: "Revert (되돌리는 커밋 만들기)", onClick: () => void store.revert(c.id) },
  );
  if (store.headBranch) {
    items.push({
      label: "현재 브랜치를 여기로 Reset",
      submenu: [
        { label: "Soft — 변경은 스테이지된 상태로 유지", onClick: () => store.reset(c.id, "soft") },
        { label: "Mixed — 변경은 작업 트리에 유지", onClick: () => store.reset(c.id, "mixed") },
        { label: "Hard — 변경까지 모두 버림…", danger: true, onClick: () => store.reset(c.id, "hard") },
      ],
    });
  }
  items.push("divider", { label: "SHA 복사", onClick: () => store.copy(c.id) }, { label: "메시지 복사", onClick: () => store.copy(c.subject) });
  return items;
}
