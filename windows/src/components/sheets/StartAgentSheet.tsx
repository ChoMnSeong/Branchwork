import { useEffect, useState } from "react";
import { agentKind, agentKinds, agents, type AgentKind } from "../../lib/agents";
import { tools } from "../../lib/tools";
import { displayPath } from "../../lib/env";
import { validBranchName } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Segmented } from "../shared/ui";
import { Frame, Row } from "./Frame";

export function StartAgentSheet({ store, close, presetPath }: { store: RepoStore; close: () => void; presetPath: string | null }) {
  useObserve(tools);
  /** 빈 문자열 = 새 워크트리 만들기 */
  const [target, setTarget] = useState(presetPath ?? store.path ?? store.worktrees[0]?.path ?? "");
  const [kind, setKind] = useState<AgentKind>(agents.defaultKind);
  const [newBranch, setNewBranch] = useState("");
  const [task, setTask] = useState("");
  const [mode, setMode] = useState("");
  const [exists, setExists] = useState(false);
  const info = agentKind(kind);
  const found = tools.available(info.tool);
  const wtPath = newBranch.trim() ? store.defaultWorktreePath(newBranch.trim()) : "";
  useEffect(() => {
    if (wtPath) void ipc.exists(wtPath).then(setExists);
  }, [wtPath]);
  useEffect(() => setMode(""), [kind]);
  const validBranch = validBranchName(newBranch) && !exists;
  return (
    <Frame
      title="에이전트 세션 시작"
      confirm="시작"
      width={580}
      canConfirm={found && (!!target || validBranch)}
      close={close}
      leftFooter="아래 터미널의 새 탭에서 실행되고, 상태는 에이전트 탭에 표시됩니다."
      onConfirm={() =>
        void (async () => {
          const m = mode || null;
          if (!target) {
            if (await store.addWorktree(wtPath, newBranch.trim(), true, null, false, "")) await store.startAgent(wtPath, task, m, kind);
          } else await store.startAgent(target, task, m, kind);
        })()
      }
    >
      <Row label="에이전트">
        <Segmented
          value={kind}
          onChange={setKind}
          options={agentKinds.map((k) => ({
            value: k.id,
            label: (
              <span style={{ opacity: tools.available(k.tool) ? 1 : 0.45 }}>
                {k.title.split(" (")[0]}
                {tools.wsl(k.tool) ? " · WSL" : ""}
              </span>
            ),
            tip: tools.available(k.tool) ? `${k.title}|${tools.describe(k.tool)}` : `${k.title} — 찾지 못함(설정 > 도구에서 불러오기·WSL 에서 찾기)`,
          }))}
        />
      </Row>
      {!found && <span className="error-text">{info.title} 실행 파일을 찾지 못했습니다. 설정 &gt; 도구에서 불러오거나, WSL 에 설치했다면 'WSL 에서 찾기'를 누르세요.</span>}
      {found && tools.wsl(info.tool) && <span className="hint">WSL({tools.wsl(info.tool)!.distro}) 안에서 실행합니다. 작업 폴더는 리눅스 경로로 바꿔 엽니다.</span>}
      <Row label="작업할 곳">
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {store.worktrees.map((w) => (
            <option key={w.path} value={w.path}>
              {(w.branch ?? "분리된 HEAD") + (w.path === store.path ? "  (지금 연 곳)" : "")}
            </option>
          ))}
          <option value="">새 워크트리 만들기…</option>
        </select>
      </Row>
      {!target && (
        <>
          <Row label="새 브랜치 이름">
            <input className="input" autoFocus value={newBranch} placeholder="feature/ai-작업" onChange={(e) => setNewBranch(e.target.value)} spellCheck={false} />
          </Row>
          <Row label="위치">
            <span className="ellipsis muted">{wtPath ? displayPath(wtPath) : "-"}</span>
          </Row>
        </>
      )}
      <Row label="맡길 작업">
        <textarea className="textarea" style={{ height: 80 }} value={task} placeholder="예: 로그인 실패 시 잠금 처리 추가하고 테스트까지" onChange={(e) => setTask(e.target.value)} />
      </Row>
      <Row label="권한 모드">
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
          {info.modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>
    </Frame>
  );
}
