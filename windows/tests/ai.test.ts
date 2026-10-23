import { beforeEach, describe, expect, it, vi } from "vitest";

// 백엔드 호출을 가짜로 바꿔 각 AI 에 보내는 요청 모양만 확인한다
const calls: { kind: string; args: unknown[] }[] = [];
let httpReply: { status: number; body: string } = { status: 200, body: "{}" };
let runReply = { status: 0, stdout: "요약 줄\n\n본문", stderr: "" };

vi.mock("../src/lib/ipc", () => ({
  ipc: {
    http: vi.fn(async (...args: unknown[]) => {
      calls.push({ kind: "http", args });
      return httpReply;
    }),
    run: vi.fn(async (...args: unknown[]) => {
      calls.push({ kind: "run", args });
      return runReply;
    }),
    secretGet: vi.fn(async () => "KEY"),
    secretSet: vi.fn(async () => {}),
    readText: vi.fn(async () => null),
    writeText: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    which: vi.fn(async () => null),
  },
}));

const { ai } = await import("../src/lib/ai");
const { tools } = await import("../src/lib/tools");

beforeEach(() => {
  calls.length = 0;
  ai.hasKey = { anthropic: true, openai: true, gemini: true, compatible: true };
  tools.state.claude = { path: "C:/x/claude.exe", source: "auto", version: null };
  tools.state.codex = { path: "C:/x/codex.cmd", source: "auto", version: null };
  tools.state.gemini = { path: "C:/x/gemini.cmd", source: "auto", version: null };
});

describe("AI 요청", () => {
  it("ChatGPT API: chat/completions, Bearer 키, system+user", async () => {
    httpReply = { status: 200, body: JSON.stringify({ choices: [{ message: { content: "Fix bug" } }] }) };
    ai.setModel("openai", "gpt-5");
    expect(await ai.complete("SYS", "PROMPT", "low", "openai")).toBe("Fix bug");
    const [method, url, headers, body] = calls[0].args as [string, string, Record<string, string>, string];
    expect(method).toBe("POST");
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(headers.authorization).toBe("Bearer KEY");
    expect(JSON.parse(body)).toEqual({ model: "gpt-5", messages: [{ role: "system", content: "SYS" }, { role: "user", content: "PROMPT" }] });
  });

  it("Gemini API: generateContent, systemInstruction", async () => {
    httpReply = { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "안녕" }, { text: "하세요" }] } }] }) };
    ai.setModel("gemini", "gemini-2.5-flash");
    expect(await ai.complete("SYS", "PROMPT", "low", "gemini")).toBe("안녕하세요");
    const [, url, headers, body] = calls[0].args as [string, string, Record<string, string>, string];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(headers["x-goog-api-key"]).toBe("KEY");
    expect(JSON.parse(body).systemInstruction.parts[0].text).toBe("SYS");
  });

  it("Claude API: messages, effort, fallbacks", async () => {
    httpReply = { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }) };
    expect(await ai.complete("SYS", "P", "medium", "anthropic")).toBe("OK");
    const [, url, headers, body] = calls[0].args as [string, string, Record<string, string>, string];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe("KEY");
    const b = JSON.parse(body);
    expect(b.model).toBe("claude-opus-5-5");
    expect(b.output_config).toEqual({ effort: "medium" });
    expect(b.fallbacks).toBe("default");
  });

  it("거절·오류를 알아듣게 알린다", async () => {
    httpReply = { status: 200, body: JSON.stringify({ content: [], stop_reason: "refusal" }) };
    await expect(ai.complete("S", "P", "low", "anthropic")).rejects.toThrow(/declined/);
    httpReply = { status: 401, body: JSON.stringify({ error: { message: "bad key" } }) };
    await expect(ai.complete("S", "P", "low", "openai")).rejects.toThrow(/401/);
  });

  it("OpenAI 호환: 서버 주소, 키 없어도 됨", async () => {
    ai.hasKey = { ...ai.hasKey, compatible: false };
    ai.setBaseURL("http://localhost:11434/v1/");
    ai.setModel("compatible", "qwen2.5-coder");
    httpReply = { status: 200, body: JSON.stringify({ choices: [{ message: { content: "msg" } }] }) };
    expect(await ai.complete("S", "P", "low", "compatible")).toBe("msg");
    const [, url, headers] = calls[0].args as [string, string, Record<string, string>];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(headers.authorization).toBeUndefined();
  });

  it("CLI: Claude Code · Codex · Gemini 인자", async () => {
    await ai.complete("SYS", "PROMPT", "low", "claudeCode");
    let [exe, args, o] = calls[0].args as [string, string[], { stdin: string }];
    expect(exe).toBe("C:/x/claude.exe");
    expect(args.slice(0, 6)).toEqual(["-p", "--output-format", "text", "--tools", "", "--no-session-persistence"]);
    expect(o.stdin).toBe("PROMPT");

    await ai.complete("SYS", "PROMPT", "low", "codex");
    [exe, args, o] = calls[1].args as [string, string[], { stdin: string }];
    expect(exe).toBe("C:/x/codex.cmd");
    expect(args).toEqual(["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "-"]);
    expect(o.stdin).toContain("SYS");
    expect(o.stdin).toContain("PROMPT");

    await ai.complete("SYS", "PROMPT", "low", "geminiCli");
    [exe, args, o] = calls[2].args as [string, string[], { stdin: string }];
    expect(args).toEqual(["-p", "SYS", "-o", "text", "--approval-mode", "plan"]);
    expect(o.stdin).toBe("PROMPT");
  });

  it("없는 CLI 는 설정 > 도구로 안내", async () => {
    tools.state.codex = { path: null, source: "none", version: null };
    await expect(ai.complete("S", "P", "low", "codex")).rejects.toThrow(/Tools/);
  });

  it("OpenAI 모델 목록은 글 생성 모델만", async () => {
    httpReply = { status: 200, body: JSON.stringify({ data: [{ id: "gpt-5" }, { id: "text-embedding-3-small" }, { id: "gpt-4o-audio-preview" }, { id: "o3" }, { id: "dall-e-3" }] }) };
    expect(await ai.listModels("openai")).toEqual(["o3", "gpt-5"]);
  });
});

describe("규칙·나눠서 커밋", () => {
  it("공통·기능별 규칙이 시스템 지시 뒤에 붙는다", async () => {
    ai.setInstructions("global", "한국어로 작성");
    ai.setInstructions("commit", "prefix 는 Feature, Fix 중 하나");
    const s = ai.systemFor("commit", "BASE");
    expect(s.startsWith("BASE")).toBe(true);
    expect(s).toContain("한국어로 작성");
    expect(s).toContain("prefix 는 Feature, Fix 중 하나");
    expect(ai.systemFor("explain", "BASE")).not.toContain("Feature, Fix");
    ai.setInstructions("global", "");
    ai.setInstructions("commit", "");
    expect(ai.systemFor("commit", "BASE")).toBe("BASE");
  });

  it("기능마다 다른 AI 를 쓸 수 있다", () => {
    ai.setProvider("claudeCode");
    ai.setFeatureProvider("explain", "gemini");
    expect(ai.providerFor("explain")).toBe("gemini");
    expect(ai.providerFor("commit")).toBe("claudeCode");
    ai.setFeatureProvider("explain", null);
    expect(ai.providerFor("explain")).toBe("claudeCode");
  });

  it("AI 가 나눈 JSON 을 계획으로(모르는 경로는 버리고 빠진 파일은 모음)", async () => {
    const { parseSplitPlan } = await import("../src/lib/split");
    const ch = (path: string, oldPath: string | null = null) => ({ path, oldPath, kind: "modified" as const, staged: false });
    const changes = [ch("a.ts"), ch("b.ts"), ch("new.ts", "old.ts"), ch("left.md")];
    const text = 'Sure:\n```json\n{"commits":[{"message":"Feature: A","files":["a.ts","ghost.ts","./b.ts"]},{"message":"Refactoring: 이름","files":["old.ts","a.ts"]}]}\n```';
    const plan = parseSplitPlan(text, changes);
    expect(plan.map((g) => [g.message, g.files])).toEqual([
      ["Feature: A", ["a.ts", "b.ts"]],
      ["Refactoring: 이름", ["new.ts"]],
      ["", ["left.md"]],
    ]);
    expect(() => parseSplitPlan("no json here", changes)).toThrow(/JSON/);
  });
});
