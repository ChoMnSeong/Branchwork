import { accounts } from "./accounts";
import { env, isWindows, joinPath } from "./env";
import { ipc } from "./ipc";

/** Claude 연결: 이 PC 의 Claude Code CLI(로그인 그대로) 또는 Anthropic API(Messages API) — 맥 버전 Claude.swift 와 같은 동작 */

export const defaultModel = "claude-opus-5-5";
export const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];

export async function findCLI(): Promise<string | null> {
  const home = env.home;
  const candidates = isWindows()
    ? [joinPath(home, ".local/bin/claude.exe"), joinPath(home, "AppData/Roaming/npm/claude.cmd")]
    : [joinPath(home, ".local/bin/claude"), joinPath(home, ".claude/local/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const c of candidates) if (await ipc.exists(c)) return c;
  return ipc.which("claude");
}

/** 텍스트 한 번 생성. effort 는 API 방식에서만 쓴다(low/medium/high). */
export async function complete(system: string, prompt: string, effort: string): Promise<string> {
  if (accounts.claudeMode === "cli") {
    const cli = accounts.cliPath;
    if (!cli) throw new Error("Claude Code(claude)를 찾지 못했습니다. 설정 > Claude 에서 API 키 방식으로 바꾸세요.");
    return viaCLI(cli, accounts.claudeCLIModel, system, prompt);
  }
  const key = await accounts.claudeKey();
  if (!key) throw new Error("설정 > Claude 에서 Anthropic API 키를 입력하세요.");
  return viaAPI(key, accounts.claudeModel, system, prompt, effort);
}

/** `claude -p` 비대화 실행. 도구를 모두 끄고(--tools "") 세션을 남기지 않는다. */
async function viaCLI(cli: string, model: string, system: string, prompt: string) {
  const args = ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence", "--system-prompt", system];
  if (model) args.push("--model", model);
  const r = await ipc.run(cli, args, { cwd: env.temp, stdin: prompt, timeoutMs: 300_000 });
  const out = r.stdout.trim();
  if (r.status !== 0 || !out) {
    const err = r.stderr.trim();
    throw new Error("Claude 응답 실패: " + (err || out || `Claude Code 가 응답하지 않았습니다(종료 코드 ${r.status}).`));
  }
  return out;
}

async function viaAPI(key: string, model: string, system: string, prompt: string, effort: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
  const body: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort },
  };
  // 안전 분류기가 거절하면 서버가 권장 모델로 다시 시도한다(Haiku 는 서버 측 대체가 없어 보내지 않음)
  if (model !== "claude-haiku-5-5") {
    body.fallbacks = "default";
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }
  const r = await ipc.http("POST", "https://api.anthropic.com/v1/messages", headers, JSON.stringify(body), 300_000);
  if (r.status !== 200) {
    let msg = r.body.slice(0, 300);
    try {
      msg = JSON.parse(r.body).error?.message ?? msg;
    } catch {
      /* 본문 그대로 */
    }
    throw new Error("Claude 응답 실패: " + (r.status === 401 ? "API 키가 올바르지 않습니다(401)." : `HTTP ${r.status}: ${msg}`));
  }
  const data = JSON.parse(r.body) as { content: { type: string; text?: string }[]; stop_reason?: string };
  if (data.stop_reason === "refusal") throw new Error("Claude 가 이 요청을 거절했습니다. 내용을 바꿔 다시 시도해 보세요.");
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Claude 응답 실패: 빈 응답");
  return text;
}

export const Prompts = {
  commit: `You write git commit messages for the staged changes the user sends.
Reply with the commit message only: no preamble, no code fences, no quotation marks.
First line: a concise summary of at most 72 characters in the imperative mood.
If the change needs explanation, add a blank line and a short body saying what changed and why.
Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in Korean.`,

  explain: `You explain a git commit to a developer who is reviewing the history. Answer in Korean.
Start with one sentence on what the commit does. Then list the key changes as short "-" bullets, naming files and functions.
End with anything risky or worth a closer look, or say that nothing stands out.
Be concrete and brief. Plain text only, no headings.`,

  pullRequest: `You write pull request descriptions from the commits and diff the user sends.
Reply in exactly this shape: the first line is the title (at most 72 characters, no "Title:" prefix), then a blank line, then the description in Markdown.
The description has a short summary paragraph, a bulleted list of the main changes, and a short note on how to test if the changes suggest one.
Use the same language as the commit messages; if unclear, write in Korean. Output nothing else.`,
};

/** 너무 긴 입력은 앞부분만 보내고, 잘렸으면 생략한 글자 수를 돌려준다 */
export function clip(s: string, limit = 400_000): { text: string; omitted: number } {
  if (s.length <= limit) return { text: s, omitted: 0 };
  return { text: s.slice(0, limit) + `\n\n[... 이후 ${s.length - limit}자 생략 ...]`, omitted: s.length - limit };
}

/** 첫 줄(요약/제목)과 나머지(본문)로 나눈다. 코드 펜스·따옴표로 감쌌으면 벗긴다. */
export function splitMessage(text: string): [string, string] {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.split("\n").slice(1).join("\n");
    if (t.endsWith("```")) t = t.slice(0, -3);
    t = t.trim();
  }
  const nl = t.indexOf("\n");
  let first = (nl < 0 ? t : t.slice(0, nl)).trim();
  if (first.length > 1 && first.startsWith('"') && first.endsWith('"')) first = first.slice(1, -1);
  return [first, nl < 0 ? "" : t.slice(nl + 1).trim()];
}
