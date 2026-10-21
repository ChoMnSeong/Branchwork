import { env, isWindows, joinPath, dirname, toWslPath } from "./lib/env";
import { ipc } from "./lib/ipc";
import { isWIP, statusIsEmpty } from "./lib/models";
import { invoke } from "@tauri-apps/api/core";
import { ai } from "./lib/ai";
import { tools } from "./lib/tools";
import { listDistros } from "./lib/wsl";
import { agents } from "./lib/agents";
import { workspace } from "./lib/workspace";
import { CIAPI, canPlay } from "./lib/ci";
import { settings } from "./lib/settings";

/**
 * 자동 점검(CI 의 Windows 서버에서): BRANCHWORK_SELFTEST=<테스트 저장소> 로 켜면
 * 실제 화면·백엔드로 주요 기능을 차례로 해 보고 결과를 <저장소 옆>/selftest-result.json 에 남긴다.
 */
interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(f: () => boolean | Promise<boolean>, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await f()) return true;
    await sleep(150);
  }
  return false;
}

export async function runSelfTest(): Promise<boolean> {
  const repo = env.selftest;
  if (!repo) return false;
  const checks: Check[] = [];
  const out = joinPath(dirname(repo), "selftest-result.json");
  const check = (name: string, ok: boolean, detail?: unknown) => {
    checks.push({ name, ok, detail: detail === undefined ? undefined : String(detail).slice(0, 500) });
  };
  const step = async (name: string, f: () => Promise<boolean | [boolean, unknown]>) => {
    try {
      const r = await f();
      if (Array.isArray(r)) check(name, r[0], r[1]);
      else check(name, r);
    } catch (e) {
      check(name, false, e instanceof Error ? e.stack ?? e.message : e);
    }
  };

  workspace.restoring = false;
  const s = workspace.newTab();
  await step("저장소 열기", async () => {
    await s.openInPlace(repo);
    return [!!s.path && s.entries.length > 0, `path=${s.path} commits=${s.entries.length} error=${s.errorMessage}`];
  });
  await step("화면에 커밋 행 표시", async () => [await until(() => document.querySelectorAll(".commit-row").length > 0, 5000), document.querySelectorAll(".commit-row").length]);
  await step("브랜치·태그 읽기", async () => [s.localBranches.length >= 2 && s.tags.length >= 1, `branches=${s.localBranches.map((b) => b.name)} tags=${s.tags.map((t) => t.name)}`]);
  await step("그래프 레인(머지)", async () => [s.maxLanes >= 2 && s.entries.some((e) => e.commit.parents.length > 1), `lanes=${s.maxLanes}`]);

  const file = joinPath(repo, "selftest-새파일.txt");
  await step("파일 감시 → 새 파일 표시", async () => {
    await ipc.writeText(file, "안녕하세요 Branchwork\nline 2\n");
    return [await until(() => s.status.unstaged.some((c) => c.path.startsWith("selftest-")), 10000), JSON.stringify(s.status.unstaged.map((c) => c.path))];
  });
  await step("새 파일 diff", async () => {
    const c = s.status.unstaged.find((x) => x.path.startsWith("selftest-"));
    if (!c) return [false, "파일 없음"];
    s.openDiff({ kind: "working", change: c });
    const ok = await until(() => !!s.diff && s.diff.lines.some((l) => l.text.includes("안녕하세요")), 5000);
    s.closeDiff();
    return [ok, s.diff?.error];
  });
  await step("스테이지", async () => {
    await s.stageAll();
    return [s.status.staged.length > 0 && !s.status.unstaged.length, `staged=${s.status.staged.length}`];
  });
  await step("커밋(한글 메시지)", async () => {
    const before = s.entries.filter((e) => !isWIP(e.commit)).length;
    s.setSummary("자동 점검 커밋");
    s.setMessage("본문 줄");
    await s.commit();
    const top = s.entries.find((e) => !isWIP(e.commit))?.commit;
    return [top?.subject === "자동 점검 커밋" && s.entries.length > before - 1 && statusIsEmpty(s.status), `top=${top?.subject} error=${s.errorMessage}`];
  });
  await step("커밋 상세", async () => {
    s.select({ kind: "commit", sha: s.headHash! });
    return [await until(() => s.detail?.summary === "자동 점검 커밋" && s.detailFiles.length > 0, 5000), `${s.detail?.summary} files=${s.detailFiles.length}`];
  });
  await step("브랜치 만들기·체크아웃", async () => {
    await s.createBranch("selftest/branch", s.headHash!, true);
    return [s.headBranch === "selftest/branch", s.headBranch];
  });
  await step("main 으로 돌아가 머지", async () => {
    const main = s.localBranches.find((b) => b.name === "main");
    if (!main) return [false, "main 없음"];
    await s.checkout(main);
    await s.merge("feature/login");
    return [s.headBranch === "main" && !s.errorMessage, `head=${s.headBranch} error=${s.errorMessage}`];
  });
  await step("커밋 검색", async () => {
    s.setSearch("login");
    const ok = await until(() => !s.searching && s.searchMatches.length > 0, 8000);
    const n = s.searchMatches.length;
    s.clearSearch();
    return [ok, n];
  });
  await step("Stash·Pop", async () => {
    await ipc.writeText(joinPath(repo, "README.md"), "changed by selftest\n");
    await until(() => !statusIsEmpty(s.status), 8000);
    await s.stash("selftest", true);
    const stashed = s.stashes.length > 0 && statusIsEmpty(s.status);
    await s.stashPop();
    return [stashed && !statusIsEmpty(s.status) && !s.stashes.length, `stashed=${stashed} stashes=${s.stashes.length} error=${s.errorMessage}`];
  });
  await step("변경 버리기", async () => {
    const c = s.status.unstaged[0];
    if (!c) return [false, "없음"];
    await s.run("버리기", ["restore", "--worktree", "--", c.path]);
    return [statusIsEmpty(s.status), JSON.stringify(s.status)];
  });

  // 터미널: 셸 실행, 출력, 터미널에서 친 git 명령이 그래프에 반영되는지
  await step("터미널 셸 실행", async () => {
    s.toggleTerminal();
    const t = s.activeTerminal!;
    const ok = await until(() => t.running && t.term.buffer.active.length > 0, 15000);
    await sleep(1500);
    await t.send("echo SELFTEST_OK\r");
    const echoed = await until(() => bufferText(t.term).split("\n").some((l) => l.trim() === "SELFTEST_OK"), 10000);
    return [ok && echoed, bufferText(t.term).slice(-300)];
  });
  await step("터미널의 git 명령 → 그래프 갱신", async () => {
    const t = s.activeTerminal!;
    await t.send('git commit --allow-empty -m "터미널에서 만든 커밋"\r');
    const ok = await until(() => s.entries.find((e) => !isWIP(e.commit))?.commit.subject === "터미널에서 만든 커밋", 15000);
    return [ok, s.entries[0]?.commit.subject];
  });

  // 도우미 모드(같은 실행 파일): git 자격 증명 응답, Claude Code 훅
  await step("GIT_ASKPASS 도우미", async () => {
    const r = await ipc.run(env.exe, ["Username for 'https://example.com': "], {
      env: { BRANCHWORK_ASKPASS: "1", BRANCHWORK_ASKPASS_COUNT: "1", BRANCHWORK_ASKPASS_HOST_1: "example.com", BRANCHWORK_ASKPASS_USER_1: "x-access-token", BRANCHWORK_ASKPASS_PASS_1: "secret" },
      timeoutMs: 15000,
    });
    const r2 = await ipc.run(env.exe, ["Password for 'https://x-access-token@example.com': "], {
      env: { BRANCHWORK_ASKPASS: "1", BRANCHWORK_ASKPASS_COUNT: "1", BRANCHWORK_ASKPASS_HOST_1: "example.com", BRANCHWORK_ASKPASS_USER_1: "x-access-token", BRANCHWORK_ASKPASS_PASS_1: "secret" },
      timeoutMs: 15000,
    });
    return [r.stdout.trim() === "x-access-token" && r2.stdout.trim() === "secret", `${r.status} [${r.stdout.trim()}] [${r2.stdout.trim()}] ${r.stderr}`];
  });
  await step("Claude Code 훅 도우미", async () => {
    const id = "selftest-" + Date.now();
    await ipc.run(env.exe, ["--agent-hook", "Stop"], { stdin: '{"session_id":"x"}', env: { BRANCHWORK_AGENT_ID: id }, timeoutMs: 15000 });
    const text = await ipc.readText(joinPath(env.dataDir, "agents", id + ".state"));
    await ipc.remove(joinPath(env.dataDir, "agents", id + ".state"));
    return [!!text && text.includes('"event":"Stop"'), text];
  });
  await step("자격 증명 저장소", async () => {
    await ipc.secretSet("selftest", "값-123");
    const v = await ipc.secretGet("selftest");
    await ipc.secretSet("selftest", null);
    const gone = await ipc.secretGet("selftest");
    return [v === "값-123" && gone === null, `${v} / ${gone}`];
  });
  await step("HTTPS 요청", async () => {
    const r = await ipc.http("GET", "https://api.github.com/zen", { "User-Agent": "Branchwork" });
    return [r.status === 200 || r.status === 403, r.status];
  });
  await step("DNS 조회", async () => {
    const a = await ipc.resolveHost("github.com");
    return [a.length > 0, a.join(",")];
  });
  // 도구: 자동으로 찾은 git 을 '직접 지정'으로 바꿨다가 되돌리기
  await step("도구 찾기·불러오기", async () => {
    const auto = tools.state.git;
    if (!auto.path) return [false, "git 못 찾음"];
    await tools.setCustom("git", auto.path);
    const custom = tools.state.git.source === "custom" && tools.state.git.path === auto.path;
    let rejected = false;
    try {
      await tools.setCustom("git", joinPath(repo, "README.md"));
    } catch {
      rejected = true;
    }
    await tools.resetToAuto("git");
    const shell = tools.path("shell");
    return [custom && rejected && tools.state.git.source === "auto" && !!shell, `git=${auto.path} custom=${custom} rejected=${rejected} shell=${shell} version=${tools.state.git.version}`];
  });

  // AI: 가짜 OpenAI 호환 서버(tests/mock-ai-server.mjs)가 떠 있으면 실제로 커밋 메시지를 받아 본다
  await step("AI(OpenAI 호환)로 커밋 메시지", async () => {
    const base = "http://127.0.0.1:18080/v1";
    try {
      const ping = await ipc.http("GET", base + "/models", {}, undefined, 3000);
      if (ping.status !== 200) return [true, "가짜 AI 서버 없음 — 건너뜀"];
    } catch {
      return [true, "가짜 AI 서버 없음 — 건너뜀"];
    }
    const prev = { provider: ai.provider, base: ai.baseURL, model: ai.models.compatible };
    ai.setProvider("compatible");
    ai.setBaseURL(base);
    const models = await ai.listModels("compatible");
    ai.setModel("compatible", models[0] ?? "mock-model");
    await ipc.writeText(joinPath(repo, "ai-test.txt"), "hello\n");
    await until(() => s.status.unstaged.some((c) => c.path === "ai-test.txt"), 8000);
    await s.stage(s.status.unstaged.filter((c) => c.path === "ai-test.txt"));
    await s.generateCommitMessage();
    const summary = s.summary;
    s.setSummary("");
    s.setMessage("");
    await s.unstageAll();
    await ipc.remove(joinPath(repo, "ai-test.txt"));
    ai.setProvider(prev.provider);
    ai.setBaseURL(prev.base);
    if (prev.model !== undefined) ai.setModel("compatible", prev.model);
    return [summary === "가짜 AI 커밋: ai-test.txt", `models=${models} summary=${summary} error=${s.errorMessage}`];
  });

  // 규칙 + 나눠서 커밋: 확장자별로 나누는 가짜 AI 로 2개 커밋이 생기는지
  await step("규칙 적용 + 나눠서 커밋", async () => {
    let up = false;
    try {
      up = (await ipc.http("GET", "http://127.0.0.1:18080/v1/models", {}, undefined, 3000)).status === 200;
    } catch {
      up = false;
    }
    if (!up) return [true, "가짜 AI 서버 없음 — 건너뜀"];
    const prev = { provider: ai.provider, base: ai.baseURL, rules: ai.instructions.commit ?? "" };
    ai.setProvider("compatible");
    ai.setBaseURL("http://127.0.0.1:18080/v1");
    ai.setModel("compatible", "mock-model");
    ai.setInstructions("commit", "1. RULE-TEST 규칙");
    for (const f of ["split-a.md", "split-b.md", "split-c.txt"]) await ipc.writeText(joinPath(repo, f), f + "\n");
    await until(() => s.splittableChanges.length >= 3, 8000);
    const before = s.entries.filter((e) => !isWIP(e.commit)).length;
    await s.planSplit();
    const plan = s.splitPlan ?? [];
    const planText = plan.map((g) => `${g.message}=[${g.files}]`).join(" ");
    s.sheet = null;
    const ok1 = plan.length === 2 && plan.every((g) => g.message.startsWith("Rule: "));
    await s.applySplit(plan);
    const after = s.entries.filter((e) => !isWIP(e.commit));
    const subjects = after.slice(0, 2).map((e) => e.commit.subject);
    ai.setInstructions("commit", prev.rules);
    ai.setProvider(prev.provider);
    ai.setBaseURL(prev.base);
    return [ok1 && after.length === before + 2 && subjects.includes("Rule: md 파일 정리") && subjects.includes("Rule: txt 파일 정리") && statusIsEmpty(s.status), `plan=${planText} subjects=${subjects} error=${s.errorMessage}`];
  });

  // 자동 업데이트: 가짜 업데이트 서버에서 서명이 맞는 파일만 받는지(점검용 빌드는 한 단계 낮은 버전으로 만든다)
  await step("자동 업데이트(서명 확인)", async () => {
    const base = "http://127.0.0.1:18080/update";
    let up = false;
    try {
      up = (await ipc.http("GET", base + "/latest.json", {}, undefined, 3000)).status === 200;
    } catch {
      up = false;
    }
    if (!up) return [true, "가짜 업데이트 서버 없음 — 건너뜀"];
    const info = await invoke<{ version: string; current: string } | null>("update_check", { endpoint: base + "/latest.json" });
    if (!info) return [false, `업데이트를 못 찾음(현재 ${env.version})`];
    const size = await invoke<number>("update_verify");
    await invoke("update_check", { endpoint: base + "/tampered.json" });
    let rejected = "";
    try {
      await invoke("update_verify");
    } catch (e) {
      rejected = String(e);
    }
    return [size > 0 && !!rejected, `version=${info.current}→${info.version} size=${size} tampered=${rejected.slice(0, 120)}`];
  });

  // WSL: 배포판 안의 (가짜) claude 로 글 작성·에이전트 세션·WSL 셸
  await step("WSL 의 Claude Code", async () => {
    const distros = await listDistros(true);
    if (!distros.length) return [true, "WSL 없음 — 건너뜀"];
    const distro = distros[0];
    const prevProvider = ai.provider;
    try {
      await tools.useWsl("claude", distro);
    } catch (e) {
      return [true, `${distro} 에 claude 없음 — 건너뜀 (${e})`];
    }
    const w = tools.wsl("claude");
    if (!w?.path.endsWith("/.claude/local/claude")) return [false, `alias 로만 잡힌 claude 를 못 찾음: ${w?.path}`];
    // 1) 커밋 메시지(시스템 지시는 임시 파일로 넘어감)
    ai.setProvider("claudeCode");
    await ipc.writeText(joinPath(repo, "ai-wsl.txt"), "wsl\n");
    await until(() => s.status.unstaged.some((c) => c.path === "ai-wsl.txt"), 8000);
    await s.stage(s.status.unstaged.filter((c) => c.path === "ai-wsl.txt"));
    await s.generateCommitMessage();
    const summary = s.summary;
    const aiErr = s.errorMessage;
    s.setSummary("");
    await s.unstageAll();
    await ipc.remove(joinPath(repo, "ai-wsl.txt"));
    // 2) 에이전트 세션: WSL 경로로 열리고, 훅(윈도 실행 파일)이 세션 상태를 남기는지
    await s.startAgent(repo, "", null, "claude");
    const t = s.activeTerminal!;
    const pathOk = await until(() => bufferText(t.term).includes(`pwd=${toWslPath(repo)}`), 30000);
    const hookOk = await until(() => agents.sessions.some((x) => x.kind === "claude" && x.status === "waiting"), 15000);
    const agentLine = bufferText(t.term).split("\n").find((l) => l.includes("FAKE CLAUDE")) ?? bufferText(t.term).slice(-300);
    t.terminate();
    // 3) 터미널 셸을 WSL 로
    tools.setShellWsl(distro);
    await until(() => tools.path("shell") === `wsl:${distro}`, 3000);
    const sh = s.newTerminal();
    const shellOk = await until(async () => {
      if (sh.running && !bufferText(sh.term).includes("WSLSHELL")) await sh.send("echo WSLSHELL:$WSL_DISTRO_NAME:$PWD\r");
      return bufferText(sh.term).split("\n").some((l) => l.trim() === `WSLSHELL:${distro}:${toWslPath(repo)}`);
    }, 30000);
    const shellLine = bufferText(sh.term).slice(-200);
    sh.terminate();
    await tools.resetToAuto("shell");
    tools.useWindows("claude");
    ai.setProvider(prevProvider);
    return [
      summary === `WSL 커밋: You write git / b/ai-wsl.txt` && pathOk && hookOk && shellOk,
      `distro=${distro} path=${w?.path} summary=${summary} err=${aiErr} agent=${agentLine} hook=${hookOk} shell=${shellOk} ${shellLine.replace(/\s+/g, " ")}`,
    ];
  });

  // CI/CD: 가짜 GitLab·GitHub 서버로 파이프라인·작업 읽기, 수동 작업 실행, 새 파이프라인, workflow_dispatch
  await step("CI/CD(수동 작업 실행·워크플로 실행)", async () => {
    const root = "http://127.0.0.1:18080";
    try {
      if ((await ipc.http("GET", root + "/ci/calls", {}, undefined, 3000)).status !== 200) return [true, "가짜 서버 없음 — 건너뜀"];
    } catch {
      return [true, "가짜 서버 없음 — 건너뜀"];
    }
    const gl = { target: { provider: "gitlab" as const, remote: "origin", host: "127.0.0.1", path: "g/p" }, token: "gl-token", apiBase: root + "/api/v4" };
    const pipes = await CIAPI.pipelines(gl, null);
    const jobs = await CIAPI.jobs(gl, pipes[0].id);
    const manual = jobs.filter(canPlay);
    await CIAPI.play(gl, manual[0].id);
    await CIAPI.runPipeline(gl, "main", [["DEPLOY_ENV", "staging"]]);
    const gh = { target: { provider: "github" as const, remote: "origin", host: "github.com", path: "o/r" }, token: "gh-token", apiBase: root + "/gh" };
    const flows = await CIAPI.workflows(gh, "main");
    await CIAPI.dispatch(gh, flows[0].id, "main", { target: "production" });
    const calls = JSON.parse((await ipc.http("GET", root + "/ci/calls", {})).body) as { url: string; body: unknown; token: string }[];
    const urls = calls.map((c) => c.url);
    // 화면: CI/CD 탭이 그려지는지(이 저장소는 원격이 없어 안내 문구)
    settings.set("sidebarMode", "ci");
    const panel = await until(() => document.body.innerText.includes("원격이 있는 저장소에서 파이프라인"), 3000);
    settings.set("sidebarMode", "list");
    const ok =
      pipes.length === 1 &&
      pipes[0].status === "success" &&
      jobs.map((j) => j.name).join(",") === "build,deploy-prod" &&
      manual.length === 1 &&
      urls.includes("/api/v4/projects/g%2Fp/jobs/102/play") &&
      calls.some((c) => c.url === "/api/v4/projects/g%2Fp/pipeline" && JSON.stringify(c.body).includes("DEPLOY_ENV") && c.token === "gl-token") &&
      flows.length === 1 &&
      flows[0].inputs[0]?.options.join(",") === "staging,production" &&
      calls.some((c) => c.url === "/gh/repos/o/r/actions/workflows/7/dispatches" && JSON.stringify(c.body) === '{"ref":"main","inputs":{"target":"production"}}' && c.token === "Bearer gh-token") &&
      panel;
    return [ok, `pipes=${pipes.length} jobs=${jobs.map((j) => `${j.stage}/${j.name}:${j.status}`)} flows=${flows.map((f) => f.name + ":" + f.inputs.map((i) => i.name))} calls=${urls} panel=${panel}`];
  });

  await step("설정 화면", async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: !isMacLike(), metaKey: isMacLike(), bubbles: true }));
    const ok = await until(() => !!document.querySelector(".modal") && document.body.innerText.includes("사내 GitLab"), 3000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(200);
    return [ok, ""];
  });

  // 화면 캡처용: 그래프 + 터미널이 보이는 상태로 둔다
  s.select({ kind: "wip" });
  s.select({ kind: "commit", sha: s.headHash! });
  const result = { ok: checks.every((c) => c.ok), os: env.os, windows: isWindows(), checks };
  await ipc.writeText(out, JSON.stringify(result, null, 2));
  if (env.selftestOpen) window.dispatchEvent(new CustomEvent("bw-open-settings", { detail: env.selftestOpen }));
  return true;
}

function isMacLike() {
  return env.os === "macos";
}

function bufferText(term: import("@xterm/xterm").Terminal) {
  const b = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n");
}
