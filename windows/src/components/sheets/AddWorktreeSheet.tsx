import { useEffect, useState } from "react";
import { agentKind, agents } from "../../lib/agents";
import { displayPath, joinPath, slash } from "../../lib/env";
import { validBranchName } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { RepoStore } from "../../lib/repo";
import { Button, Checkbox, Segmented } from "../shared/ui";
import { Frame, Row } from "./Frame";

export function AddWorktreeSheet({ store, close, presetBranch, start }: { store: RepoStore; close: () => void; presetBranch: string | null; start: string | null }) {
  const used = new Set(store.worktrees.map((w) => w.branch).filter(Boolean));
  const free = store.localBranches.map((b) => b.name).filter((n) => !used.has(n));
  const [createNew, setCreateNew] = useState(!presetBranch);
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(presetBranch ?? free[0] ?? "");
  const [path, setPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [runClaude, setRunClaude] = useState(false);
  const [task, setTask] = useState("");
  const [exists, setExists] = useState(false);
  const branch = createNew ? name.trim() : existing;

  useEffect(() => {
    if (!pathEdited && branch) setPath(store.defaultWorktreePath(branch));
  }, [branch, pathEdited, store]);
  useEffect(() => {
    if (!path.trim()) return;
    void ipc.exists(path).then(setExists);
  }, [path]);

  const valid = validBranchName(branch) && !!path.trim() && !exists;
  return (
    <Frame
      title="새 워크트리"
      confirm="만들기"
      width={580}
      canConfirm={valid}
      close={close}
      onConfirm={() => void store.addWorktree(path, branch, createNew, createNew ? start : null, runClaude, task)}
      leftFooter="한 브랜치는 워크트리 하나에서만 체크아웃할 수 있습니다."
    >
      <Segmented
        stretch
        value={createNew ? "new" : "existing"}
        onChange={(v) => setCreateNew(v === "new")}
        options={[
          { value: "new", label: "새 브랜치 만들기" },
          { value: "existing", label: "기존 브랜치" },
        ]}
      />
      {createNew ? (
        <>
          <Row label="새 브랜치 이름">
            <input className="input" autoFocus value={name} placeholder="feature/새-작업" onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </Row>
          <Row label="시작 위치">
            <span className="mono">{start ? start.slice(0, 10) : store.headBranch ?? "HEAD"}</span>
          </Row>
        </>
      ) : (
        <Row label="체크아웃할 브랜치">
          <select className="select" value={existing} onChange={(e) => setExisting(e.target.value)}>
            {free.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="위치">
        <input
          className="input"
          value={displayPath(path)}
          onChange={(e) => {
            setPath(slash(e.target.value));
            setPathEdited(true);
          }}
          spellCheck={false}
        />
        <Button
          size="small"
          onClick={() =>
            void ipc.pickFolder("이 안에 워크트리를 만듭니다").then((p) => {
              if (p) {
                setPath(joinPath(slash(p), branch ? branch.replace(/\//g, "-") : "worktree"));
                setPathEdited(true);
              }
            })
          }
        >
          변경…
        </Button>
      </Row>
      {exists && <span className="error-text">이 위치에 이미 폴더가 있습니다.</span>}
      <Row label="">
        <Checkbox checked={runClaude} onChange={setRunClaude} label={`만든 뒤 ${agentKind(agents.defaultKind).title.split(" (")[0]} 실행`} />
      </Row>
      {runClaude && (
        <textarea className="textarea" style={{ height: 64 }} value={task} placeholder="에이전트에게 맡길 작업 (선택) — 예: 로그인 화면에 비밀번호 찾기 추가" onChange={(e) => setTask(e.target.value)} />
      )}
    </Frame>
  );
}
