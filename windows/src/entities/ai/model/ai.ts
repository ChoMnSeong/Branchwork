import { ipc } from "@/shared/api";
import { env, settings } from "@/shared/config";
import { languageInEnglish, t } from "@/shared/i18n";
import { Observable } from "@/shared/lib";
import { tempFile, type ToolId, tools, wslArgs } from "@/shared/platform";

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
  { id: "claudeCode", title: t("Claude Code (uses your login)"), short: "Claude", kind: "cli", tool: "claude", defaultModel: "", modelHint: t("Leave empty for the Claude Code default"), note: t("Uses Claude Code logged in on this PC as is. All tools are turned off; it only generates text.") },
  { id: "codex", title: t("Codex (uses your ChatGPT login)"), short: "ChatGPT", kind: "cli", tool: "codex", defaultModel: "", modelHint: t("Leave empty for the Codex default"), note: t("Runs the Codex CLI logged in with your ChatGPT account on this PC in read-only mode and only takes the text.") },
  { id: "geminiCli", title: t("Gemini CLI (uses your Google login)"), short: "Gemini", kind: "cli", tool: "gemini", defaultModel: "", modelHint: t("Leave empty for the Gemini CLI default"), note: t("Runs the Gemini CLI logged in on this PC in read-only (plan) mode and only takes the text.") },
  { id: "anthropic", title: "Claude API (Anthropic)", short: "Claude", kind: "api", defaultModel: "claude-opus-5-5", modelHint: "claude-opus-5-5", keyHint: "sk-ant-…", keyURL: "https://console.anthropic.com/settings/keys", note: t("If a request is blocked by the safety classifier, the server retries once with the recommended model (fallbacks).") },
  { id: "openai", title: "ChatGPT API (OpenAI)", short: "ChatGPT", kind: "api", defaultModel: "gpt-5", modelHint: "gpt-5", keyHint: "sk-…", keyURL: "https://platform.openai.com/api-keys", note: t("Calls Chat Completions with an OpenAI API key.") },
  { id: "gemini", title: "Gemini API (Google)", short: "Gemini", kind: "api", defaultModel: "gemini-2.5-flash", modelHint: "gemini-2.5-flash", keyHint: "AIza…", keyURL: "https://aistudio.google.com/apikey", note: t("Calls Gemini with a Google AI Studio API key.") },
  { id: "compatible", title: t("OpenAI compatible (Ollama, LM Studio, OpenRouter, etc.)"), short: "AI", kind: "api", defaultModel: "", modelHint: "llama3.1, qwen2.5-coder …", keyHint: t("Only if needed"), note: t("Any server that accepts the OpenAI format (/chat/completions) works. Example: Ollama http://localhost:11434/v1") },
];

export const providerById = (id: AIProviderId) => aiProviders.find((p) => p.id === id)!;

/** AI 를 쓰는 기능. 기능마다 규칙(지시사항)과 쓸 AI 를 따로 정할 수 있다. */
export type AIFeature = "commit" | "explain" | "pullRequest";
export type InstructionKey = "global" | AIFeature;

export const instructionInfo: { id: InstructionKey; title: string; detail: string; chips: string[] }[] = [
  {
    id: "global",
    title: t("Common rules"),
    detail: t("Applies to every AI feature, together with the rules written for each feature below."),
    chips: [t("Write in Korean"), t("Write in English"), t("Be concise"), t("Use the imperative mood"), t("Technical tone"), t("Friendly tone")],
  },
  {
    id: "commit",
    title: t("Commit messages · Split into commits"),
    detail: t("Followed when writing commit messages or splitting changes into commits."),
    chips: [
      t("Conventional Commits format (feat: …)"),
      t("The prefix is one of Feature, Fix, Hotfix, Refactoring, Style, Chore, Remove"),
      t("Capitalize the first letter of the prefix"),
      t("Subject within 50 characters"),
      t("Include the issue number"),
      t("Subject line only, no body"),
      t("Focus on what changed and why"),
    ],
  },
  {
    id: "explain",
    title: t("Commit explanation"),
    detail: t("Followed when explaining commits and changes."),
    chips: [t("Focus on the impact on the work"), t("As bullet points"), t("Include the affected areas"), t("Easy for beginners to understand")],
  },
  {
    id: "pullRequest",
    title: t("PR/MR description"),
    detail: t("Followed when writing pull/merge request titles and descriptions."),
    chips: [t("Start with the reason for the change"), t("Include how to test"), t("As a checklist"), t("Include the related issue number"), t("Leave room for screenshots")],
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
  if (status === 401 || status === 403) return new Error(t("{0}: the API key is invalid or lacks permission ({1}). {2}", provider, status, msg));
  if (status === 404) return new Error(t("{0}: model or address not found (404). Check the model name. {1}", provider, msg));
  if (status === 429) return new Error(t("{0}: usage limit reached (429). Try again in a moment. {1}", provider, msg));
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
    if (p.kind === "cli") return p.tool && tools.available(p.tool) ? null : t("Couldn't find {0}. Locate the executable in Settings > Tools or find it in WSL.", p.title.split(" (")[0]);
    if (id === "compatible") return this.baseURL ? null : t("Enter the server address.");
    return this.hasKey[id] ? null : t("Enter your {0} key in Settings > AI.", p.title);
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
        return this.chatCompletions(this.baseURL, await this.key(id), model, system, prompt, t("AI server"));
      case "gemini":
        return this.gemini((await this.key(id))!, model, system, prompt);
    }
  }

  /** CLI 실행. 여러 줄 글({ text })은 WSL 로 실행할 때 임시 파일로 넘긴다. */
  private async cli(tool: ToolId, args: (string | { text: string })[], stdin: string, name: string) {
    const cmd = tools.command(tool);
    if (!cmd) throw new Error(t("Couldn't find {0}.", name));
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
      for (const text of temps) void ipc.remove(text);
    }
    const out = r.stdout.trim();
    if (r.status !== 0 || !out) {
      const err = r.stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      throw new Error(t("{0} request failed: ", name) + (err || out || t("No response (exit code {0}).", r.status)));
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
    if (data.stop_reason === "refusal") throw new Error(t("Claude declined this request. Try changing the content and try again."));
    const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!text) throw new Error(t("Claude: empty response"));
    return text;
  }

  private async chatCompletions(base: string, key: string | null, model: string, system: string, prompt: string, name: string) {
    if (!model) throw new Error(t("{0}: choose a model (Settings > AI).", name));
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const body = { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] };
    const r = await ipc.http("POST", base.replace(/\/+$/, "") + "/chat/completions", headers, JSON.stringify(body), 300_000);
    if (r.status !== 200) throw apiError(name, r.status, r.body);
    const data = JSON.parse(r.body) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
    const m = data.choices?.[0]?.message;
    if (m?.refusal) throw new Error(t("{0} declined this request: {1}", name, m.refusal));
    const text = (m?.content ?? "").trim();
    if (!text) throw new Error(t("{0}: empty response", name));
    return text;
  }

  private async gemini(key: string, model: string, system: string, prompt: string) {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const r = await ipc.http("POST", url, { "content-type": "application/json", "x-goog-api-key": key }, JSON.stringify(body), 300_000);
    if (r.status !== 200) throw apiError("Gemini", r.status, r.body);
    const data = JSON.parse(r.body) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    if (data.promptFeedback?.blockReason) throw new Error(t("Gemini blocked this request ({0}).", data.promptFeedback.blockReason));
    const c = data.candidates?.[0];
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error(c?.finishReason === "SAFETY" ? t("Gemini didn't respond because of its safety policy.") : t("Gemini: empty response"));
    return text;
  }

  /** 계정에서 쓸 수 있는 모델 목록(API 방식) */
  async listModels(id: AIProviderId): Promise<string[]> {
    const key = await this.key(id);
    let r;
    switch (id) {
      case "anthropic":
        if (!key) throw new Error(t("Save an API key first."));
        r = await ipc.http("GET", "https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" });
        if (r.status !== 200) throw apiError("Claude", r.status, r.body);
        return (JSON.parse(r.body).data as { id: string }[]).map((m) => m.id);
      case "openai":
      case "compatible": {
        if (id === "openai" && !key) throw new Error(t("Save an API key first."));
        const base = id === "openai" ? "https://api.openai.com/v1" : this.baseURL;
        r = await ipc.http("GET", base.replace(/\/+$/, "") + "/models", key ? { authorization: `Bearer ${key}` } : {});
        if (r.status !== 200) throw apiError(id === "openai" ? "ChatGPT" : t("AI server"), r.status, r.body);
        const ids = ((JSON.parse(r.body).data ?? []) as { id: string }[]).map((m) => m.id);
        // OpenAI 는 글 생성 모델만 추린다(임베딩·음성·이미지 제외)
        const list = id === "openai" ? ids.filter((m) => /^(gpt|o\d|chatgpt)/.test(m) && !/(audio|realtime|transcribe|tts|image|embedding|search)/.test(m)) : ids;
        return list.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      }
      case "gemini":
        if (!key) throw new Error(t("Save an API key first."));
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

/** 커밋 기록이 없을 때 AI 가 쓰는 언어(화면 언어) */
const outputLanguage = languageInEnglish();

export const Prompts = {
  commit: `You write git commit messages for the staged changes the user sends.
Reply with the commit message only: no preamble, no code fences, no quotation marks.
First line: a concise summary of at most 72 characters in the imperative mood.
If the change needs explanation, add a blank line and a short body saying what changed and why.
Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in ${outputLanguage}.`,

  explain: `You explain a git commit to a developer who is reviewing the history. Answer in ${outputLanguage}.
Start with one sentence on what the commit does. Then list the key changes as short "-" bullets, naming files and functions.
End with anything risky or worth a closer look, or say that nothing stands out.
Be concrete and brief. Plain text only, no headings.`,

  split: `You split a set of uncommitted git changes into a sequence of small, focused commits.
Group files that belong to the same logical change (one feature, one fix, one refactor, docs, config …). Every listed file must appear in exactly one commit; never invent paths.
Order the commits so each one builds on the previous (shared refactors and dependencies first).
Write each commit message as a commit message for that group: a summary line of at most 72 characters, optionally a blank line and a short body.
Match the language and style of the repository's recent commit messages shown in the input; if there are none, write in ${outputLanguage}.
Reply with JSON only, no code fences, exactly in this shape: {"commits":[{"message":"summary\\n\\noptional body","files":["path/one","path/two"]}]}`,

  pullRequest: `You write pull request descriptions from the commits and diff the user sends.
Reply in exactly this shape: the first line is the title (at most 72 characters, no "Title:" prefix), then a blank line, then the description in Markdown.
The description has a short summary paragraph, a bulleted list of the main changes, and a short note on how to test if the changes suggest one.
Use the same language as the commit messages; if unclear, write in ${outputLanguage}. Output nothing else.`,
};

/** 너무 긴 입력은 앞부분만 보내고, 잘렸으면 생략한 글자 수를 돌려준다 */
export function clip(s: string, limit = 400_000): { text: string; omitted: number } {
  if (s.length <= limit) return { text: s, omitted: 0 };
  return { text: s.slice(0, limit) + t("\n\n[... {0} more characters omitted ...]", s.length - limit), omitted: s.length - limit };
}

/** 첫 줄(요약/제목)과 나머지(본문)로 나눈다. 코드 펜스·따옴표로 감쌌으면 벗긴다. */
export function splitMessage(text: string): [string, string] {
  let text2 = text.trim();
  if (text2.startsWith("```")) {
    text2 = text2.split("\n").slice(1).join("\n");
    if (text2.endsWith("```")) text2 = text2.slice(0, -3);
    text2 = text2.trim();
  }
  const nl = text2.indexOf("\n");
  let first = (nl < 0 ? text2 : text2.slice(0, nl)).trim();
  if (first.length > 1 && first.startsWith('"') && first.endsWith('"')) first = first.slice(1, -1);
  return [first, nl < 0 ? "" : text2.slice(nl + 1).trim()];
}
