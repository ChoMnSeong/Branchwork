import { env, isWindows, joinPath, samePath, slash } from "./env";
import { ipc } from "./ipc";
import { Observable } from "./observable";
import type { TerminalSession } from "./terminal";

/** Claude Code 세션 상태(훅 이벤트로 판단) */
export type AgentStatus = "starting" | "working" | "permission" | "waiting" | "ended";

export const agentStatusTitle: Record<AgentStatus, string> = {
  starting: "입력 대기",
  working: "작업 중",
  permission: "권한 요청",
  waiting: "입력 대기",
  ended: "종료됨",
};

export const isActiveStatus = (s: AgentStatus) => s === "working" || s === "permission";

export interface AgentSession {
  id: string;
  path: string;
  task: string;
  created: number;
  status: AgentStatus;
  detail: string | null;
  updated: number;
}

/** 세션을 띄울 저장소 창(탭) — 순환 참조를 피하려고 필요한 것만 */
export interface AgentHost {
  newTerminal(path: string, spec?: { program?: string; args?: string[]; env?: Record<string, string>; title?: string }): TerminalSession;
  focusTerminal(t: TerminalSession): void;
}

const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "SessionEnd"];

/**
 * Branchwork 가 띄운 Claude Code 세션 추적. (맥 버전 AgentCenter)
 *
 * 세션은 아래 터미널 패널의 탭에서 돈다. 띄울 때 `--settings` 로 훅을 더해 두면(사용자 설정·훅은 그대로 유지)
 * 각 이벤트마다 Branchwork 실행 파일이 `--agent-hook` 으로 불려 <데이터>/agents/<id>.state 에 마지막 상태를 쓴다.
 */
class AgentCenter extends Observable {
  sessions: AgentSession[] = [];
  private dir = "";
  private hooksFile = "";
  private terminals = new Map<string, { term: TerminalSession; host: AgentHost }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  async init() {
    this.dir = joinPath(env.dataDir, "agents");
    this.hooksFile = joinPath(this.dir, "hooks.json");
    await ipc.mkdirs(this.dir);
    // 지난번 실행의 세션은 터미널과 함께 끝났으므로 지운다
    for (const name of await ipc.list(this.dir)) if (/\.(meta|state|tmp)$/.test(name)) await ipc.remove(joinPath(this.dir, name));
    await this.installHooks();
    this.timer = setInterval(() => void this.load(), 2000);
  }

  private async installHooks() {
    // Windows 경로도 / 로 쓰면 cmd·Git Bash 어느 셸로 실행돼도 그대로 통한다
    const exe = isWindows() ? slash(env.exe) : env.exe;
    const hooks: Record<string, unknown> = {};
    for (const e of events) {
      hooks[e] = [{ matcher: "", hooks: [{ type: "command", command: `"${exe}" --agent-hook ${e}`, timeout: 5 }] }];
    }
    await ipc.writeText(this.hooksFile, JSON.stringify({ hooks }, null, 2));
  }

  sessionsIn(path: string) {
    return this.sessions.filter((s) => samePath(s.path, path));
  }

  private async json(name: string): Promise<Record<string, unknown> | null> {
    const t = await ipc.readText(joinPath(this.dir, name));
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }

  async load() {
    if (!this.dir) return;
    const names = await ipc.list(this.dir);
    const list: AgentSession[] = [];
    for (const name of names.filter((n) => n.endsWith(".meta"))) {
      const id = name.slice(0, -5);
      const meta = await this.json(name);
      if (!meta) continue;
      const created = Number(meta.created) || 0;
      let status: AgentStatus = "starting";
      let detail: string | null = null;
      let updated = created;
      const state = await this.json(id + ".state");
      if (state) {
        updated = Number(state.time) || created;
        const payload = (state.payload ?? {}) as Record<string, unknown>;
        switch (state.event) {
          case "SessionStart":
            status = "starting";
            break;
          case "UserPromptSubmit":
            status = "working";
            break;
          case "PreToolUse":
            status = "working";
            detail = (payload.tool_name as string) ?? null;
            break;
          case "PermissionRequest":
            status = "permission";
            detail = (payload.tool_name as string) ?? null;
            break;
          case "Notification": {
            const m = (payload.message as string) ?? null;
            status = m?.toLowerCase().includes("permission") ? "permission" : "waiting";
            detail = m;
            break;
          }
          case "Stop":
            status = "waiting";
            break;
          case "SessionEnd":
            status = "ended";
            break;
        }
      }
      const t = this.terminals.get(id);
      if (!t || !t.term.running) status = "ended";
      list.push({ id, path: String(meta.path ?? ""), task: String(meta.task ?? ""), created, status, detail, updated });
    }
    list.sort((a, b) => b.created - a.created);
    if (JSON.stringify(list) !== JSON.stringify(this.sessions)) {
      this.sessions = list;
      this.emit();
    }
  }

  /** 폴더에서 Claude Code 를 아래 터미널의 새 탭으로 띄운다. task 가 있으면 첫 요청으로 보낸다. */
  async start(host: AgentHost, path: string, task: string, permissionMode: string | null, cli: string | null) {
    const id = crypto.randomUUID().toLowerCase();
    const meta = { id, path, task: task.trim(), created: Date.now() / 1000 };
    await ipc.writeText(joinPath(this.dir, id + ".meta"), JSON.stringify(meta));
    const args = ["--settings", this.hooksFile];
    if (permissionMode) args.push("--permission-mode", permissionMode);
    if (task.trim()) args.push(task.trim());
    const term = host.newTerminal(path, { program: cli ?? "claude", args, env: { BRANCHWORK_AGENT_ID: id }, title: "Claude" });
    this.terminals.set(id, { term, host });
    term.onExit = () => void this.load();
    await this.load();
  }

  focus(s: AgentSession) {
    const t = this.terminals.get(s.id);
    if (t) t.host.focusTerminal(t.term);
  }

  stop(s: AgentSession) {
    this.terminals.get(s.id)?.term.terminate();
    void this.load();
  }

  async remove(id: string) {
    for (const ext of [".meta", ".state", ".state.tmp"]) await ipc.remove(joinPath(this.dir, id + ext));
    this.terminals.delete(id);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.emit();
  }

  async clearEnded() {
    for (const s of this.sessions.filter((x) => x.status === "ended")) await this.remove(s.id);
  }

  canFocus(s: AgentSession) {
    return s.status !== "ended" && this.terminals.has(s.id);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
  }
}

export const agents = new AgentCenter();
