import { GitBranch, House, Pencil, Plus, Sparkles, Zap } from "lucide-react";
import { useEffect } from "react";
import { agents, agentStatusTitle, type AgentSession, type AgentStatus } from "../lib/agents";
import { displayPath, samePath } from "../lib/env";
import { shortDate } from "../lib/format";
import { statsClean, type Worktree, type WorktreeStats } from "../lib/models";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { ipc } from "../lib/ipc";
import { Button, IconButton, showContextMenu } from "./ui";

/** 사이드바 '에이전트' 탭: 워크트리 카드 + 그 안에서 도는 Claude Code 세션 */
export function AgentsPanel({ store }: { store: RepoStore }) {
  useObserve(agents);
  const paths = store.worktrees.map((w) => w.path).join("|");
  useEffect(() => {
    // 다른 워크트리는 파일 감시 대상이 아니라 몇 초마다 다시 센다
    void store.refreshWorktreeStats();
    const t = setInterval(() => void store.refreshWorktreeStats(), 5000);
    return () => clearInterval(t);
  }, [store, paths]);

  const others = agents.sessions.filter((s) => !store.worktrees.some((w) => samePath(w.path, s.path)) && s.status !== "ended");
  const sheet = (s: RepoStore["sheet"]) => {
    store.sheet = s;
    store.changed();
  };
  return (
    <div className="side-scroll col" style={{ gap: 10, padding: 10 }}>
      <div className="row">
        <span style={{ fontWeight: 600 }}>워크트리</span>
        <span className="muted">{store.worktrees.length}</span>
        <span className="spacer" />
        {agents.sessions.some((s) => s.status === "ended") && (
          <button className="link" onClick={() => void agents.clearEnded()}>
            종료된 세션 지우기
          </button>
        )}
        <IconButton small icon={<Plus size={13} />} tip="새 워크트리" onClick={() => sheet({ kind: "addWorktree", branch: null, start: null })} />
      </div>
      <div className="row">
        <Button size="large" className="grow" onClick={() => sheet({ kind: "startAgent", path: null })} tip="Claude Code 세션 시작|작업할 워크트리와 맡길 일을 고릅니다">
          <Sparkles size={14} /> 세션 시작
        </Button>
        <Button size="large" onClick={() => store.path && void store.startClaude(store.path)} tip="지금 이 워크트리에서 바로 시작">
          <Zap size={14} />
        </Button>
      </div>
      {store.worktrees.map((w) => (
        <WorktreeCard key={w.path} store={store} worktree={w} stats={store.worktreeStats[w.path]} sessions={agents.sessionsIn(w.path)} isCurrent={samePath(w.path, store.path)} />
      ))}
      {others.length > 0 && (
        <>
          <span className="muted" style={{ fontWeight: 600, marginTop: 6 }}>
            다른 폴더의 세션
          </span>
          {others.map((s) => (
            <SessionRow key={s.id} store={store} session={s} showPath />
          ))}
        </>
      )}
      <span className="faint" style={{ fontSize: 11.5 }}>
        여기서 시작한 세션은 아래 터미널 탭에서 돌고, 상태가 여기 표시됩니다. 세션을 누르면 그 터미널로 이동합니다.
      </span>
    </div>
  );
}

function WorktreeCard({ store, worktree: w, stats, sessions, isCurrent }: { store: RepoStore; worktree: Worktree; stats?: WorktreeStats; sessions: AgentSession[]; isCurrent: boolean }) {
  return (
    <div
      className={`wt-card ${isCurrent ? "current" : ""}`}
      onDoubleClick={() => !isCurrent && void store.openOrReport(w.path)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          {
            label: "Claude Code 세션 시작…",
            onClick: () => {
              store.sheet = { kind: "startAgent", path: w.path };
              store.changed();
            },
          },
          { label: "Branchwork 에서 열기", disabled: isCurrent, onClick: () => void store.openOrReport(w.path) },
          { label: "탐색기에서 보기", onClick: () => void ipc.reveal(w.path) },
          { label: "아래 터미널에서 열기", onClick: () => store.newTerminal(w.path) },
          { label: "외부 터미널에서 열기", onClick: () => void ipc.openTerminal(w.path) },
          "divider",
          { label: "워크트리 제거…", danger: true, disabled: w.isMain || isCurrent, onClick: () => store.confirmRemove(w) },
        ])
      }
    >
      <div className="row">
        <span className="muted" style={{ display: "inline-flex" }}>
          {w.isMain ? <House size={14} /> : <GitBranch size={14} />}
        </span>
        <span className="grow" style={{ fontWeight: 600, wordBreak: "break-all" }} data-tip={displayPath(w.path)}>
          {w.branch ?? "분리된 HEAD"}
        </span>
        <IconButton
          small
          className="hover-only"
          icon={<Sparkles size={13} />}
          tip="이 워크트리에서 Claude Code 세션 시작"
          onClick={() => {
            store.sheet = { kind: "startAgent", path: w.path };
            store.changed();
          }}
        />
      </div>
      {stats && (
        <div className="row" style={{ gap: 8, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {statsClean(stats) && !stats.ahead && !stats.behind && <span className="muted">변경 없음</span>}
          {stats.added > 0 && (
            <span style={{ color: "var(--green)" }} data-tip="새 파일">
              +{stats.added}
            </span>
          )}
          {stats.modified > 0 && (
            <span className="row" style={{ color: "var(--orange)", gap: 2 }} data-tip="수정한 파일">
              <Pencil size={11} />
              {stats.modified}
            </span>
          )}
          {stats.deleted > 0 && (
            <span style={{ color: "var(--red)" }} data-tip="삭제한 파일">
              −{stats.deleted}
            </span>
          )}
          {stats.conflicted > 0 && (
            <span style={{ color: "var(--red)" }} data-tip="충돌">
              !{stats.conflicted}
            </span>
          )}
          {stats.ahead > 0 && (
            <span style={{ color: "var(--accent)" }} data-tip="원격에 올리지 않은 커밋">
              ↑{stats.ahead}
            </span>
          )}
          {stats.behind > 0 && (
            <span style={{ color: "var(--orange)" }} data-tip="원격에서 받지 않은 커밋">
              ↓{stats.behind}
            </span>
          )}
        </div>
      )}
      {sessions.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--border)" }} />
          {sessions.map((s) => (
            <SessionRow key={s.id} store={store} session={s} showPath={false} />
          ))}
        </>
      )}
    </div>
  );
}

const dotColor: Record<AgentStatus, string> = {
  working: "var(--accent)",
  permission: "var(--red)",
  starting: "var(--orange)",
  waiting: "var(--orange)",
  ended: "var(--text-3)",
};

function SessionRow({ store, session: s, showPath }: { store: RepoStore; session: AgentSession; showPath: boolean }) {
  const can = agents.canFocus(s);
  return (
    <div
      className="session-row"
      onClick={() => can && agents.focus(s)}
      data-tip={s.status === "ended" ? "끝난 세션" : "눌러서 그 터미널로 이동"}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: "터미널로 이동", disabled: !can, onClick: () => agents.focus(s) },
          { label: "같은 곳에서 새 세션", onClick: () => void store.startClaude(s.path) },
          "divider",
          s.status === "ended"
            ? { label: "목록에서 지우기", onClick: () => void agents.remove(s.id) }
            : {
                label: "세션 끝내기…",
                danger: true,
                onClick: () =>
                  store.ask({ title: "Claude Code 세션을 끝낼까요?", message: s.task || s.path, actionTitle: "끝내기", action: () => agents.stop(s) }),
              },
        ])
      }
    >
      <span className={`dot ${s.status === "working" ? "pulse" : ""}`} style={{ background: dotColor[s.status], marginTop: 5 }} />
      <span className="col grow">
        <span className="row">
          <span style={{ fontWeight: 500 }}>{agentStatusTitle[s.status]}</span>
          {s.detail && s.status !== "ended" && <span className="muted ellipsis">· {s.detail}</span>}
        </span>
        {s.task && (
          <span className="muted" style={{ fontSize: 11.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {s.task}
          </span>
        )}
        <span className="faint ellipsis" style={{ fontSize: 11 }}>
          {(showPath ? displayPath(s.path) + " · " : "") + shortDate(s.updated)}
        </span>
      </span>
    </div>
  );
}
