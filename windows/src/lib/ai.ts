import { env } from "./env";
import { ipc } from "./ipc";
import { Observable } from "./observable";
import { settings } from "./settings";
import { tools, type ToolId } from "./tools";
import { tempFile, wslArgs } from "./wsl";

/**
 * 글 작성(커밋 메시지·커밋 설명·PR 본문)에 쓰는 AI.
 * CLI 는 이 PC 에 로그인한 계정을 그대로 쓰고(도구는 끈 채 글만), API 는 키로 직접 부른다.
 */
export type AIProviderId = "claudeCode" | "codex" | "geminiCli" | "anthropic" | "openai" | "gemini" | "compatible";

export interface AIProviderInfo {
  id: AIProviderId;
  title: string;
  /** 버튼 문구용 짧은 이름: "Claude로 작성" */
  short: string;
  kind: "cli" | "api";
  tool?: ToolId;
  defaultModel: string;
  modelHint: string;
  keyHint?: string;
  keyURL?: string;
  note: string;
}

export const aiProviders: AIProviderInfo[] = [
  { id: "claudeCode", title: "Claude Code (로그인 사용)", short: "Claude", kind: "cli", tool: "claude", defaultModel: "", modelHint: "비우면 Claude Code 기본값", note: "이 PC 에서 로그인한 Claude Code 를 그대로 씁니다. 도구는 모두 끈 채 글만 생성합니다." },
  { id: "codex", title: "Codex (ChatGPT 로그인 사용)", short: "ChatGPT", kind: "cli", tool: "codex", defaultModel: "", modelHint: "비우면 Codex 기본값", note: "이 PC 에서 ChatGPT 계정으로 로그인한 Codex CLI 를 읽기 전용으로 실행해 글만 받습니다." },
  { id: "geminiCli", title: "Gemini CLI (Google 로그인 사용)", short: "Gemini", kind: "cli", tool: "gemini", defaultModel: "", modelHint: "비우면 Gemini CLI 기본값", note: "이 PC 에서 로그인한 Gemini CLI 를 읽기 전용(plan) 모드로 실행해 글만 받습니다." },
  { id: "anthropic", title: "Claude API (Anthropic)", short: "Claude", kind: "api", defaultModel: "claude-opus-5-5", modelHint: "claude-opus-5-5", keyHint: "sk-ant-…", keyURL: "https://console.anthropic.com/settings/keys", note: "요청이 안전 분류기에 막히면 서버가 권장 모델로 한 번 더 시도하도록(fallbacks) 켜 두었습니다." },
  { id: "openai", title: "ChatGPT API (OpenAI)", short: "ChatGPT", kind: "api", defaultModel: "gpt-5", modelHint: "gpt-5", keyHint: "sk-…", keyURL: "https://platform.openai.com/api-keys", note: "OpenAI API 키로 Chat Completions 를 부릅니다." },
  { id: "gemini", title: "Gemini API (Google)", short: "Gemini", kind: "api", defaultModel: "gemini-2.5-flash", modelHint: "gemini-2.5-flash", keyHint: "AIza…", keyURL: "https://aistudio.google.com/apikey", note: "Google AI Studio API 키로 Gemini 를 부릅니다." },
  { id: "compatible", title: "OpenAI 호환 (Ollama·LM Studio·OpenRouter 등)", short: "AI", kind: "api", defaultModel: "", modelHint: "llama3.1, qwen2.5-coder …", keyHint: "필요할 때만", note: "OpenAI 형식(/chat/completions)을 받는 서버라면 무엇이든 됩니다. 예: Ollama http://localhost:11434/v1" },
];

export const providerById = (id: AIProviderId) => aiProviders.find((p) => p.id === id)!;

/** AI 를 쓰는 기능. 기능마다 규칙(지시사항)과 쓸 AI 를 따로 정할 수 있다. */
export type AIFeature = "commit" | "explain" | "pullRequest";
export type InstructionKey = "global" | AIFeature;

export const instructionInfo: { id: InstructionKey; title: string; detail: string; chips: string[] }[] = [
  {
    id: "global",
    title: "공통 규칙",
    detail: "아래 기능마다 따로 적은 규칙과 함께 모든 AI 기능에 적용됩니다.",
    chips: ["한국어로 작성", "영어로 작성", "간결하게", "명령형으로", "기술적인 말투", "부드러운 말투"],
  },
  {
    id: "commit",
    title: "커밋 메시지 작성 · 나눠서 커밋",
    detail: "커밋 메시지를 쓰거나 변경을 여러 커밋으로 나눌 때 따릅니다.",
    chips: [
      "Conventional Commits 형식(feat: …)",
      "prefix 는 Feature, Fix, Hotfix, Refactoring, Style, Chore, Remove 중 하나",
      "prefix 의 첫 글자는 대문자",
      "제목 50자 이내",
      "이슈 번호 포함",
      "본문 없이 제목만",
      "무엇을·왜 바꿨는지 중심으로",
    ],
  },
  {
    id: "explain",
    title: "커밋 설명",
    detail: "커밋·변경 내용을 설명할 때 따릅니다.",
    chips: ["업무에 주는 영향 위주로", "글머리표로", "영향받는 부분 포함", "초보자도 알기 쉽게"],
  },
  {
    id: "pullRequest",
    title: "PR·MR 설명",
    detail: "Pull/Merge Request 제목과 본문을 쓸 때 따릅니다.",
    chips: ["변경 이유를 먼저", "테스트 방법 포함", "체크리스트 형식", "관련 이슈 번호 포함", "스크린샷 자리 남기기"],
  },
];

/** API 오류를 읽기 쉬운 문장으로 */
function apiError(provider: string, status: number, body: string) {
  let msg = body.slice(0, 300);
  try {
    const j = JSON.parse(body);
    msg = j.error?.message ?? j.message ?? j[0]?.error?.message ?? msg;
  } catch {
    /* 본문 그대로 */
  }
  if (status === 401 || status === 403) return new Error(`${provider}: API 키가 올바르지 않거나 권한이 없습니다(${status}). ${msg}`);
  if (status === 404) return new Error(`${provider}: 모델이나 주소를 찾을 수 없습니다(404). 모델 이름을 확인하세요. ${msg}`);
  if (status === 429) return new Error(`${provider}: 사용 한도에 걸렸습니다(429). 잠시 뒤 다시 시도하세요. ${msg}`);
  return new Error(`${provider}: HTTP ${status} — ${msg}`);
}

class AI extends Observable {
  provider: AIProviderId = "claudeCode";
  models: Partial<Record<AIProviderId, string>> = {};
  baseURL = "http://localhost:11434/v1";
  hasKey: Partial<Record<AIProviderId, boolean>> = {};
  /** 사용자가 적은 규칙(공통·기능별) */
  instructions: Partial<Record<InstructionKey, string>> = {};
  /** 기능별로 다른 AI 를 쓰고 싶을 때(없으면 기본 AI) */
  featureProvider: Partial<Record<AIFeature, AIProviderId>> = {};
  private keys = new Map<AIProviderId, string | null>();

  async load() {
    // 예전 설정(Claude 만 있던 때)을 옮긴다
    const oldMode = settings.get<string | null>("claudeMode", null);
    if (oldMode && !settings.get("aiProvider", null)) {
      settings.set("aiProvider", oldMode === "api" ? "anthropic" : "claudeCode");
      settings.set("aiModels", { anthropic: settings.get("claudeModel", "claude-opus-5-5"), claudeCode: settings.get("claudeCLIModel", "") });
      if (settings.get("hasClaudeKey", false)) {
        const k = await ipc.secretGet("anthropic").catch(() => null);
        if (k) {
          await ipc.secretSet("ai:anthropic", k).catch(() => {});
          settings.set("aiKeys", { anthropic: true });
        }
      }
    }
    this.models = settings.get("aiModels", {});
    this.baseURL = settings.get("aiBaseURL", this.baseURL);
    this.hasKey = settings.get("aiKeys", {});
    this.instructions = settings.get("aiInstructions", {});
    this.featureProvider = settings.get("aiFeatureProvider", {});
    const saved = settings.get<AIProviderId | null>("aiProvider", null);
    this.provider = saved ?? this.firstAvailable();
    this.emit();
  }

  /** 처음 켰을 때: 설치된 CLI 가 있으면 그걸로 */
  private firstAvailable(): AIProviderId {
    for (const p of aiProviders) if (p.kind === "cli" && p.tool && tools.available(p.tool)) return p.id;
    return "anthropic";
  }

  get info() {
    return providerById(this.provider);
  }

  /** "Claude로 작성" 같은 버튼 문구 */
  get short() {
    return this.info.short;
  }

  providerFor(f: AIFeature): AIProviderId {
    return this.featureProvider[f] ?? this.provider;
  }

  shortFor(f: AIFeature) {
    return providerById(this.providerFor(f)).short;
  }

  setFeatureProvider(f: AIFeature, id: AIProviderId | null) {
    const next = { ...this.featureProvider };
    if (id) next[f] = id;
    else delete next[f];
    this.featureProvider = next;
    settings.set("aiFeatureProvider", next);
    this.emit();
  }

  setInstructions(key: InstructionKey, text: string) {
    this.instructions = { ...this.instructions, [key]: text };
    settings.set("aiInstructions", this.instructions);
    this.emit();
  }

  /** 기본 지시 + 사용자가 적은 규칙(공통 → 기능별). 규칙이 기본 지시보다 우선한다. */
  systemFor(f: AIFeature, base: string) {
    const rules = [this.instructions.global, this.instructions[f]].map((r) => (r ?? "").trim()).filter(Boolean);
    if (!rules.length) return base;
    return `${base}\n\nThe user set the following rules. Follow them exactly; they take priority over the style guidance above (for example the language, prefixes, and format):\n${rules.join("\n")}`;
  }

  /** 기능 하나 실행: 그 기능의 AI·규칙으로 */
  write(f: AIFeature, base: string, prompt: string, effort: string) {
    return this.complete(this.systemFor(f, base), prompt, effort, this.providerFor(f));
  }

  model(id: AIProviderId = this.provider) {
    return this.models[id] ?? providerById(id).defaultModel;
  }

  setProvider(id: AIProviderId) {
    this.provider = id;
    settings.set("aiProvider", id);
    this.emit();
  }

  setModel(id: AIProviderId, model: string) {
    this.models = { ...this.models, [id]: model.trim() };
    settings.set("aiModels", this.models);
    this.emit();
  }

  setBaseURL(url: string) {
    this.baseURL = url.trim().replace(/\/+$/, "");
    settings.set("aiBaseURL", this.baseURL);
    this.emit();
  }

  async setKey(id: AIProviderId, key: string) {
    const k = key.trim();
    await ipc.secretSet("ai:" + id, k || null);
    this.keys.set(id, k || null);
    this.hasKey = { ...this.hasKey, [id]: !!k };
    settings.set("aiKeys", this.hasKey);
    this.emit();
  }

  private async key(id: AIProviderId) {
    if (!this.hasKey[id]) return null;
    if (!this.keys.has(id)) this.keys.set(id, await ipc.secretGet("ai:" + id).catch(() => null));
    return this.keys.get(id) ?? null;
  }

  /** 지금 고른 AI 를 쓸 수 있는지(안 되면 이유) */
  problem(id: AIProviderId = this.provider): string | null {
    const p = providerById(id);
    if (p.kind === "cli") return p.tool && tools.available(p.tool) ? null : `${p.title.split(" (")[0]} 를 찾지 못했습니다. 설정 > 도구에서 실행 파일을 불러오거나 WSL 에서 찾아 주세요.`;
    if (id === "compatible") return this.baseURL ? null : "서버 주소를 입력하세요.";
    return this.hasKey[id] ? null : `설정 > AI 에서 ${p.title} 키를 입력하세요.`;
  }

  /** 글 한 번 생성. effort 는 Claude API 에서만 쓴다(low/medium/high). */
  async complete(system: string, prompt: string, effort: string, id: AIProviderId = this.provider): Promise<string> {
    const problem = this.problem(id);
    if (problem) throw new Error(problem);
    const model = this.model(id);
    switch (id) {
      case "claudeCode":
        return this.cli("claude", ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence", "--system-prompt", { text: system }, ...(model ? ["--model", model] : [])], prompt, "Claude Code");
      case "codex":
        return this.cli(
          "codex",
          ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", ...(model ? ["-m", model] : []), "-"],
          `${system}\n\n---\n\n${prompt}`,
          "Codex",
        );
      case "geminiCli":
        // -p 의 글은 표준 입력 뒤에 붙는다: 내용(표준 입력) 다음에 지시(시스템 프롬프트)
        return this.cli("gemini", ["-p", { text: system }, "-o", "text", "--approval-mode", "plan", ...(model ? ["-m", model] : [])], prompt, "Gemini CLI");
      case "anthropic":
        return this.anthropic((await this.key(id))!, model, system, prompt, effort);
      case "openai":
        return this.chatCompletions("https://api.openai.com/v1", await this.key(id), model, system, prompt, "ChatGPT");
      case "compatible":
        return this.chatCompletions(this.baseURL, await this.key(id), model, system, prompt, "AI 서버");
      case "gemini":
        return this.gemini((await this.key(id))!, model, system, prompt);
    }
  }

  /** CLI 실행. 여러 줄 글({ text })은 WSL 로 실행할 때 임시 파일로 넘긴다. */
  private async cli(tool: ToolId, args: (string | { text: string })[], stdin: string, name: string) {
    const cmd = tools.command(tool);
    if (!cmd) throw new Error(`${name} 를 찾지 못했습니다.`);
    let exe: string, argv: string[];
    const temps: string[] = [];
    if (cmd.kind === "native") {
      exe = cmd.exe;
      argv = args.map((a) => (typeof a === "string" ? a : a.text));
    } else {
      exe = "wsl.exe";
      const mapped: string[] = [];
      for (const a of args) {
        if (typeof a === "string") mapped.push(a);
        else {
          const f = await tempFile("arg.txt", a.text);
          temps.push(f.windows);
          mapped.push("@file:" + f.wsl);
        }
      }
      argv = wslArgs(cmd.distro, cmd.path, mapped);
    }
    let r;
    try {
      r = await ipc.run(exe, argv, { cwd: env.temp, stdin, timeoutMs: 300_000 });
    } finally {
      for (const t of temps) void ipc.remove(t);
    }
    const out = r.stdout.trim();
    if (r.status !== 0 || !out) {
      const err = r.stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      throw new Error(`${name} 응답 실패: ` + (err || out || `응답이 없습니다(종료 코드 ${r.status}).`));
    }
    return out;
  }

  private async anthropic(key: string, model: string, system: string, prompt: string, effort: string) {
    const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    const body: Record<string, unknown> = {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort },
    };
    // 안전 분류기가 거절하면 서버가 권장 모델로 다시 시도한다(Haiku 는 서버 측 대체가 없어 보내지 않음)
    if (!model.includes("haiku")) {
      body.fallbacks = "default";
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    }
    const r = await ipc.http("POST", "https://api.anthropic.com/v1/messages", headers, JSON.stringify(body), 300_000);
    if (r.status !== 200) throw apiError("Claude", r.status, r.body);
    const data = JSON.parse(r.body) as { content: { type: string; text?: string }[]; stop_reason?: string };
    if (data.stop_reason === "refusal") throw new Error("Claude 가 이 요청을 거절했습니다. 내용을 바꿔 다시 시도해 보세요.");
    const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!text) throw new Error("Claude: 빈 응답");
    return text;
  }

  private async chatCompletions(base: string, key: string | null, model: string, system: string, prompt: string, name: string) {
    if (!model) throw new Error(`${name}: 모델을 정하세요(설정 > AI).`);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const body = { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] };
    const r = await ipc.http("POST", base.replace(/\/+$/, "") + "/chat/completions", headers, JSON.stringify(body), 300_000);
    if (r.status !== 200) throw apiError(name, r.status, r.body);
    const data = JSON.parse(r.body) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
    const m = data.choices?.[0]?.message;
    if (m?.refusal) throw new Error(`${name} 가 이 요청을 거절했습니다: ${m.refusal}`);
    const text = (m?.content ?? "").trim();
    if (!text) throw new Error(`${name}: 빈 응답`);
    return text;
  }

  private async gemini(key: string, model: string, system: string, prompt: string) {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const r = await ipc.http("POST", url, { "content-type": "application/json", "x-goog-api-key": key }, JSON.stringify(body), 300_000);
    if (r.status !== 200) throw apiError("Gemini", r.status, r.body);
    const data = JSON.parse(r.body) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    if (data.promptFeedback?.blockReason) throw new Error(`Gemini 가 이 요청을 막았습니다(${data.promptFeedback.blockReason}).`);
    const c = data.candidates?.[0];
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error(c?.finishReason === "SAFETY" ? "Gemini 가 안전 정책으로 응답하지 않았습니다." : "Gemini: 빈 응답");
    return text;
  }

  /** 계정에서 쓸 수 있는 모델 목록(API 방식) */
  async listModels(id: AIProviderId): Promise<string[]> {
    const key = await this.key(id);
    let r;
    switch (id) {
      case "anthropic":
        if (!key) throw new Error("먼저 API 키를 저장하세요.");
        r = await ipc.http("GET", "https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" });
        if (r.status !== 200) throw apiError("Claude", r.status, r.body);
        return (JSON.parse(r.body).data as { id: string }[]).map((m) => m.id);
      case "openai":
      case "compatible": {
        if (id === "openai" && !key) throw new Error("먼저 API 키를 저장하세요.");
        const base = id === "openai" ? "https://api.openai.com/v1" : this.baseURL;
        r = await ipc.http("GET", base.replace(/\/+$/, "") + "/models", key ? { authorization: `Bearer ${key}` } : {});
        if (r.status !== 200) throw apiError(id === "openai" ? "ChatGPT" : "AI 서버", r.status, r.body);
        const ids = ((JSON.parse(r.body).data ?? []) as { id: string }[]).map((m) => m.id);
        // OpenAI 는 글 생성 모델만 추린다(임베딩·음성·이미지 제외)
        const list = id === "openai" ? ids.filter((m) => /^(gpt|o\d|chatgpt)/.test(m) && !/(audio|realtime|transcribe|tts|image|embedding|search)/.test(m)) : ids;
        return list.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      }
      case "gemini":
        if (!key) throw new Error("먼저 API 키를 저장하세요.");
        r = await ipc.http("GET", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key });
        if (r.status !== 200) throw apiError("Gemini", r.status, r.body);
        return ((JSON.parse(r.body).models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
          .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m) => m.name.replace(/^models\//, ""))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      default:
        return [];
    }
  }
}

export const ai = new AI();

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

  split: `You split a set of uncommitted git changes into a sequence of small, focused commits.
Group files that belong to the same logical change (one feature, one fix, one refactor, docs, config …). Every listed file must appear in exactly one commit; never invent paths.
Order the commits so each one builds on the previous (shared refactors and dependencies first).
Write each commit message as a commit message for that group: a summary line of at most 72 characters, optionally a blank line and a short body.
Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in Korean.
Reply with JSON only, no code fences, exactly in this shape: {"commits":[{"message":"summary\\n\\noptional body","files":["path/one","path/two"]}]}`,

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
