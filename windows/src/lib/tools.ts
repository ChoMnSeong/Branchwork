import { basename, env, isWindows, joinPath } from "./env";
import { ipc } from "./ipc";
import { Observable } from "./observable";
import { settings } from "./settings";

/**
 * 외부 프로그램(git·AI CLI·gh·셸) 위치. PC 마다 설치 위치가 달라
 * ① 설정에서 직접 고른 경로 → ② 흔한 설치 위치 → ③ PATH 순서로 찾는다.
 */
export type ToolId = "git" | "claude" | "codex" | "gemini" | "gh" | "shell";

export interface ToolInfo {
  id: ToolId;
  title: string;
  detail: string;
  required?: boolean;
  /** PATH 에서 찾을 이름 */
  command: string;
  versionArgs: string[];
  install?: string;
}

export const toolList: ToolInfo[] = [
  { id: "git", title: "Git", detail: "모든 저장소 작업에 씁니다.", required: true, command: "git", versionArgs: ["--version"], install: "https://git-scm.com/download/win" },
  { id: "claude", title: "Claude Code", detail: "Claude 로그인으로 글 작성·에이전트 세션", command: "claude", versionArgs: ["--version"], install: "https://claude.com/claude-code" },
  { id: "codex", title: "Codex CLI", detail: "ChatGPT 로그인으로 글 작성·에이전트 세션", command: "codex", versionArgs: ["--version"], install: "https://developers.openai.com/codex/cli" },
  { id: "gemini", title: "Gemini CLI", detail: "Google 로그인으로 글 작성·에이전트 세션", command: "gemini", versionArgs: ["--version"], install: "https://github.com/google-gemini/gemini-cli" },
  { id: "gh", title: "GitHub CLI (gh)", detail: "gh 로그인을 GitHub 계정으로 가져올 때", command: "gh", versionArgs: ["--version"], install: "https://cli.github.com" },
  { id: "shell", title: "터미널 셸", detail: "아래 터미널 패널에서 여는 셸(PowerShell·cmd·Git Bash 등)", command: "", versionArgs: [] },
];

export type ToolSource = "custom" | "auto" | "none";

interface ToolState {
  path: string | null;
  source: ToolSource;
  version: string | null;
}

/** 흔한 설치 위치(PATH 에 없을 때) */
function candidates(id: ToolId): string[] {
  const home = env.home,
    roaming = env.appData,
    local = env.localAppData;
  if (isWindows()) {
    const pf = ["C:/Program Files", "C:/Program Files (x86)"];
    switch (id) {
      case "git":
        return [...pf.map((p) => p + "/Git/cmd/git.exe"), joinPath(local, "Programs/Git/cmd/git.exe"), joinPath(home, "scoop/shims/git.exe")];
      case "claude":
        return [joinPath(home, ".local/bin/claude.exe"), joinPath(roaming, "npm/claude.cmd"), joinPath(home, "scoop/shims/claude.exe")];
      case "codex":
        return [joinPath(roaming, "npm/codex.cmd"), joinPath(home, ".local/bin/codex.exe"), joinPath(home, "scoop/shims/codex.exe")];
      case "gemini":
        return [joinPath(roaming, "npm/gemini.cmd"), joinPath(home, "scoop/shims/gemini.exe")];
      case "gh":
        return [...pf.map((p) => p + "/GitHub CLI/gh.exe"), joinPath(local, "Programs/GitHub CLI/gh.exe"), joinPath(home, "scoop/shims/gh.exe")];
      case "shell":
        return ["C:/Program Files/PowerShell/7/pwsh.exe", "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"];
    }
  }
  const brew = ["/opt/homebrew/bin", "/usr/local/bin"];
  switch (id) {
    case "git":
      return [...brew.map((b) => b + "/git"), "/usr/bin/git"];
    case "claude":
      return [joinPath(home, ".local/bin/claude"), joinPath(home, ".claude/local/claude"), ...brew.map((b) => b + "/claude")];
    case "codex":
      return [...brew.map((b) => b + "/codex"), joinPath(home, ".local/bin/codex")];
    case "gemini":
      return [...brew.map((b) => b + "/gemini"), joinPath(home, ".local/bin/gemini")];
    case "gh":
      return brew.map((b) => b + "/gh");
    case "shell":
      return [env.shell, "/bin/zsh", "/bin/bash"];
  }
}

class Tools extends Observable {
  state: Record<ToolId, ToolState> = Object.fromEntries(toolList.map((t) => [t.id, { path: null, source: "none", version: null }])) as Record<ToolId, ToolState>;

  private custom(): Partial<Record<ToolId, string>> {
    return settings.get<Partial<Record<ToolId, string>>>("toolPaths", {});
  }

  path(id: ToolId): string | null {
    return this.state[id].path;
  }

  async detectAll() {
    await Promise.all(toolList.map((t) => this.detect(t.id)));
  }

  async detect(id: ToolId) {
    const info = toolList.find((t) => t.id === id)!;
    const custom = this.custom()[id];
    let path: string | null = null;
    let source: ToolSource = "none";
    if (custom && (await ipc.exists(custom))) {
      path = custom;
      source = "custom";
    } else {
      if (id === "shell") path = env.shell || null;
      else {
        path = await ipc.which(info.command);
        if (!path) for (const c of candidates(id)) if (c && (await ipc.exists(c))) { path = c; break; }
      }
      if (path) source = "auto";
    }
    this.state[id] = { path, source, version: null };
    this.emit();
    if (path && info.versionArgs.length) void this.readVersion(id, path);
  }

  private async readVersion(id: ToolId, path: string) {
    try {
      const r = await ipc.run(path, this.toolList(id).versionArgs, { cwd: env.temp, timeoutMs: 20000 });
      const line = (r.stdout || r.stderr).trim().split(/\r?\n/)[0] ?? "";
      if (this.state[id].path === path) {
        this.state[id] = { ...this.state[id], version: r.status === 0 ? line.slice(0, 80) : null };
        this.emit();
      }
    } catch {
      /* 버전을 못 읽어도 경로는 쓴다 */
    }
  }

  private toolList(id: ToolId) {
    return toolList.find((t) => t.id === id)!;
  }

  /** 직접 고른 실행 파일로 바꾼다. 실행해 보고 안 되면 이유를 던진다. */
  async setCustom(id: ToolId, path: string) {
    const info = this.toolList(id);
    if (info.versionArgs.length) {
      let r;
      try {
        r = await ipc.run(path, info.versionArgs, { cwd: env.temp, timeoutMs: 20000 });
      } catch (e) {
        throw new Error(`${basename(path)} 을(를) 실행하지 못했습니다: ${String(e)}`);
      }
      if (r.status !== 0) throw new Error(`${basename(path)} 이(가) 정상적으로 응답하지 않았습니다(종료 코드 ${r.status}). ${info.title} 실행 파일이 맞는지 확인하세요.`);
    }
    settings.set("toolPaths", { ...this.custom(), [id]: path });
    await this.detect(id);
  }

  async resetToAuto(id: ToolId) {
    const c = { ...this.custom() };
    delete c[id];
    settings.set("toolPaths", c);
    await this.detect(id);
  }

  /** 셸에 맞는 시작 인자 */
  shellArgs(path: string): string[] {
    const n = basename(path).toLowerCase();
    if (n.startsWith("pwsh") || n.startsWith("powershell")) return ["-NoLogo"];
    if (n.startsWith("bash") || n.startsWith("zsh") || n.startsWith("fish")) return isWindows() ? ["--login", "-i"] : ["-l"];
    if (n.startsWith("cmd")) return [];
    return isWindows() ? [] : ["-l"];
  }
}

export const tools = new Tools();
