import { Archive, ChevronDown, CircleCheck, Cloud, CloudAlert, EyeOff, Folder, FolderOpen, GitBranch, Pin, Tag as TagIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { agents, isActiveStatus } from "../../lib/agents";
import { drag } from "../../lib/drag";
import { displayPath, samePath } from "../../lib/env";
import { branchRemote, branchShort, type Branch } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import { branchPayload, type RepoStore } from "../../lib/repo";
import { settings } from "../../lib/settings";
import { AgentsPanel } from "./AgentsPanel";
import { CIPanel } from "./CIPanel";
import { localBranchMenu, remoteBranchMenu } from "../shared/menus";
import { Segmented, showContextMenu, tip } from "../shared/ui";
import { PullRequestSection } from "./PullRequestSection";
import { Section } from "./Section";
import { WorktreeSection } from "./WorktreeSection";

export function Sidebar({ store, openSettings }: { store: RepoStore; openSettings: () => void }) {
  useObserve(store);
  useObserve(settings);
  useObserve(agents);
  const mode = settings.get<"list" | "agents" | "ci">("sidebarMode", "list");
  const active = agents.sessions.filter((s) => isActiveStatus(s.status) && store.worktrees.some((w) => samePath(w.path, s.path))).length;
  return (
    <>
      <div style={{ padding: "8px 10px 4px" }}>
        <Segmented
          stretch
          value={mode}
          onChange={(v) => settings.set("sidebarMode", v)}
          options={[
            { value: "list", label: "목록" },
            { value: "agents", label: active ? `에이전트 ${active}` : "에이전트" },
            { value: "ci", label: "CI/CD", tip: "파이프라인·Actions|수동 작업 실행, 다시 실행, 취소, 배포 승인" },
          ]}
        />
      </div>
      {mode === "agents" ? <AgentsPanel store={store} /> : mode === "ci" ? <CIPanel store={store} openSettings={openSettings} /> : <BranchList store={store} openSettings={openSettings} />}
    </>
  );
}

/** 브랜치 이름의 첫 '/' 앞부분(feature, fix …)으로 묶은 폴더 */
function groupFolders(branches: Branch[], key: (b: Branch) => string) {
  const loose: Branch[] = [];
  const by = new Map<string, Branch[]>();
  for (const b of branches) {
    const k = key(b);
    const i = k.indexOf("/");
    if (i < 0) loose.push(b);
    else {
      const f = k.slice(0, i);
      by.set(f, [...(by.get(f) ?? []), b]);
    }
  }
  const folders: { name: string; branches: Branch[] }[] = [];
  for (const [name, list] of by) {
    if (list.length === 1) loose.push(list[0]);
    else folders.push({ name, branches: list });
  }
  const nat = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  loose.sort((a, b) => nat(key(a), key(b)));
  folders.sort((a, b) => nat(a.name, b.name));
  return { loose, folders };
}

const leaf = (n: string) => (n.includes("/") ? n.slice(n.indexOf("/") + 1) : n);

function BranchList({ store, openSettings }: { store: RepoStore; openSettings: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const h = store.headBranch;
    return new Set(h && h.includes("/") ? ["l:" + h.slice(0, h.indexOf("/"))] : []);
  });
  const toggle = (id: string) => {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setExpanded(s);
  };
  const locals = groupFolders(store.localBranches, (b) => b.name);
  const remoteGroups = new Map<string, Branch[]>();
  for (const b of store.remoteBranches) {
    const r = branchRemote(b) ?? "";
    remoteGroups.set(r, [...(remoteGroups.get(r) ?? []), b]);
  }

  const folder = (id: string, name: string, count: number, current: boolean, body: ReactNode, icon?: ReactNode) => (
    <div key={id}>
      <div className="side-row" onClick={() => toggle(id)}>
        <ChevronDown size={11} className="muted" style={{ transform: expanded.has(id) ? undefined : "rotate(-90deg)", flex: "none" }} />
        <span className="lead" style={{ color: current ? "var(--accent)" : undefined }}>
          {icon ?? (current || expanded.has(id) ? <FolderOpen size={14} /> : <Folder size={14} />)}
        </span>
        <span className="ellipsis grow">{name}</span>
        <span className="faint" style={{ fontSize: 11 }}>
          {count}
        </span>
      </div>
      {expanded.has(id) && <div style={{ paddingLeft: 14 }}>{body}</div>}
    </div>
  );

  return (
    <div className="side-scroll">
      {store.target && <PullRequestSection store={store} target={store.target} openSettings={openSettings} />}

      {store.localBranches.some((b) => store.isPinned(b)) && (
        <Section id="pinned" title="고정">
          {store.localBranches
            .filter((b) => store.isPinned(b))
            .map((b) => (
              <BranchRow key={"pin:" + b.name} store={store} branch={b} label={b.name} />
            ))}
        </Section>
      )}

      <Section id="local" title="로컬 브랜치" count={store.localBranches.length}>
        {locals.loose.map((b) => (
          <BranchRow key={b.name} store={store} branch={b} label={b.name} />
        ))}
        {locals.folders.map((f) =>
          folder(
            "l:" + f.name,
            f.name,
            f.branches.length,
            f.branches.some((b) => b.isCurrent),
            f.branches.map((b) => <BranchRow key={b.name} store={store} branch={b} label={leaf(b.name)} />),
          ),
        )}
      </Section>

      {store.worktrees.length > 1 && <WorktreeSection store={store} />}

      {store.remoteBranches.length > 0 && (
        <Section id="remote" title="원격" count={store.remoteBranches.length}>
          {[...remoteGroups.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([remote, list]) => {
              const g = groupFolders(list, branchShort);
              return folder(
                "r:" + remote,
                remote,
                list.length,
                false,
                <>
                  {g.loose.map((b) => (
                    <BranchRow key={b.name} store={store} branch={b} label={branchShort(b)} />
                  ))}
                  {g.folders.map((f) =>
                    folder(
                      `r:${remote}/${f.name}`,
                      f.name,
                      f.branches.length,
                      false,
                      f.branches.map((b) => <BranchRow key={b.name} store={store} branch={b} label={leaf(branchShort(b))} />),
                    ),
                  )}
                </>,
                <Cloud size={14} />,
              );
            })}
        </Section>
      )}

      {store.tags.length > 0 && (
        <Section id="tags" title="태그" count={store.tags.length} defaultOpen={false}>
          {store.tags.map((t) => (
            <div
              key={t.name}
              className="side-row"
              onClick={() => store.reveal(t.target)}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "이 태그로 이동", onClick: () => store.reveal(t.target) },
                  { label: "태그 Push", onClick: () => void store.pushTag(t) },
                  "divider",
                  { label: "태그 삭제…", danger: true, onClick: () => store.deleteTag(t) },
                ])
              }
            >
              <span className="lead">
                <TagIcon size={13} />
              </span>
              <span className="ellipsis">{t.name}</span>
            </div>
          ))}
        </Section>
      )}

      {store.stashes.length > 0 && (
        <Section id="stashes" title="스태시" count={store.stashes.length}>
          {store.stashes.map((s) => (
            <div
              key={s.ref}
              className="side-row"
              style={{ alignItems: "flex-start" }}
              onClick={() => store.reveal(s.hash)}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "적용 (Apply)", onClick: () => void store.stashApply(s) },
                  { label: "꺼내기 (Pop)", onClick: () => void store.stashPop(s) },
                  "divider",
                  { label: "버리기 (Drop)…", danger: true, onClick: () => store.stashDrop(s) },
                ])
              }
            >
              <span className="lead" style={{ marginTop: 3 }}>
                <Archive size={13} />
              </span>
              <span className="col grow">
                <span className="ellipsis">{s.message}</span>
                <span className="side-sub">{s.ref}</span>
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function BranchRow({ store, branch: b, label }: { store: RepoStore; branch: Branch; label: string }) {
  const w = !b.isRemote ? store.worktreeUsing(b.name) : null;
  return (
    <div
      className={`side-row ${b.isCurrent ? "current" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", branchPayload + b.name);
        e.dataTransfer.effectAllowed = "move";
        drag.payload = branchPayload + b.name;
      }}
      onDragEnd={() => (drag.payload = null)}
      onClick={() => store.reveal(b.target)}
      onDoubleClick={() => void store.checkout(b)}
      onContextMenu={(e) => showContextMenu(e, b.isRemote ? remoteBranchMenu(store, b) : localBranchMenu(store, b))}
      data-tip={tip(b.name, "클릭: 그래프에서 보기 · 더블클릭: 체크아웃 · 그래프의 다른 브랜치로 끌어 놓기: 머지·리베이스")}
    >
      <span className="lead">{b.isCurrent ? <CircleCheck size={14} /> : <GitBranch size={14} />}</span>
      <span className="ellipsis grow" style={store.isHidden(b) ? { color: "var(--text-2)" } : undefined}>
        {label}
      </span>
      {store.isPinned(b) && (
        <span className="muted" data-tip="맨 위에 고정한 브랜치" style={{ display: "inline-flex" }}>
          <Pin size={11} />
        </span>
      )}
      {store.isHidden(b) && (
        <span className="muted" data-tip="그래프에서 숨긴 브랜치 — 우클릭으로 다시 보이기" style={{ display: "inline-flex" }}>
          <EyeOff size={12} />
        </span>
      )}
      {w && (
        <span className="muted" data-tip={`워크트리에서 사용 중: ${displayPath(w.path)}`} style={{ display: "inline-flex" }}>
          <Folder size={12} />
        </span>
      )}
      {b.upstreamGone && (
        <span style={{ color: "var(--orange)", display: "inline-flex" }} data-tip="추적하던 원격 브랜치가 삭제됨">
          <CloudAlert size={13} />
        </span>
      )}
      {b.ahead > 0 && <span className="counter">↑{b.ahead}</span>}
      {b.behind > 0 && <span className="counter">↓{b.behind}</span>}
    </div>
  );
}
