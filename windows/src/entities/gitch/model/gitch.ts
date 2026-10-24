import { ipc } from "@/shared/api";
import { dirname, env, isWindows, joinPath, slash } from "@/shared/config";
import { t } from "@/shared/i18n";
import { git, tools } from "@/shared/platform";

/**
 * gitch — 여러 Git 계정을 섞이지 않게 쓰는 셸 도구(tools/gitch, 예전 이름 gitsw). (맥 버전 Gitch.swift)
 * 앱 설치 폴더(Gitrochi.exe 옆)에 함께 들어 있고 설정 > CLI 에서 셸 명령으로 설치한다.
 * gitch 는 bash 스크립트라 Windows 에서는 Git for Windows 의 bash 로 돌린다.
 * 저장소 화면은 gitch 가 보는 이 저장소의 계정(잠금)과 커밋·push 전 점검을 보여 주고, 계정을 바꿀 수 있다.
 */

/** gitch status --json (값이 없으면 gitch 는 빈 글자를 내므로 null 로 바꿔 읽는다) */
export interface GitchStatus {
  inRepo: boolean;
  lockedAccount: string | null;
  account: string | null;
  /** lock · owner · org · folder · alias · host */
  accountSource: string | null;
  pushAccount: string | null;
  ignored: boolean;
}

export type GitchLevel = "OK" | "WARN" | "STOP";

/** gitch preflight --json */
export interface GitchPreflight {
  result: GitchLevel;
  checks: { level: GitchLevel; code: string; message: string }[];
}

/** gitch list --json 의 계정(rules 는 gitch 가 낸 문구 그대로) */
export interface GitchAccount {
  id: string;
  email: string;
  hosts: string;
  rules: string | null;
  sshKey: boolean | null;
}

/** gitch 가 pl · up · sync · fix · undo · amend · rescue 전에 남긴 자동 백업(refs/gitsw/backup/<날짜-시각>-<이유>, 최근 30개) */
export interface GitchBackup {
  ref: string;
  /** "2026-10-23 16:36:54" */
  date: string;
  /** pl · up · sync · fix … */
  reason: string;
  sha: string;
  subject: string;
  /** 그때 수정 중이던 파일도 함께 남겼는지 */
  hasChanges: boolean;
}

export class GitchError extends Error {}

const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/** 터미널 색 코드를 빼고 앞뒤 공백 정리 */
export function plain(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "").trim();
}

export function parseStatus(json: string): GitchStatus | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (typeof o.inRepo !== "boolean") return null;
    return {
      inRepo: o.inRepo,
      lockedAccount: text(o.lockedAccount),
      account: text(o.account),
      accountSource: text(o.accountSource),
      pushAccount: text(o.pushAccount),
      ignored: o.ignored === true,
    };
  } catch {
    return null;
  }
}

export function parsePreflight(json: string): GitchPreflight | null {
  try {
    const o = JSON.parse(json) as GitchPreflight;
    return typeof o.result === "string" && Array.isArray(o.checks) ? o : null;
  } catch {
    return null;
  }
}

export function parseAccounts(json: string): GitchAccount[] {
  try {
    const o = JSON.parse(json) as { accounts?: Partial<GitchAccount>[] };
    return (o.accounts ?? []).map((a) => ({
      id: String(a.id ?? ""),
      email: String(a.email ?? ""),
      hosts: String(a.hosts ?? ""),
      rules: text(a.rules),
      sshKey: typeof a.sshKey === "boolean" ? a.sshKey : null,
    }));
  } catch {
    return [];
  }
}

/** for-each-ref 출력(ref \t 짧은 sha \t 제목) → 백업 목록(gitch rescue 와 같은 순서 — 최근 것이 1번) */
export function parseBackups(out: string): GitchBackup[] {
  const prefix = "refs/gitsw/backup/";
  const rows = out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  const refs = new Set(rows.map((r) => r[0]));
  return rows.flatMap((r) => {
    if (r.length < 3 || r[0].endsWith("-wip")) return [];
    const name = r[0].slice(prefix.length);
    if (name.length <= 16) return [];
    const date = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)} ${name.slice(9, 11)}:${name.slice(11, 13)}:${name.slice(13, 15)}`;
    return [{ ref: r[0], date, reason: name.slice(16), sha: r[1], subject: r.slice(2).join("\t"), hasChanges: refs.has(r[0] + "-wip") }];
  });
}

/** 파일 머리의 GITSW_VERSION="x.y.z"(변수 이름은 예전 그대로) */
export function versionOf(head: string): string | null {
  return head.match(/^GITSW_VERSION="([^"]+)"/m)?.[1] ?? null;
}

/** Windows 의 ~/bin/gitch 연결 스크립트(gitch install 이 만듦)가 가리키는 파일. 아니면 null */
export function linkTarget(script: string): string | null {
  const [l1, l2] = script.split("\n");
  if (l1?.trim() !== "#!/bin/sh") return null;
  return l2?.match(/^# gitch-link: (.+?)\r?$/)?.[1] ?? null;
}

/** Git Bash 경로(/c/Users/…)를 Windows 경로(C:/Users/…)로 */
export function fromPosix(p: string): string {
  const m = p.match(/^\/([a-zA-Z])(\/.*)?$/);
  return m ? `${m[1].toUpperCase()}:${m[2] ?? "/"}` : p;
}

class GitchService {
  /** 앱에 든 gitch(설치 폴더의 gitch) */
  get bundled(): string | null {
    const dir = env.resourceDir.replace(/^\\\\\?\\/, "");
    return dir ? slash(joinPath(dir, "gitch")) : null;
  }
  get link() {
    return joinPath(env.home, "bin/gitch");
  }
  /** 예전 이름 — gitch install 이 같은 파일로 이어 두고, 그 전에 gitsw 로 깔았으면 그것만 있다 */
  get legacyLink() {
    return joinPath(env.home, "bin/gitsw");
  }
  /** 설정 파일은 예전 이름의 폴더 그대로(기존 설치와 같은 설정을 쓰게) */
  get configFile() {
    return joinPath(env.home, ".config/gitsw/config");
  }

  /** gitch 를 돌릴 bash: Windows 는 Git for Windows 의 bin\bash.exe(System32 의 bash.exe 는 WSL 이라 쓰지 않는다) */
  async bash(): Promise<string | null> {
    if (!isWindows()) return "/bin/bash";
    const gitPath = tools.path("git");
    const tried = new Set<string>();
    const candidates: string[] = [];
    if (gitPath) {
      // …/Git/cmd/git.exe · …/Git/bin/git.exe · …/Git/mingw64/bin/git.exe → …/Git/bin/bash.exe
      let d = dirname(slash(gitPath));
      for (let i = 0; i < 3; i++) {
        candidates.push(joinPath(d, "bin/bash.exe"));
        d = dirname(d);
      }
    }
    candidates.push("C:/Program Files/Git/bin/bash.exe", joinPath(env.localAppData, "Programs/Git/bin/bash.exe"), joinPath(env.home, "scoop/apps/git/current/bin/bash.exe"));
    for (const c of candidates) {
      if (tried.has(c)) continue;
      tried.add(c);
      if (await ipc.exists(c)) return c;
    }
    return null;
  }

  /** 계정을 하나라도 더했는지(gitch add) — 없으면 install 도 저장소 점검도 할 수 없다 */
  hasConfig() {
    return ipc.exists(this.configFile);
  }

  /** 셸 명령(~/bin/gitch, 없으면 예전 ~/bin/gitsw)이 가리키는 실제 파일. 설치하지 않았으면 null */
  async installed(): Promise<{ name: string; path: string } | null> {
    for (const [name, link] of [["~/bin/gitch", this.link], ["~/bin/gitsw", this.legacyLink]] as const) {
      const body = await ipc.readHead(link, 400).catch(() => null);
      if (!body || body.binary) continue;
      const target = linkTarget(body.text);
      // 맥 · 리눅스는 심볼릭 링크라 파일 내용이 gitch 그대로다
      return { name, path: target ? fromPosix(target) : link };
    }
    return null;
  }

  /** 설치된 셸 명령이 이 앱에 든 gitch 인지(아니면 따로 받은 gitch 나 예전 gitsw) */
  async installedIsBundled(): Promise<boolean> {
    const i = await this.installed();
    const b = this.bundled;
    return !!i && !!b && slash(i.path).toLowerCase() === b.toLowerCase();
  }

  /** 저장소 점검에 쓸 gitch: 설치된 것(따로 받은 것일 수도), 없으면 앱에 든 것 */
  async executable(): Promise<string | null> {
    const i = await this.installed();
    if (i && (await ipc.exists(i.path))) return i.path;
    const b = this.bundled;
    return b && (await ipc.exists(b)) ? b : null;
  }

  async version(path: string): Promise<string | null> {
    const h = await ipc.readHead(path, 4096).catch(() => null);
    return h ? versionOf(h.text) : null;
  }

  private async spawn(args: string[], cwd: string, timeoutMs: number, exe?: string | null) {
    const path = exe ?? (await this.executable());
    if (!path) throw new GitchError(t("Couldn't find gitch inside Gitrochi."));
    const bash = await this.bash();
    if (!bash) throw new GitchError(t("gitch needs Git for Windows (Git Bash). Install it from https://git-scm.com/download/win."));
    // 앱에서 부를 때는 사람이 보는 터미널이 아니다: 색·로고 없이, 묻지 않고(확인이 필요하면 종료 코드 2)
    return ipc.run(bash, [path, ...args], { cwd, timeoutMs, env: { GITSW_COLOR: "never", GITSW_BANNER: "never" } });
  }

  private async json(args: string[], cwd: string): Promise<string | null> {
    if (!(await this.hasConfig())) return null;
    try {
      // preflight 는 STOP 이면 종료 코드가 1 이어도 JSON 을 낸다
      return (await this.spawn(args, cwd, 60_000)).stdout;
    } catch {
      return null;
    }
  }

  async status(repo: string) {
    const out = await this.json(["status", "--json"], repo);
    return out == null ? null : parseStatus(out);
  }

  /** fetch 면 원격을 받아 받을 커밋까지 본다(몇 초). 아니면 지금 있는 원격 정보로만. */
  async preflight(repo: string, fetch: boolean) {
    const out = await this.json(["preflight", "--json", ...(fetch ? [] : ["--no-fetch"])], repo);
    return out == null ? null : parsePreflight(out);
  }

  async accounts(): Promise<GitchAccount[]> {
    const out = await this.json(["list", "--json"], env.home);
    return out == null ? [] : parseAccounts(out);
  }

  /** gitch 명령을 실행하고, 실패하면 gitch 가 낸 문구로 던진다. 성공하면 출력 */
  async run(args: string[], repo: string, timeoutMs = 120_000): Promise<string> {
    const r = await this.runRaw(args, repo, timeoutMs);
    if (r.status !== 0) throw new GitchError(r.output || `exit ${r.status}`);
    return r.output;
  }

  /** 종료 코드와 출력을 그대로(확인이 필요하면 gitch 는 2 로 끝나며 무엇을 할지 목록을 낸다) */
  async runRaw(args: string[], repo: string, timeoutMs = 120_000): Promise<{ status: number; output: string }> {
    const r = await this.spawn(args, repo, timeoutMs);
    return { status: r.status, output: plain(r.stdout + (r.stderr ? "\n" + r.stderr : "")) };
  }

  /** 자동 백업 목록 */
  async backups(repo: string): Promise<GitchBackup[]> {
    try {
      const r = await git(["for-each-ref", "--sort=-refname", "--format=%(refname)%09%(objectname:short)%09%(subject)", "refs/gitsw/backup/"], repo);
      return parseBackups(r.stdout);
    } catch {
      return [];
    }
  }

  /** 앱에 든 gitch 로 `gitch install`: ~/bin/gitch 연결(+ PowerShell 용 .cmd · 사용자 PATH), ~/.bashrc, git 전역 훅·규칙, AI 도구 규칙 */
  async install(): Promise<string> {
    const exe = this.bundled;
    if (!exe || !(await ipc.exists(exe))) throw new GitchError(t("Couldn't find gitch inside Gitrochi."));
    // 설치하지 않은(포터블 · 빌드) Gitrochi 에 연결하면 폴더를 옮기거나 지울 때 끊긴다(gitch install 도 거부하지만 번역된 안내를 보이려고 먼저 확인)
    if (isWindows() && !(await ipc.exists(joinPath(dirname(exe), "uninstall.exe")))) {
      throw new GitchError(t("This Gitrochi isn't installed (portable or a build). Install Gitrochi with the setup program, open it, then install gitch."));
    }
    const r = await this.spawn(["install"], env.home, 180_000, exe);
    const out = plain(r.stdout + (r.stderr ? "\n" + r.stderr : ""));
    if (r.status !== 0) throw new GitchError(out || `exit ${r.status}`);
    return out;
  }

  /** 새 콘솔 창에서 gitch 명령(add · setup · doctor 처럼 묻거나 길게 보여 주는 것). 끝나면 Enter 로 닫는다. */
  async openInConsole(args: string[], cwd = env.home) {
    const exe = await this.executable();
    if (!exe) throw new GitchError(t("Couldn't find gitch inside Gitrochi."));
    const bash = await this.bash();
    if (!bash) throw new GitchError(t("gitch needs Git for Windows (Git Bash). Install it from https://git-scm.com/download/win."));
    const close = t("Press Enter to close this window");
    await ipc.openConsole(bash, ["-c", `"$0" "$@"; echo; read -r -p "${close.replace(/["$`\\]/g, "")}" _`, exe, ...args], cwd);
  }

  /** 내장 터미널 탭에서 돌릴 명령(저장소 화면에서 doctor 등) */
  async terminalCommand(args: string[]): Promise<{ program: string; args: string[] } | null> {
    const [exe, bash] = [await this.executable(), await this.bash()];
    return exe && bash ? { program: bash, args: [exe, ...args] } : null;
  }
}

export const gitch = new GitchService();
