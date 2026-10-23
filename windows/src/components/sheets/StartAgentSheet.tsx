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
import { t } from "../../lib/i18n";

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
      title={t("Start agent session")}
      confirm={t("Start")}
      width={580}
      canConfirm={found && (!!target || validBranch)}
      close={close}
      leftFooter={t("Runs in a new tab of the terminal below; its status is shown in the Agents tab.")}
      onConfirm={() =>
        void (async () => {
          const m = mode || null;
          if (!target) {
            if (await store.addWorktree(wtPath, newBranch.trim(), true, null, false, "")) await store.startAgent(wtPath, task, m, kind);
          } else await store.startAgent(target, task, m, kind);
        })()
      }
    >
      <Row label={t("Agents")}>
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
            tip: tools.available(k.tool) ? `${k.title}|${tools.describe(k.tool)}` : t("{0} — not found (locate it or find it in WSL in Settings > Tools)", k.title),
          }))}
        />
      </Row>
      {!found && <span className="error-text">{t("Couldn't find the {0} executable. Locate it in Settings > Tools, or if you installed it in WSL, click 'Find in WSL'.", info.title)}</span>}
      {found && tools.wsl(info.tool) && <span className="hint">{t("Runs inside WSL ({0}). The working folder is opened as a Linux path.", tools.wsl(info.tool)!.distro)}</span>}
      <Row label={t("Where to work")}>
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {store.worktrees.map((w) => (
            <option key={w.path} value={w.path}>
              {(w.branch ?? t("Detached HEAD")) + (w.path === store.path ? t("  (opened here)") : "")}
            </option>
          ))}
          <option value="">{t("Create new worktree…")}</option>
        </select>
      </Row>
      {!target && (
        <>
          <Row label={t("New branch name")}>
            <input className="input" autoFocus value={newBranch} placeholder={t("feature/ai-work")} onChange={(e) => setNewBranch(e.target.value)} spellCheck={false} />
          </Row>
          <Row label={t("Location")}>
            <span className="ellipsis muted">{wtPath ? displayPath(wtPath) : "-"}</span>
          </Row>
        </>
      )}
      <Row label={t("Task")}>
        <textarea className="textarea" style={{ height: 80 }} value={task} placeholder={t("e.g. add a lockout after failed logins, including tests")} onChange={(e) => setTask(e.target.value)} />
      </Row>
      <Row label={t("Permission mode")}>
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
