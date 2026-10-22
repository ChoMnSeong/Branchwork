import { ArrowDown, ArrowUp, ChevronDown, FolderOpen, GitBranch, GitPullRequestArrow, PackageOpen, RefreshCcw, SquarePen, SquareTerminal } from "lucide-react";
import { agentKind, agents } from "../lib/agents";
import { recents } from "../lib/settings";
import { basename, displayPath, samePath } from "../lib/env";
import { providerInfo, statusIsEmpty } from "../lib/models";
import { useObserve } from "../lib/observable";
import type { RepoStore } from "../lib/repo";
import { workspace } from "../lib/workspace";
import { showMenuBelow, Spinner, tip, type MenuItem } from "./shared/ui";

/** 툴바 버튼은 아이콘만. 무슨 버튼인지는 마우스를 올리면 설명 풍선으로 보여 준다. */
export function Toolbar({ store }: { store: RepoStore }) {
  useObserve(store);
  const st = store.status;
  const sheet = (s: RepoStore["sheet"]) => {
    store.sheet = s;
    store.changed();
  };
  const split = (main: React.ReactNode, mainTip: string, onMain: () => void, items: () => MenuItem[], disabled = false) => (
    <div className="tool-group">
      <button className="tool" data-tip={mainTip} disabled={disabled} onClick={onMain}>
        {main}
      </button>
      <button className="tool caret" disabled={disabled} onClick={(e) => showMenuBelow(e.currentTarget.parentElement!, items())} data-tip="더 보기">
        <ChevronDown size={12} />
      </button>
    </div>
  );

  return (
    <div className="toolbar">
      <div className="tool-group">
        <button
          className="tool"
          data-tip={tip("저장소", "다른 저장소 열기·복제, 최근에 연 저장소, 탭 닫기")}
          onClick={(e) =>
            showMenuBelow(e.currentTarget, [
              ...recents()
                .filter((p) => !samePath(p, store.path))
                .slice(0, 10)
                .map((p): MenuItem => ({ label: `${basename(p)}   —   ${displayPath(p)}`, onClick: () => void store.openOrReport(p) })),
              "divider",
              { label: "저장소 열기…", shortcut: "Ctrl+O", onClick: () => void store.pickAndOpen() },
              { label: "저장소 복제…", shortcut: "Ctrl+Shift+O", onClick: () => sheet({ kind: "clone" }) },
              "divider",
              { label: "탭 닫기", shortcut: "Ctrl+W", onClick: () => workspace.closeTab(store.id) },
            ])
          }
        >
          <FolderOpen size={16} />
          <ChevronDown size={11} />
        </button>
      </div>
      <div className="title grow">
        <span className="name ellipsis">{store.name}</span>
        <span className="sub ellipsis">{store.subtitle}</span>
      </div>

      {store.busy && (
        <span className="busy">
          <Spinner size={13} /> {store.busy}
        </span>
      )}

      <div className="tool-group">
        <button
          className="tool"
          onClick={() => store.select({ kind: "wip" })}
          data-tip={tip(
            "작업 중인 변경",
            statusIsEmpty(st) ? "수정한 파일이 없습니다. 파일을 고치면 여기서 스테이지하고 커밋합니다." : `수정한 파일 ${store.wipCount}개 — 스테이지하고 커밋합니다.`,
            "Ctrl+1",
          )}
        >
          <SquarePen size={16} />
          {!statusIsEmpty(st) && <span className="badge-num">{store.wipCount}</span>}
        </button>
        <button className="tool" onClick={() => void store.fetch()} data-tip={tip("Fetch", "모든 원격에서 새 커밋과 브랜치를 가져옵니다. 내 브랜치는 바꾸지 않습니다.", "Ctrl+Shift+F")}>
          <RefreshCcw size={16} />
        </button>
      </div>

      {split(
        <>
          <ArrowDown size={16} />
          {st.behind > 0 && <span className="badge-num">{st.behind}</span>}
        </>,
        tip(
          "Pull",
          (!st.upstream
            ? "이 브랜치는 원격 추적 브랜치가 없어 Pull 할 곳이 없습니다(먼저 Push 하면 생깁니다)."
            : st.behind > 0
              ? `원격의 새 커밋 ${st.behind}개를 현재 브랜치로 가져옵니다.`
              : "현재 브랜치를 원격과 맞춥니다(지금은 받을 커밋 없음).") + " ▾ 에서 merge·rebase 방식을 고를 수 있습니다.",
          "Ctrl+Shift+L",
        ),
        () => void store.pull(),
        () => [
          { label: "Pull (git 설정대로)", onClick: () => void store.pull("standard") },
          { label: "Pull — fast-forward 만", onClick: () => void store.pull("fastForward") },
          { label: "Pull — merge", onClick: () => void store.pull("merge") },
          { label: "Pull — rebase", onClick: () => void store.pull("rebase") },
        ],
        !st.upstream,
      )}

      {split(
        <>
          <ArrowUp size={16} />
          {st.ahead > 0 && <span className="badge-num">{st.ahead}</span>}
        </>,
        tip(
          "Push",
          (!st.upstream
            ? "현재 브랜치를 원격에 처음 올리고 추적을 연결합니다."
            : st.ahead > 0
              ? `올리지 않은 커밋 ${st.ahead}개를 원격에 올립니다.`
              : "현재 브랜치를 원격에 올립니다(지금은 올릴 커밋 없음).") + " ▾ 에서 Force push.",
          "Ctrl+Shift+P",
        ),
        () => void store.push(),
        () => [
          { label: "Push", onClick: () => void store.push() },
          {
            label: "Force push (with lease)…",
            onClick: () =>
              store.ask({
                title: "강제로 Push 할까요?",
                message: "원격 브랜치가 내가 마지막으로 본 상태일 때만 덮어씁니다(--force-with-lease).",
                actionTitle: "Force push",
                action: () => store.push(true),
              }),
          },
        ],
      )}

      {split(
        <GitBranch size={16} />,
        tip("브랜치", "지금 위치에서 새 브랜치를 만듭니다. ▾ 에서 새 워크트리, 에이전트(Claude Code·Codex·Gemini) 실행.", "Ctrl+Shift+B"),
        () => store.requestNewBranch(),
        () => [
          { label: "새 브랜치…", shortcut: "Ctrl+Shift+B", onClick: () => store.requestNewBranch() },
          { label: "새 워크트리…", shortcut: "Ctrl+Alt+W", onClick: () => sheet({ kind: "addWorktree", branch: null, start: null }) },
          "divider",
          { label: `여기서 ${agentKind(agents.defaultKind).title} 실행`, onClick: () => store.path && void store.startAgent(store.path) },
          { label: "에이전트 세션 시작…", shortcut: "Ctrl+Alt+K", onClick: () => sheet({ kind: "startAgent", path: store.path }) },
        ],
      )}

      {store.target && (
        <div className="tool-group">
          <button
            className="tool"
            disabled={!store.headBranch}
            onClick={() => sheet({ kind: "createPullRequest" })}
            data-tip={tip(
              `새 ${providerInfo[store.target.provider].requestShort}`,
              `현재 브랜치(${store.headBranch ?? "-"})로 ${providerInfo[store.target.provider].requestName}를 만듭니다. 필요하면 먼저 Push 합니다.`,
            )}
          >
            <GitPullRequestArrow size={16} />
          </button>
        </div>
      )}

      {split(
        <>
          <PackageOpen size={16} />
          {store.stashes.length > 0 && <span className="badge-num">{store.stashes.length}</span>}
        </>,
        tip(
          "Stash",
          (statusIsEmpty(st) ? "가장 최근에 보관한 변경을 꺼냅니다(Pop)." : "커밋하지 않은 변경을 임시로 보관합니다.") +
            (store.stashes.length ? ` 보관된 stash ${store.stashes.length}개.` : "") +
            " ▾ 에서 Stash·Pop 선택.",
          "Ctrl+Shift+S",
        ),
        () => (!statusIsEmpty(st) ? sheet({ kind: "stash" }) : void store.stashPop()),
        () => [
          { label: "Stash… (변경 임시 보관)", disabled: statusIsEmpty(st), onClick: () => sheet({ kind: "stash" }) },
          { label: "Pop (가장 최근 stash 꺼내기)", disabled: !store.stashes.length, onClick: () => void store.stashPop() },
        ],
        statusIsEmpty(st) && !store.stashes.length,
      )}

      <div className="tool-group">
        <button
          className={`tool ${store.showTerminal ? "on" : ""}`}
          onClick={() => store.toggleTerminal()}
          data-tip={tip(
            "터미널",
            store.showTerminal ? "아래 터미널 패널을 숨깁니다. 셸은 계속 실행됩니다." : "그래프 아래에 이 저장소 폴더의 터미널을 엽니다. git 명령을 치면 그래프가 바로 갱신됩니다.",
            "Ctrl+`",
          )}
        >
          <SquareTerminal size={16} />
        </button>
      </div>
    </div>
  );
}
