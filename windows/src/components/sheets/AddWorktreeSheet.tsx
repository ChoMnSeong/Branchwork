import { useEffect, useState } from "react";
import { agentKind, agents } from "../../lib/agents";
import { displayPath, joinPath, slash } from "../../lib/env";
import { validBranchName } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { RepoStore } from "../../lib/repo";
import { Button, Checkbox, Segmented } from "../shared/ui";
import { Frame, Row } from "./Frame";
import { t } from "../../lib/i18n";

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
      title={t("New worktree")}
      confirm={t("Create")}
      width={580}
      canConfirm={valid}
      close={close}
      onConfirm={() => void store.addWorktree(path, branch, createNew, createNew ? start : null, runClaude, task)}
      leftFooter={t("A branch can be checked out in only one worktree.")}
    >
      <Segmented
        stretch
        value={createNew ? "new" : "existing"}
        onChange={(v) => setCreateNew(v === "new")}
        options={[
          { value: "new", label: t("Create new branch") },
          { value: "existing", label: t("Existing branch") },
        ]}
      />
      {createNew ? (
        <>
          <Row label={t("New branch name")}>
            <input className="input" autoFocus value={name} placeholder={t("feature/new-task")} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </Row>
          <Row label={t("Start point")}>
            <span className="mono">{start ? start.slice(0, 10) : store.headBranch ?? "HEAD"}</span>
          </Row>
        </>
      ) : (
        <Row label={t("Branch to check out")}>
          <select className="select" value={existing} onChange={(e) => setExisting(e.target.value)}>
            {free.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label={t("Location")}>
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
            void ipc.pickFolder(t("Creates the worktree inside this folder")).then((p) => {
              if (p) {
                setPath(joinPath(slash(p), branch ? branch.replace(/\//g, "-") : "worktree"));
                setPathEdited(true);
              }
            })
          }
        >
          {t("Change…")}</Button>
      </Row>
      {exists && <span className="error-text">{t("A folder already exists at this location.")}</span>}
      <Row label="">
        <Checkbox checked={runClaude} onChange={setRunClaude} label={t("Run {0} after creating", agentKind(agents.defaultKind).title.split(" (")[0])} />
      </Row>
      {runClaude && (
        <textarea className="textarea" style={{ height: 64 }} value={task} placeholder={t("Task for the agent (optional) — e.g. add password recovery to the login screen")} onChange={(e) => setTask(e.target.value)} />
      )}
    </Frame>
  );
}
