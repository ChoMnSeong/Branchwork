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

/**
 * 배포판 안에서 명령의 절대 경로를 찾는다.
 * ① 사용자의 로그인 셸(zsh·fish·bash …)을 로그인·대화형으로 띄워 command -v / type (alias 도 풀어 봄)
 * ② 그래도 없으면 흔한 설치 위치(~/.local/bin, ~/.claude/local, nvm·bun·volta·asdf, /usr/local/bin …)
 */
const FIND_SCRIPT = `n="$1"
sh_=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)
[ -x "$sh_" ] || sh_=/bin/bash
out=$("$sh_" -lic "command -v $n; type $n" </dev/null 2>/dev/null)
for p in $(printf '%s' "$out" | grep -oE "/[^[:space:]]*/$n"); do
  if [ -x "$p" ] && [ ! -d "$p" ]; then echo "found:$p"; exit 0; fi
done
for c in "$HOME/.local/bin/$n" "$HOME/.claude/local/$n" "/usr/local/bin/$n" "/usr/bin/$n" "$HOME/.npm-global/bin/$n" "$HOME/.bun/bin/$n" "$HOME/.volta/bin/$n" "$HOME/.asdf/shims/$n" "/home/linuxbrew/.linuxbrew/bin/$n" "$HOME"/.nvm/versions/node/*/bin/"$n"; do
  if [ -x "$c" ] && [ ! -d "$c" ]; then echo "found:$c"; exit 0; fi
done
echo "notfound:shell=$sh_ user=$(id -un) output=$(printf '%s' "$out" | tail -c 160 | tr '[:space:]' ' ')"
exit 1`;

export interface FindResult {
  path: string | null;
  /** 못 찾았을 때 무엇을 해 봤는지(오류 안내용) */
  detail: string;
}

export async function findCommand(distro: string, name: string): Promise<FindResult> {
  try {
    const r = await ipc.run("wsl.exe", ["-d", distro, "--exec", "sh", "-c", FIND_SCRIPT, "sh", name], { env: { WSL_UTF8: "1" }, timeoutMs: 90000 });
    const lines = clean(r.stdout).split(/\r?\n/).map((l) => l.trim());
    const found = lines.find((l) => l.startsWith("found:"));
    if (found) return { path: found.slice(6), detail: "" };
    const nf = lines.find((l) => l.startsWith("notfound:"));
    return { path: null, detail: nf ? nf.slice(9) : (clean(r.stderr).trim() || `wsl.exe 종료 코드 ${r.status}`).slice(0, 300) };
  } catch (e) {
    return { path: null, detail: String(e).slice(0, 300) };
  }
}

/** 리눅스 경로의 파일이 실행 파일인지 */
export async function isExecutable(distro: string, path: string): Promise<boolean> {
  try {
    const r = await ipc.run("wsl.exe", ["-d", distro, "--exec", "test", "-x", path], { timeoutMs: 60000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** 배포판 안의 명령 버전 */
export async function commandVersion(distro: string, command: string): Promise<string | null> {
  try {
    const r = await ipc.run("wsl.exe", wslArgs(distro, command, ["--version"]), { env: { WSL_UTF8: "1" }, timeoutMs: 60000 });
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
