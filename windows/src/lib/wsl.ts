import { env, isWindows, joinPath, toWslPath } from "./env";
import { ipc } from "./ipc";

/**
 * WSL(Windows 안의 리눅스)에서 도구를 실행하기.
 * Claude Code·Codex·Gemini CLI 를 WSL 에 설치해 쓰는 사람을 위해 wsl.exe → bash 로 대신 실행한다.
 */

/** 문자열에서 wsl.exe 의 UTF-16 흔적(널 문자·BOM)을 지운다 */
const clean = (s: string) => s.replace(/\u0000/g, "").replace(/^﻿/, "");

let distroCache: string[] | null = null;

/** 설치된 배포판(기본 배포판이 맨 앞) */
export async function listDistros(force = false): Promise<string[]> {
  if (!isWindows()) return [];
  if (distroCache && !force) return distroCache;
  try {
    const r = await ipc.run("wsl.exe", ["-l", "-q"], { env: { WSL_UTF8: "1" }, timeoutMs: 15000 });
    distroCache = r.status === 0 ? clean(r.stdout).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^docker-desktop/i.test(l)) : [];
  } catch {
    distroCache = [];
  }
  return distroCache;
}

/**
 * bash 로 명령을 실행하는 wsl.exe 인자.
 * - 명령 이름 대신 찾아 둔 절대 경로를 쓰고, 그 폴더를 PATH 앞에 붙인다(nvm 으로 깐 node 도 찾게)
 * - "@file:/mnt/…" 로 넘긴 인자는 그 파일 내용으로 바꾼다(여러 줄 글을 wsl.exe 명령줄로 넘기지 않으려고)
 */
export function wslArgs(distro: string, command: string, args: string[], o: { cwd?: string; interactive?: boolean } = {}): string[] {
  const script =
    'a=(); for x in "$@"; do case "$x" in @file:*) a+=("$(cat "${x#@file:}")");; *) a+=("$x");; esac; done; ' +
    'case "$0" in */*) PATH="$(dirname "$0"):$PATH";; esac; exec "$0" "${a[@]}"';
  return ["-d", distro, ...(o.cwd ? ["--cd", toWslPath(o.cwd)] : []), "--exec", "bash", o.interactive ? "-lic" : "-lc", script, command, ...args];
}

/** 배포판 안에서 명령의 절대 경로를 찾는다(로그인·대화형 셸의 PATH 로 — nvm 등도 포함) */
export async function findCommand(distro: string, name: string): Promise<string | null> {
  try {
    const r = await ipc.run("wsl.exe", ["-d", distro, "--exec", "bash", "-lic", `command -v ${name} 2>/dev/null`], { env: { WSL_UTF8: "1" }, timeoutMs: 30000 });
    const line = clean(r.stdout)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .reverse()
      .find((l) => l.startsWith("/"));
    return line ?? null;
  } catch {
    return null;
  }
}

/** 배포판 안의 명령 버전 */
export async function commandVersion(distro: string, command: string): Promise<string | null> {
  try {
    const r = await ipc.run("wsl.exe", wslArgs(distro, command, ["--version"]), { env: { WSL_UTF8: "1" }, timeoutMs: 30000 });
    const line = clean(r.stdout).trim().split(/\r?\n/)[0] ?? "";
    return r.status === 0 && line ? line.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/** WSL 에서 실행할 때 쓰는 임시 파일(여러 줄 인자) */
export async function tempFile(name: string, content: string): Promise<{ windows: string; wsl: string }> {
  const windows = joinPath(env.temp, `branchwork-${crypto.randomUUID().slice(0, 8)}-${name}`);
  await ipc.writeText(windows, content);
  return { windows, wsl: toWslPath(windows) };
}

/** WSL 안으로 넘길 환경 변수 이름을 WSLENV 에 더한다(윈도 → 리눅스, 리눅스에서 다시 윈도 프로그램을 부를 때도) */
export function withWslEnv(vars: Record<string, string>): Record<string, string> {
  const names = Object.keys(vars).filter((k) => k !== "WSLENV");
  const existing = (vars.WSLENV ?? "").split(":").filter(Boolean);
  return { ...vars, WSLENV: [...new Set([...existing, ...names])].join(":") };
}
