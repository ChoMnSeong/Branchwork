import { env, isWindows, joinPath, dirname } from "./lib/env";
import { ipc } from "./lib/ipc";
import { isWIP, statusIsEmpty } from "./lib/models";
import { workspace } from "./lib/workspace";

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
    return [stashed && !statusIsEmpty(s.status), `stashes=${s.stashes.length}`];
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
