import { ChevronDown, CircleCheck, Cloud, CloudAlert, Folder, FolderOpen, GitBranch, Lock, Plus, RefreshCw, Tag as TagIcon, TriangleAlert, Archive } from "lucide-react";
import { useState, type ReactNode } from "react";
import { accounts } from "../lib/accounts";
import { agents, isActiveStatus } from "../lib/agents";
import { drag } from "../lib/drag";
import { displayPath, isTemporaryPath, samePath } from "../lib/env";
import { ipc } from "../lib/ipc";
import { branchRemote, branchShort, providerInfo, short, type Branch, type RepoTarget } from "../lib/models";
import { useObserve } from "../lib/observable";
import { branchPayload, type RepoStore } from "../lib/repo";
import { settings } from "../lib/settings";
import { AgentsPanel } from "./AgentsPanel";
import { localBranchMenu, remoteBranchMenu } from "./menus";
import { IconButton, Segmented, showContextMenu, showMenuBelow, Spinner, tip, type MenuItem } from "./ui";

export function Sidebar({ store, openSettings }: { store: RepoStore; openSettings: () => void }) {
  useObserve(store);
  useObserve(settings);
  useObserve(agents);
  const mode = settings.get<"list" | "agents">("sidebarMode", "list");
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
          ]}
        />
      </div>
      {mode === "agents" ? <AgentsPanel store={store} /> : <BranchList store={store} openSettings={openSettings} />}
    </>
  );
}

function Section({ id, title, count, actions, children, defaultOpen = true }: { id: string; title: string; count?: number; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  useObserve(settings);
  const collapsed = settings.get<string[]>("collapsedSections", defaultOpen ? [] : [id]);
  const isCollapsed = collapsed.includes(id);
  const toggle = () => settings.set("collapsedSections", isCollapsed ? collapsed.filter((x) => x !== id) : [...collapsed, id]);
  return (
    <div className="side-section">
      <div className={`side-head ${isCollapsed ? "collapsed" : ""}`}>
        <span className="row grow" onClick={toggle}>
          <ChevronDown size={12} className="chev" />
          <span className="ellipsis">{title}</span>
          {count !== undefined && <span style={{ fontWeight: 500 }}>{count}</span>}
        </span>
        {actions}
      </div>
      {!isCollapsed && children}
    </div>
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
      <span className="ellipsis grow">{label}</span>
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

function PullRequestSection({ store, target, openSettings }: { store: RepoStore; target: RepoTarget; openSettings: () => void }) {
  useObserve(accounts);
  const info = providerInfo[target.provider];
  const current = store.hostingAccount;
  const candidates = accounts.candidates(target);
  const st = store.prState;
  return (
    <Section
      id="prs"
      title={st.kind === "loaded" ? `${info.requestsTitle}` : info.requestsTitle}
      count={st.kind === "loaded" ? store.pullRequests.length : undefined}
      actions={
        <>
          {current && (
            <button
              className="link"
              style={{ color: "var(--text-2)", fontWeight: 500 }}
              data-tip={candidates.length > 1 ? "이 저장소에 쓸 계정 고르기" : "이 저장소에 쓰는 계정"}
              onClick={(e) =>
                showMenuBelow(e.currentTarget, [
                  ...candidates.map((a): MenuItem => ({ label: `@${a.username}`, checked: a.id === current.id, onClick: () => store.useAccount(a) })),
                  "divider",
                  { label: "계정 추가…", onClick: openSettings },
                ])
              }
            >
              @{current.username} ▾
            </button>
          )}
          <IconButton small icon={<RefreshCw size={12} />} tip="목록 새로 고침" onClick={() => void store.loadPullRequests()} />
          <IconButton
            small
            icon={<Plus size={13} />}
            tip={`현재 브랜치로 새 ${info.requestShort}`}
            disabled={!store.headBranch}
            onClick={() => {
              store.sheet = { kind: "createPullRequest" };
              store.changed();
            }}
          />
        </>
      }
    >
      <div style={{ padding: "0 6px" }}>
        {st.kind === "needsAccount" && (
          <div className="col" style={{ gap: 4, alignItems: "flex-start", padding: "2px 0 4px" }}>
            {accounts.accountsFor(target.provider)[0] && (
              <button className="link" onClick={() => void store.tryExistingAccounts()} data-tip="같은 서버가 다른 주소로 쓰이는 경우, 이미 연결한 계정이 그대로 통합니다">
                연결된 계정(@{accounts.accountsFor(target.provider)[0].username})으로 시도
              </button>
            )}
            <button className="link" onClick={openSettings}>
              {target.provider === "gitlab" ? `사내 GitLab(${target.host}) 계정 연결…` : "GitHub 계정 연결…"}
            </button>
          </div>
        )}
        {st.kind === "failed" && (
          <div className="error-text" style={{ fontSize: 11.5 }}>
            {st.message}
          </div>
        )}
        {st.kind === "loading" && !store.pullRequests.length && <Spinner size={12} />}
        {st.kind === "loaded" && !store.pullRequests.length && <div className="muted">열린 {info.requestShort} 없음</div>}
      </div>
      {store.pullRequests.map((pr) => (
        <div
          key={pr.number}
          className="side-row"
          style={{ alignItems: "flex-start", background: store.selection?.kind === "pullRequest" && store.selection.number === pr.number ? "var(--select)" : undefined }}
          onClick={() => store.select({ kind: "pullRequest", number: pr.number })}
          onContextMenu={(e) =>
            showContextMenu(e, [
              { label: "브랜치 체크아웃", onClick: () => void store.checkoutPullRequest(pr) },
              { label: "브라우저에서 열기", onClick: () => store.openUrl(pr.url) },
              { label: "링크 복사", onClick: () => store.copy(pr.url) },
            ])
          }
        >
          <span className="col grow">
            <span className="row">
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                #{pr.number}
              </span>
              <span className="ellipsis">{pr.title}</span>
            </span>
            <span className="row side-sub">
              {pr.isDraft && <span style={{ color: "var(--orange)", fontWeight: 600 }}>Draft</span>}
              <span className="ellipsis">
                {pr.source} → {pr.target}
              </span>
            </span>
          </span>
        </div>
      ))}
    </Section>
  );
}

function WorktreeSection({ store }: { store: RepoStore }) {
  return (
    <Section
      id="worktrees"
      title="워크트리"
      count={store.worktrees.length}
      actions={
        <>
          {store.worktrees.some((w) => w.prunable) && (
            <button className="link" onClick={() => void store.pruneWorktrees()}>
              정리
            </button>
          )}
          <IconButton
            small
            icon={<Plus size={13} />}
            tip="새 워크트리"
            onClick={() => {
              store.sheet = { kind: "addWorktree", branch: null, start: null };
              store.changed();
            }}
          />
        </>
      }
    >
      {store.worktrees.map((w) => {
        const current = samePath(w.path, store.path);
        return (
          <div
            key={w.path}
            className={`side-row ${current ? "current" : ""}`}
            style={{ alignItems: "flex-start" }}
            onDoubleClick={() => void store.openOrReport(w.path)}
            onContextMenu={(e) =>
              showContextMenu(e, [
                { label: "Branchwork 에서 열기", disabled: current, onClick: () => void store.openOrReport(w.path) },
                { label: "탐색기에서 보기", onClick: () => void ipc.reveal(w.path) },
                { label: "아래 터미널에서 열기", onClick: () => store.newTerminal(w.path) },
                { label: "외부 터미널에서 열기", onClick: () => void ipc.openTerminal(w.path) },
                { label: "Claude Code 실행", onClick: () => void store.startClaude(w.path) },
                { label: "경로 복사", onClick: () => store.copy(displayPath(w.path)) },
                "divider",
                { label: "제거…", danger: true, disabled: w.isMain || current, onClick: () => store.confirmRemove(w) },
                { label: "강제 제거…", danger: true, disabled: w.isMain || current, onClick: () => store.confirmRemove(w, true) },
              ])
            }
            data-tip="더블클릭: 새 탭에서 열기"
          >
            <span className="lead" style={{ marginTop: 2 }}>
              {current ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="col grow">
              <span className="ellipsis">{w.branch ?? `분리된 HEAD ${w.head ? short(w.head) : ""}`}</span>
              <span className="side-sub ellipsis" style={{ direction: "rtl", textAlign: "left" }}>
                <bdi>{displayPath(w.path)}</bdi>
              </span>
            </span>
            {isTemporaryPath(w.path) && !w.prunable && (
              <span className="chip-warn" data-tip="임시 폴더 안의 워크트리 — 재부팅하면 폴더가 지워져 깨질 수 있습니다">
                임시
              </span>
            )}
            {w.prunable ? (
              <span style={{ color: "var(--orange)" }} data-tip="폴더가 사라진 워크트리 — '정리'로 지울 수 있습니다">
                <TriangleAlert size={13} />
              </span>
            ) : (
              w.locked && (
                <span className="muted" data-tip="잠긴 워크트리">
                  <Lock size={12} />
                </span>
              )
            )}
          </div>
        );
      })}
    </Section>
  );
}
