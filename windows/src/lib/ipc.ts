import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 백엔드(Rust) 명령 모음 */

export interface ProcOutput {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface EnvInfo {
  os: string;
  home: string;
  dataDir: string;
  exe: string;
  temp: string;
  shell: string;
  version: string;
  /** 자동 점검(CI): 열어 볼 테스트 저장소 경로 */
  selftest: string | null;
  selftestOpen: string | null;
  appData: string;
  localAppData: string;
}

export type PtyEvent = { kind: "data"; data: string } | { kind: "exit"; code: number | null };

export interface HttpResponse {
  status: number;
  body: string;
}

export interface FileHead {
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}

export const ipc = {
  run: (program: string, args: string[], o: RunOptions = {}) =>
    invoke<ProcOutput>("run_process", {
      program,
      args,
      cwd: o.cwd ?? null,
      env: o.env ?? null,
      stdin: o.stdin ?? null,
      timeoutMs: o.timeoutMs ?? null,
    }),
  which: (program: string) => invoke<string | null>("which", { program }),

  ptySpawn: (
    id: string,
    program: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    cols: number,
    rows: number,
    onEvent: (e: PtyEvent) => void,
  ) => {
    const ch = new Channel<PtyEvent>();
    ch.onmessage = onEvent;
    return invoke<number | null>("pty_spawn", { id, program, args, cwd, env, cols, rows, onEvent: ch });
  },
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: string) => invoke<void>("pty_kill", { id }),

  watchStart: (id: string, path: string) => invoke<void>("watch_start", { id, path }),
  watchStop: (id: string) => invoke<void>("watch_stop", { id }),
  onWatch: (id: string, fn: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>(`watch-${id}`, (e) => fn(e.payload)),

  http: (method: string, url: string, headers: Record<string, string>, body?: string, timeoutMs?: number) =>
    invoke<HttpResponse>("http_request", { method, url, headers, body: body ?? null, timeoutMs: timeoutMs ?? null }),
  resolveHost: (host: string) => invoke<string[]>("resolve_host", { host }),

  secretGet: (name: string) => invoke<string | null>("secret_get", { name }),
  secretSet: (name: string, value: string | null) => invoke<void>("secret_set", { name, value }),

  exists: (path: string) => invoke<boolean>("fs_exists", { path }),
  readText: (path: string) => invoke<string | null>("fs_read_text", { path }),
  readHead: (path: string, max: number) => invoke<FileHead>("fs_read_head", { path, max }),
  writeText: (path: string, content: string) => invoke<void>("fs_write_text", { path, content }),
  list: (path: string) => invoke<string[]>("fs_list", { path }),
  remove: (path: string) => invoke<void>("fs_remove", { path }),
  mkdirs: (path: string) => invoke<void>("fs_mkdirs", { path }),

  envInfo: () => invoke<EnvInfo>("env_info"),
  pickFolder: (title: string, start?: string) => invoke<string | null>("pick_folder", { title, start: start ?? null }),
  pickFile: (title: string, start?: string) => invoke<string | null>("pick_file", { title, start: start ?? null }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  reveal: (path: string) => invoke<void>("reveal_path", { path }),
  openTerminal: (path: string) => invoke<void>("open_terminal", { path }),
  appReady: () => invoke<void>("app_ready"),
};
