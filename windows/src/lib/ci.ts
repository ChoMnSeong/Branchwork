import { accounts } from "./accounts";
import { joinPath } from "./env";
import { describe } from "./git";
import * as Hosting from "./hosting";
import { ipc } from "./ipc";
import { branchRemote, branchShort, type Provider, type RepoTarget } from "./models";
import { Observable } from "./observable";
import type { RepoStore } from "./repo";
import { settings } from "./settings";

/** CI/CD: GitLab 파이프라인 · GitHub Actions (맥 버전 CI.swift · RepoStore+CI.swift 와 같은 동작) */

// MARK: - 모델

export type CIStatus = "created" | "waiting" | "pending" | "running" | "success" | "failed" | "canceled" | "skipped" | "manual" | "scheduled" | "neutral" | "unknown";

export function gitlabStatus(s: string): CIStatus {
  switch (s) {
    case "created":
      return "created";
    case "waiting_for_resource":
    case "preparing":
    case "waiting_for_callback":
      return "waiting";
    case "pending":
    case "running":
    case "success":
    case "failed":
    case "skipped":
    case "manual":
    case "scheduled":
      return s;
    case "canceled":
    case "canceling":
      return "canceled";
    default:
      return "unknown";
  }
}

export function githubStatus(status?: string | null, conclusion?: string | null): CIStatus {
  switch (status) {
    case "queued":
    case "requested":
    case "pending":
      return "pending";
    case "waiting":
      return "waiting"; // 환경 보호 규칙의 승인 대기
    case "in_progress":
      return "running";
    case "completed":
      switch (conclusion) {
        case "success":
          return "success";
        case "failure":
        case "timed_out":
        case "startup_failure":
          return "failed";
        case "cancelled":
          return "canceled";
        case "skipped":
          return "skipped";
        case "action_required":
          return "manual";
        case "neutral":
        case "stale":
          return "neutral";
        default:
          return "unknown";
      }
    default:
      return "unknown";
  }
}

export const statusInfo: Record<CIStatus, { title: string; color: string }> = {
  created: { title: "생성됨", color: "var(--text-2)" },
  waiting: { title: "대기 중", color: "#e8912d" },
  pending: { title: "대기열", color: "var(--text-2)" },
  running: { title: "실행 중", color: "#2f7ff0" },
  success: { title: "성공", color: "#2ea44f" },
  failed: { title: "실패", color: "#e5484d" },
  canceled: { title: "취소됨", color: "var(--text-2)" },
  skipped: { title: "건너뜀", color: "var(--text-2)" },
  manual: { title: "수동 실행 대기", color: "#e8912d" },
  scheduled: { title: "예약됨", color: "#8e5bd8" },
  neutral: { title: "완료", color: "var(--text-2)" },
  unknown: { title: "알 수 없음", color: "var(--text-2)" },
};

/** 아직 끝나지 않아 자주 새로 고쳐야 하는 상태 */
export const isActiveCI = (s: CIStatus) => s === "created" || s === "waiting" || s === "pending" || s === "running";
export const isFinishedCI = (s: CIStatus) => s === "success" || s === "failed" || s === "canceled" || s === "skipped" || s === "neutral";

export interface CIPipeline {
  id: number;
  /** GitLab iid / GitHub run_number */
  number: number;
  /** GitHub 워크플로 이름, GitLab 파이프라인 이름(있으면) */
  name: string;
  /** GitHub: 커밋 메시지·PR 제목. GitLab 은 없어서 화면에서 로컬 커밋 제목으로 채운다 */
  title: string;
  ref: string;
  sha: string;
  status: CIStatus;
  url: string;
  created: number | null;
  event: string;
  actor: string | null;
}

export interface CIJob {
  id: number;
  name: string;
  /** GitLab 단계(GitHub 은 빈 문자열) */
  stage: string;
  status: CIStatus;
  url: string;
  allowFailure: boolean;
  duration: number | null;
}

/** GitLab 수동 작업(when: manual)·지연 작업(when: delayed)은 바로 실행할 수 있다 */
export const canPlay = (j: CIJob) => j.status === "manual" || j.status === "scheduled";

export interface CIDeployment {
  environmentID: number;
  environment: string;
  canApprove: boolean;
}

/** "Run workflow" 버튼이 있는(workflow_dispatch) GitHub 워크플로 */
export interface CIWorkflow {
  id: number;
  name: string;
  path: string;
  inputs: CIInput[];
}

/** workflow_dispatch 입력값 / GitLab 파이프라인 변수(.gitlab-ci.yml 에 설명이 있는 변수) */
export interface CIInput {
  name: string;
  description: string;
  required: boolean;
  defaultValue: string;
  /** string, boolean, choice, number, environment */
  type: string;
  options: string[];
}

// MARK: - 작은 YAML 읽기

/** 워크플로 입력값·파이프라인 변수를 읽을 만큼만 하는 YAML(블록 맵·목록·[a, b]·따옴표·| > 여러 줄 글) */
export type YNode = { kind: "scalar"; value: string } | { kind: "map"; pairs: [string, YNode][] } | { kind: "list"; items: YNode[] };

interface YLine {
  indent: number;
  text: string;
  raw: string;
  blank: boolean;
}

const scalar = (value: string): YNode => ({ kind: "scalar", value });
export const yget = (n: YNode | undefined, key: string): YNode | undefined => (n?.kind === "map" ? n.pairs.find(([k]) => k === key)?.[1] : undefined);
export const ystr = (n: YNode | undefined): string | undefined => (n?.kind === "scalar" ? n.value : undefined);
const ypairs = (n: YNode | undefined): [string, YNode][] => (n?.kind === "map" ? n.pairs : []);
const yitems = (n: YNode | undefined): YNode[] => (n?.kind === "list" ? n.items : []);

function stripComment(s: string): string {
  let quote: string | null = null;
  let prev = " ";
  for (let n = 0; n < s.length; n++) {
    const c = s[n];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "#" && (prev === " " || prev === "\t" || n === 0)) return s.slice(0, n);
    prev = c;
  }
  return s;
}

const isItem = (t: string) => t === "-" || t.startsWith("- ");

/** "key: value" → [key, value]. 값이 없으면 value 는 빈 문자열. */
function splitKey(t: string): [string, string] | null {
  let quote: string | null = null;
  for (let n = 0; n < t.length; n++) {
    const c = t[n];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if ((c === "'" || c === '"') && n === 0) {
      quote = c;
      continue;
    }
    if (c === ":" && (n === t.length - 1 || t[n + 1] === " ")) {
      return [unquote(t.slice(0, n).trim()), n === t.length - 1 ? "" : t.slice(n + 1).trim()];
    }
  }
  return null;
}

export function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return s;
}

function splitFlow(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === ",") {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

function scalarNode(v: string): YNode {
  if (v.startsWith("[") && v.endsWith("]")) return { kind: "list", items: splitFlow(v.slice(1, -1)).map((x) => scalar(unquote(x))) };
  if (v.startsWith("{") && v.endsWith("}")) {
    return {
      kind: "map",
      pairs: splitFlow(v.slice(1, -1)).map((part): [string, YNode] => {
        const kv = splitKey(part);
        return kv ? [kv[0], scalar(unquote(kv[1]))] : [unquote(part), scalar("")];
      }),
    };
  }
  return scalar(unquote(v));
}

export function parseYAML(text: string): YNode {
  const lines: YLine[] = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((r) => {
      const raw = r.replace(/\t/g, "  ");
      const trimmed = stripComment(raw).trim();
      const indent = raw.length - raw.replace(/^ +/, "").length;
      return { indent, text: trimmed, raw, blank: !trimmed || trimmed === "---" };
    });
  const pos = { i: 0 };
  const skipBlank = () => {
    while (pos.i < lines.length && lines[pos.i].blank) pos.i++;
  };

  const block = (indent: number): YNode => (isItem(lines[pos.i].text) ? list(indent) : map(indent));

  const map = (indent: number): YNode => {
    const pairs: [string, YNode][] = [];
    while (pos.i < lines.length) {
      const l = lines[pos.i];
      if (l.blank) {
        pos.i++;
        continue;
      }
      if (l.indent < indent || (l.indent === indent && isItem(l.text))) break;
      if (l.indent > indent) {
        pos.i++; // 예상 밖의 들여쓰기는 건너뜀
        continue;
      }
      const kv = splitKey(l.text);
      pos.i++;
      if (!kv) continue;
      pairs.push([kv[0], valueNode(kv[1], indent)]);
    }
    return { kind: "map", pairs };
  };

  const list = (indent: number): YNode => {
    const items: YNode[] = [];
    while (pos.i < lines.length) {
      const l = lines[pos.i];
      if (l.blank) {
        pos.i++;
        continue;
      }
      if (l.indent !== indent || !isItem(l.text)) {
        if (l.indent > indent) {
          pos.i++;
          continue;
        }
        break;
      }
      const rest = l.text.slice(1).trim();
      if (!rest) {
        pos.i++;
        skipBlank();
        if (pos.i < lines.length && lines[pos.i].indent > indent) items.push(block(lines[pos.i].indent));
        else items.push(scalar(""));
      } else if (splitKey(rest) && !rest.startsWith("[") && !rest.startsWith("{")) {
        // "- key: value" 로 시작하는 맵: 그 줄을 맵의 첫 줄로 다시 읽는다
        const inner = indent + (l.text.length - rest.length);
        lines[pos.i] = { indent: inner, text: rest, raw: l.raw, blank: false };
        items.push(map(inner));
      } else {
        pos.i++;
        items.push(scalarNode(rest));
      }
    }
    return { kind: "list", items };
  };

  const valueNode = (value: string, indent: number): YNode => {
    if (!value) {
      let j = pos.i;
      while (j < lines.length && lines[j].blank) j++;
      if (j >= lines.length) {
        pos.i = j;
        return scalar("");
      }
      const next = lines[j];
      if (next.indent > indent || (next.indent === indent && isItem(next.text))) {
        pos.i = j;
        return block(next.indent);
      }
      return scalar("");
    }
    if (value[0] === "|" || value[0] === ">") {
      // 여러 줄 글: 더 깊이 들여쓴 줄을 모두
      const raws: string[] = [];
      let min = Infinity;
      while (pos.i < lines.length && (lines[pos.i].blank || lines[pos.i].indent > indent)) {
        const l = lines[pos.i];
        if (l.raw.trim()) min = Math.min(min, l.indent);
        raws.push(l.raw);
        pos.i++;
      }
      const cut = min === Infinity ? 0 : min;
      const body = raws.map((r) => r.slice(cut));
      return scalar((value[0] === "|" ? body.join("\n") : body.join(" ")).trim());
    }
    return scalarNode(value);
  };

  skipBlank();
  if (pos.i >= lines.length) return { kind: "map", pairs: [] };
  return block(lines[pos.i].indent);
}

/** GitHub 워크플로 파일: workflow_dispatch 가 있으면 그 입력값(없으면 null) */
export function dispatchInputs(text: string): CIInput[] | null {
  const root = parseYAML(text);
  const on = yget(root, "on") ?? yget(root, "true");
  if (!on) return null;
  if (on.kind === "scalar") return on.value === "workflow_dispatch" ? [] : null;
  if (on.kind === "list") return on.items.some((x) => ystr(x) === "workflow_dispatch") ? [] : null;
  const wd = yget(on, "workflow_dispatch");
  if (!wd) return null;
  return ypairs(yget(wd, "inputs")).map(([name, spec]) => ({
    name,
    description: ystr(yget(spec, "description")) ?? "",
    required: ystr(yget(spec, "required")) === "true",
    defaultValue: ystr(yget(spec, "default")) ?? "",
    type: ystr(yget(spec, "type")) ?? "string",
    options: yitems(yget(spec, "options"))
      .map(ystr)
      .filter((x): x is string => x !== undefined),
  }));
}

/** .gitlab-ci.yml: 설명이 있는 전역 변수(GitLab 의 "파이프라인 실행" 화면에 미리 채워지는 것) */
export function pipelineVariables(text: string): CIInput[] {
  return ypairs(yget(parseYAML(text), "variables")).flatMap(([name, spec]): CIInput[] => {
    const desc = ystr(yget(spec, "description"));
    if (spec.kind !== "map" || desc === undefined) return [];
    const options = yitems(yget(spec, "options"))
      .map(ystr)
      .filter((x): x is string => x !== undefined);
    return [{ name, description: desc, required: false, defaultValue: ystr(yget(spec, "value")) ?? "", type: options.length ? "choice" : "string", options }];
  });
}

// MARK: - API

interface GLPipeline { id: number; iid?: number; sha: string; ref: string; status: string; source?: string; created_at?: string; web_url: string; name?: string | null; user?: { username: string } | null }
interface GLJob { id: number; name: string; stage: string; status: string; web_url: string; allow_failure?: boolean; duration?: number | null }
interface GHRun {
  id: number; name?: string | null; display_title?: string | null; run_number: number; head_branch?: string | null; head_sha: string;
  status?: string | null; conclusion?: string | null; html_url: string; created_at?: string; event: string; actor?: { login: string } | null;
}
interface GHJob { id: number; name: string; status?: string | null; conclusion?: string | null; html_url?: string | null; started_at?: string | null; completed_at?: string | null }
interface GHWorkflow { id: number; name: string; path: string; state: string }
interface GHPending { environment: { id: number; name?: string | null }; current_user_can_approve?: boolean }

export interface CIAccess {
  target: RepoTarget;
  token: string;
  apiBase: string;
}

const project = (c: CIAccess) => `${c.apiBase}/projects/${Hosting.projectID(c.target.path)}`;
const repoBase = (c: CIAccess) => `${c.apiBase}/repos/${c.target.path}`;
const q = encodeURIComponent;

/** base64(줄바꿈 포함) → UTF-8 글 */
function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const CIAPI = {
  /** 최근 파이프라인·실행(ref 가 있으면 그 브랜치만) */
  async pipelines(c: CIAccess, ref: string | null): Promise<CIPipeline[]> {
    if (c.target.provider === "gitlab") {
      const list = await Hosting.send<GLPipeline[]>("gitlab", `${project(c)}/pipelines?per_page=30${ref ? `&ref=${q(ref)}` : ""}`, c.token);
      return list.map((p) => ({
        id: p.id,
        number: p.iid ?? p.id,
        name: p.name ?? "",
        title: "",
        ref: p.ref,
        sha: p.sha,
        status: gitlabStatus(p.status),
        url: p.web_url,
        created: Hosting.date(p.created_at),
        event: p.source ?? "",
        actor: p.user?.username ?? null,
      }));
    }
    const r = await Hosting.send<{ workflow_runs: GHRun[] }>("github", `${repoBase(c)}/actions/runs?per_page=30${ref ? `&branch=${q(ref)}` : ""}`, c.token);
    return r.workflow_runs.map((p) => ({
      id: p.id,
      number: p.run_number,
      name: p.name ?? "",
      title: p.display_title ?? "",
      ref: p.head_branch ?? "",
      sha: p.head_sha,
      status: githubStatus(p.status, p.conclusion),
      url: p.html_url,
      created: Hosting.date(p.created_at),
      event: p.event,
      actor: p.actor?.login ?? null,
    }));
  },

  async jobs(c: CIAccess, pipeline: number): Promise<CIJob[]> {
    if (c.target.provider === "gitlab") {
      const list = await Hosting.send<GLJob[]>("gitlab", `${project(c)}/pipelines/${pipeline}/jobs?per_page=100`, c.token);
      // 단계 순서 = 먼저 만들어진 작업 순서
      return list
        .sort((a, b) => a.id - b.id)
        .map((j) => ({ id: j.id, name: j.name, stage: j.stage, status: gitlabStatus(j.status), url: j.web_url, allowFailure: !!j.allow_failure, duration: j.duration ?? null }));
    }
    const r = await Hosting.send<{ jobs: GHJob[] }>("github", `${repoBase(c)}/actions/runs/${pipeline}/jobs?per_page=100&filter=latest`, c.token);
    return r.jobs.map((j) => {
      const s = Hosting.date(j.started_at);
      const e = Hosting.date(j.completed_at);
      return { id: j.id, name: j.name, stage: "", status: githubStatus(j.status, j.conclusion), url: j.html_url ?? "", allowFailure: false, duration: s != null && e != null ? e - s : null };
    });
  },

  play: (c: CIAccess, job: number) => Hosting.sendRaw("gitlab", `${project(c)}/jobs/${job}/play`, c.token, "POST"),

  retryJob: (c: CIAccess, job: number) =>
    c.target.provider === "gitlab"
      ? Hosting.sendRaw("gitlab", `${project(c)}/jobs/${job}/retry`, c.token, "POST")
      : Hosting.sendRaw("github", `${repoBase(c)}/actions/jobs/${job}/rerun`, c.token, "POST"),

  cancelJob: (c: CIAccess, job: number) => Hosting.sendRaw("gitlab", `${project(c)}/jobs/${job}/cancel`, c.token, "POST"),

  /** GitLab 은 실패·취소된 작업만 다시 실행한다 */
  retryPipeline: (c: CIAccess, id: number, failedOnly: boolean) =>
    c.target.provider === "gitlab"
      ? Hosting.sendRaw("gitlab", `${project(c)}/pipelines/${id}/retry`, c.token, "POST")
      : Hosting.sendRaw("github", `${repoBase(c)}/actions/runs/${id}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`, c.token, "POST"),

  cancelPipeline: (c: CIAccess, id: number) =>
    c.target.provider === "gitlab"
      ? Hosting.sendRaw("gitlab", `${project(c)}/pipelines/${id}/cancel`, c.token, "POST")
      : Hosting.sendRaw("github", `${repoBase(c)}/actions/runs/${id}/cancel`, c.token, "POST"),

  /** GitLab: 브랜치·변수로 새 파이프라인 */
  runPipeline: (c: CIAccess, ref: string, variables: [string, string][]) =>
    Hosting.sendRaw("gitlab", `${project(c)}/pipeline`, c.token, "POST", {
      ref,
      variables: variables.map(([key, value]) => ({ key, value, variable_type: "env_var" })),
    }),

  /** GitHub: workflow_dispatch 가 있는 워크플로(입력값 포함). 파일은 ref 의 것을 읽는다. */
  async workflows(c: CIAccess, ref: string): Promise<CIWorkflow[]> {
    const r = await Hosting.send<{ workflows: GHWorkflow[] }>("github", `${repoBase(c)}/actions/workflows?per_page=100`, c.token);
    const list = r.workflows.filter((w) => w.state === "active" && w.path.startsWith(".github/workflows/"));
    const out = await Promise.all(
      list.map(async (w): Promise<CIWorkflow | null> => {
        try {
          const file = await Hosting.send<{ content?: string }>("github", `${repoBase(c)}/contents/${w.path}?ref=${q(ref)}`, c.token);
          const inputs = file.content ? dispatchInputs(decodeBase64(file.content)) : null;
          return inputs ? { id: w.id, name: w.name, path: w.path, inputs } : null;
        } catch {
          return null;
        }
      }),
    );
    return out.filter((w): w is CIWorkflow => !!w);
  },

  dispatch: (c: CIAccess, workflow: number, ref: string, inputs: Record<string, string>) =>
    Hosting.sendRaw("github", `${repoBase(c)}/actions/workflows/${workflow}/dispatches`, c.token, "POST", { ref, inputs }),

  async pendingDeployments(c: CIAccess, run: number): Promise<CIDeployment[]> {
    const list = await Hosting.send<GHPending[]>("github", `${repoBase(c)}/actions/runs/${run}/pending_deployments`, c.token);
    return list.map((p) => ({ environmentID: p.environment.id, environment: p.environment.name ?? `환경 ${p.environment.id}`, canApprove: !!p.current_user_can_approve }));
  },

  review: (c: CIAccess, run: number, environments: number[], approve: boolean) =>
    Hosting.sendRaw("github", `${repoBase(c)}/actions/runs/${run}/pending_deployments`, c.token, "POST", {
      environment_ids: environments,
      state: approve ? "approved" : "rejected",
      comment: "Branchwork",
    }),
};

// MARK: - 상태

/** 저장소 탭마다 하나: 파이프라인 목록·작업·버튼 동작 */
export class CIStore extends Observable {
  pipelines: CIPipeline[] = [];
  state: { kind: "idle" } | { kind: "loading" } | { kind: "loaded" } | { kind: "needsAccount" } | { kind: "failed"; message: string } = { kind: "idle" };
  jobs = new Map<number, CIJob[]>();
  deployments = new Map<number, CIDeployment[]>();
  /** 진행 중인 버튼 동작(같은 버튼을 두 번 누르지 않게) */
  busy = new Set<string>();

  constructor(private repo: RepoStore) {
    super();
  }

  get currentBranchOnly() {
    return settings.get("ciCurrentBranchOnly", false);
  }

  setCurrentBranchOnly(v: boolean) {
    settings.set("ciCurrentBranchOnly", v);
    this.emit();
  }

  reset() {
    this.pipelines = [];
    this.jobs = new Map();
    this.deployments = new Map();
    this.state = { kind: "idle" };
    this.emit();
  }

  /** PR·MR 과 같은 계정을 쓴다 */
  async access(): Promise<CIAccess | null> {
    const t = this.repo.target;
    const a = this.repo.hostingAccount;
    if (!t || !a) return null;
    const token = await accounts.token(a);
    if (!token) return null;
    return { target: t, token, apiBase: a.provider === "github" ? "https://api.github.com" : a.server + "/api/v4" };
  }

  get hasAccess() {
    return !!this.repo.target && !!this.repo.hostingAccount;
  }

  /** 서버에서의 현재 브랜치 이름(추적 브랜치가 있으면 그 이름) */
  get currentRef(): string | null {
    const b = this.repo.currentBranch;
    if (!b) return null;
    if (b.upstream && b.upstream.includes("/")) return b.upstream.slice(b.upstream.indexOf("/") + 1);
    return b.name;
  }

  /** 실행할 수 있는 브랜치: 이 저장소 원격의 브랜치(현재 브랜치가 맨 앞) */
  get branches(): string[] {
    const t = this.repo.target;
    if (!t) return [];
    const names = this.repo.remoteBranches.filter((b) => branchRemote(b) === t.remote && !branchShort(b).endsWith("HEAD")).map(branchShort);
    const cur = this.currentRef;
    const i = cur ? names.indexOf(cur) : -1;
    if (i > 0) names.unshift(...names.splice(i, 1));
    return names;
  }

  /** 커밋 제목(GitLab 파이프라인에는 없어서 그래프의 커밋에서) */
  subject(sha: string): string | null {
    const i = this.repo.commitIndex.get(sha);
    return i === undefined ? null : this.repo.entries[i].commit.subject;
  }

  private same(t: RepoTarget) {
    const cur = this.repo.target;
    return !!cur && cur.host === t.host && cur.path === t.path && cur.provider === t.provider;
  }

  async load(silent = false) {
    const t = this.repo.target;
    if (!t) return this.reset();
    if (!this.repo.hostingAccount && accounts.accountsFor(t.provider).length) await accounts.discoverAlias(t, true);
    const c = await this.access();
    if (!c) {
      if (t.provider === "gitlab") accounts.suggestedGitLabServer = `https://${t.host}`;
      this.pipelines = [];
      this.state = { kind: "needsAccount" };
      this.emit();
      return;
    }
    if (!silent || this.state.kind !== "loaded") {
      this.state = { kind: "loading" };
      this.emit();
    }
    try {
      const list = await CIAPI.pipelines(c, this.currentBranchOnly ? this.currentRef : null);
      if (!this.same(t)) return;
      const before = new Map(this.pipelines.map((p) => [p.id, p.status]));
      this.pipelines = list;
      this.state = { kind: "loaded" };
      const ids = new Set(list.map((p) => p.id));
      for (const k of [...this.jobs.keys()]) if (!ids.has(k)) this.jobs.delete(k);
      for (const k of [...this.deployments.keys()]) if (!ids.has(k)) this.deployments.delete(k);
      this.emit();
      // 최근 파이프라인은 작업까지 읽어 둔다(수동 실행 대기 ▶ 표시·승인 대기)
      const recent = t.provider === "gitlab" ? list.slice(0, 5) : list.filter((p) => p.status === "waiting");
      for (const p of recent) {
        if (!this.jobs.has(p.id) || before.get(p.id) !== p.status || isActiveCI(p.status)) await this.loadJobs(p, true);
      }
    } catch (e) {
      if (!this.same(t)) return;
      // 자동 새로 고침이 한 번 실패한 것으로 목록을 지우지 않는다
      if (!silent || !this.pipelines.length) this.state = { kind: "failed", message: describe(e) };
      this.emit();
    }
  }

  async loadJobs(p: CIPipeline, silent = false) {
    const c = await this.access();
    if (!c) return;
    try {
      const jobs = await CIAPI.jobs(c, p.id);
      if (!this.same(c.target)) return;
      this.jobs.set(p.id, jobs);
      const current = this.pipelines.find((x) => x.id === p.id) ?? p;
      if (c.target.provider === "github" && current.status === "waiting") {
        this.deployments.set(p.id, await CIAPI.pendingDeployments(c, p.id).catch(() => []));
      } else this.deployments.delete(p.id);
    } catch (e) {
      if (!this.jobs.has(p.id)) this.jobs.set(p.id, []);
      if (!silent) this.repo.showError(ciError(e, c.target.provider));
    }
    this.emit();
  }

  // MARK: 버튼

  playJob(job: CIJob, p: CIPipeline) {
    this.repo.ask({
      title: `'${job.name}' 작업을 실행할까요?`,
      message: `${p.ref} · 파이프라인 #${p.number}` + (job.stage ? ` · ${job.stage} 단계` : ""),
      actionTitle: "실행",
      destructive: false,
      action: () => this.act(`job:${job.id}`, p, (c) => CIAPI.play(c, job.id)),
    });
  }

  retryJob(job: CIJob, p: CIPipeline) {
    return this.act(`job:${job.id}`, p, (c) => CIAPI.retryJob(c, job.id));
  }

  cancelJob(job: CIJob, p: CIPipeline) {
    return this.act(`job:${job.id}`, p, (c) => CIAPI.cancelJob(c, job.id));
  }

  retryPipeline(p: CIPipeline, failedOnly: boolean) {
    return this.act(`pipeline:${p.id}`, p, (c) => CIAPI.retryPipeline(c, p.id, failedOnly));
  }

  cancelPipeline(p: CIPipeline) {
    this.repo.ask({
      title: `파이프라인 #${p.number}을(를) 취소할까요?`,
      message: `${p.ref} 에서 실행 중인 작업이 멈춥니다.`,
      actionTitle: "실행 취소",
      action: () => this.act(`pipeline:${p.id}`, p, (c) => CIAPI.cancelPipeline(c, p.id)),
    });
  }

  /** GitHub 환경 보호 규칙의 배포 승인·거부 */
  reviewDeployment(p: CIPipeline, deps: CIDeployment[], approve: boolean) {
    const names = deps.map((d) => d.environment).join(", ");
    this.repo.ask({
      title: approve ? `'${names}' 배포를 승인할까요?` : `'${names}' 배포를 거부할까요?`,
      message: `${p.name} #${p.number} · ${p.ref}`,
      actionTitle: approve ? "승인" : "거부",
      destructive: !approve,
      action: () =>
        this.act(`pipeline:${p.id}`, p, (c) =>
          CIAPI.review(
            c,
            p.id,
            deps.map((d) => d.environmentID),
            approve,
          ),
        ),
    });
  }

  /** GitLab: 새 파이프라인 */
  runPipeline(ref: string, variables: [string, string][]) {
    return this.act("run", null, (c) => CIAPI.runPipeline(c, ref, variables));
  }

  /** GitHub: workflow_dispatch 실행(실행 목록에 나타나기까지 몇 초 걸려 한 번 더 읽는다) */
  async runWorkflow(w: CIWorkflow, ref: string, inputs: Record<string, string>) {
    await this.act("run", null, (c) => CIAPI.dispatch(c, w.id, ref, inputs));
    await new Promise((r) => setTimeout(r, 4000));
    await this.load(true);
  }

  async workflows(ref: string): Promise<CIWorkflow[]> {
    const c = await this.access();
    return c ? CIAPI.workflows(c, ref) : [];
  }

  /** .gitlab-ci.yml 에서 설명이 붙은 변수(파이프라인 실행 화면에 미리 채움) */
  async gitlabVariables(): Promise<CIInput[]> {
    if (!this.repo.path) return [];
    const text = await ipc.readText(joinPath(this.repo.path, ".gitlab-ci.yml")).catch(() => null);
    return text ? pipelineVariables(text) : [];
  }

  private async act(key: string, p: CIPipeline | null, work: (c: CIAccess) => Promise<unknown>) {
    const c = await this.access();
    if (!c || this.busy.has(key)) return;
    this.busy.add(key);
    this.emit();
    try {
      await work(c);
    } catch (e) {
      this.repo.showError(ciError(e, c.target.provider));
      return;
    } finally {
      this.busy.delete(key);
      this.emit();
    }
    await new Promise((r) => setTimeout(r, 700));
    await this.load(true);
    if (p) await this.loadJobs(p, true);
  }
}

export function ciError(e: unknown, provider: Provider): string {
  const base = describe(e);
  if (!(e instanceof Hosting.HostingError) || (e.status !== 403 && e.status !== 404)) return base;
  return provider === "gitlab"
    ? base + "\n\n실행하려면 토큰에 api 권한이 있어야 하고(read_api 만으로는 안 됨), 프로젝트에서 Developer 이상이어야 합니다. 보호된 브랜치·환경이면 그 권한도 필요합니다."
    : base + "\n\n실행하려면 토큰에 Actions 쓰기 권한이 있어야 합니다(클래식 토큰은 repo, 세분화 토큰은 Actions: Read and write). 설정에서 계정을 다시 연결해 보세요.";
}

export const eventTitle = (e: string) =>
  ({
    push: "push",
    web: "수동",
    workflow_dispatch: "수동",
    schedule: "예약",
    merge_request_event: "MR·PR",
    pull_request: "MR·PR",
    pull_request_target: "MR·PR",
    api: "API",
    trigger: "트리거",
    repository_dispatch: "트리거",
    parent_pipeline: "연결",
    pipeline: "연결",
    workflow_run: "연결",
  })[e] ?? e;
