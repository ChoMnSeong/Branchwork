import { ipc } from "./ipc";
import type { Provider, PullRequest, RemoteRepo, RepoTarget } from "./models";

/** GitHub REST API / GitLab REST API v4 (맥 버전 Hosting.swift 와 같은 동작) */

export class HostingError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    let msg = body.slice(0, 400);
    try {
      const obj = JSON.parse(body);
      if (typeof obj.message === "string") {
        msg = obj.message;
        if (Array.isArray(obj.errors)) {
          const details = obj.errors.map((e: { message?: string; code?: string }) => e.message ?? e.code).filter(Boolean);
          if (details.length) msg += " — " + details.join(", ");
        }
      } else if (obj.message) msg = JSON.stringify(obj.message);
      else if (obj.error_description || obj.error) msg = obj.error_description ?? obj.error;
    } catch {
      /* 본문 그대로 */
    }
    super(HostingError.describe(status, msg));
  }

  static describe(status: number, message: string) {
    switch (status) {
      case 401:
        return "인증에 실패했습니다(401). 토큰이 만료됐거나 잘못됐습니다. 설정에서 계정을 다시 연결하세요.";
      case 403:
        return `권한이 없습니다(403): ${message}`;
      case 404:
        return "찾을 수 없습니다(404). 저장소에 접근할 권한이 있는 토큰인지 확인하세요.";
      default:
        return `서버 오류 ${status}: ${message}`;
    }
  }
}

/** https://host/a/b(.git), git@host:a/b(.git), ssh://git@host/a/b.git */
export function parseRemote(s: string): { host: string; path: string } | null {
  let host = "",
    path = "";
  if (s.includes("://")) {
    try {
      const u = new URL(s);
      host = u.hostname;
      path = decodeURIComponent(u.pathname);
    } catch {
      return null;
    }
  } else {
    const colon = s.indexOf(":");
    if (colon < 0) return null;
    const before = s.slice(0, colon);
    host = before.includes("@") ? before.slice(before.lastIndexOf("@") + 1) : before;
    path = s.slice(colon + 1);
  }
  path = path.replace(/^\/+|\/+$/g, "");
  if (path.endsWith(".git")) path = path.slice(0, -4);
  if (!host || !path.includes("/")) return null;
  return { host: host.toLowerCase(), path };
}

export function findTarget(remotes: string[], urls: Record<string, string>, gitlabHosts: string[]): RepoTarget | null {
  const order = remotes.includes("origin") ? ["origin", ...remotes.filter((r) => r !== "origin")] : remotes;
  for (const name of order) {
    const r = urls[name] ? parseRemote(urls[name]) : null;
    if (!r) continue;
    if (r.host === "github.com") return { provider: "github", remote: name, host: r.host, path: r.path };
    if (gitlabHosts.includes(r.host) || r.host.includes("gitlab")) return { provider: "gitlab", remote: name, host: r.host, path: r.path };
  }
  return null;
}

function headers(p: Provider, token: string, json: boolean): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "Branchwork" };
  if (p === "github") {
    h["Authorization"] = `Bearer ${token}`;
    h["Accept"] = "application/vnd.github+json";
    h["X-GitHub-Api-Version"] = "2022-11-28";
  } else {
    h["PRIVATE-TOKEN"] = token;
  }
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function send<T>(p: Provider, url: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const r = await ipc.http(method, url, headers(p, token, body !== undefined), body === undefined ? undefined : JSON.stringify(body));
  if (r.status < 200 || r.status >= 300) throw new HostingError(r.status, r.body);
  return JSON.parse(r.body) as T;
}

const projectID = (path: string) => encodeURIComponent(path);
const date = (s?: string | null) => (s ? Date.parse(s) / 1000 : null);

interface GHUser { login: string; name?: string | null; avatar_url?: string | null }
interface GHRef { ref: string; sha: string; repo?: { full_name: string } | null }
interface GHPull { number: number; title: string; html_url: string; draft?: boolean; updated_at?: string; body?: string | null; user: GHUser; head: GHRef; base: GHRef }
interface GHRepo { full_name: string; clone_url: string; private: boolean; description?: string | null; default_branch?: string }
interface GLUser { username: string; name?: string | null; avatar_url?: string | null }
interface GLMergeRequest {
  iid: number; title: string; web_url: string; draft?: boolean; work_in_progress?: boolean; updated_at?: string;
  description?: string | null; author: GLUser; source_branch: string; target_branch: string; sha?: string | null;
  source_project_id?: number; target_project_id?: number;
}
interface GLProject { path_with_namespace: string; http_url_to_repo: string; visibility?: string; description?: string | null; default_branch?: string }

const fromPull = (p: GHPull, repoPath: string): PullRequest => ({
  number: p.number,
  title: p.title,
  author: p.user.login,
  source: p.head.ref,
  target: p.base.ref,
  url: p.html_url,
  isDraft: !!p.draft,
  updated: date(p.updated_at),
  body: p.body ?? "",
  headSHA: p.head.sha,
  fromFork: p.head.repo ? p.head.repo.full_name.toLowerCase() !== repoPath.toLowerCase() : true,
});

const fromMerge = (m: GLMergeRequest): PullRequest => ({
  number: m.iid,
  title: m.title,
  author: m.author.username,
  source: m.source_branch,
  target: m.target_branch,
  url: m.web_url,
  isDraft: m.draft ?? m.work_in_progress ?? false,
  updated: date(m.updated_at),
  body: m.description ?? "",
  headSHA: m.sha ?? null,
  fromFork: m.source_project_id != null && m.source_project_id !== m.target_project_id,
});

export interface Me {
  username: string;
  name: string | null;
  avatarURL: string | null;
}

export async function me(p: Provider, token: string, apiBase: string): Promise<Me> {
  if (p === "github") {
    const u = await send<GHUser>(p, apiBase + "/user", token);
    return { username: u.login, name: u.name ?? null, avatarURL: u.avatar_url ?? null };
  }
  const u = await send<GLUser>(p, apiBase + "/user", token);
  return { username: u.username, name: u.name ?? null, avatarURL: u.avatar_url ?? null };
}

export async function pullRequests(t: RepoTarget, token: string, apiBase: string): Promise<PullRequest[]> {
  if (t.provider === "github") {
    const list = await send<GHPull[]>("github", `${apiBase}/repos/${t.path}/pulls?state=open&per_page=50&sort=updated&direction=desc`, token);
    return list.map((p) => fromPull(p, t.path));
  }
  const list = await send<GLMergeRequest[]>("gitlab", `${apiBase}/projects/${projectID(t.path)}/merge_requests?state=opened&per_page=50&order_by=updated_at`, token);
  return list.map(fromMerge);
}

export async function defaultBranch(t: RepoTarget, token: string, apiBase: string): Promise<string | null> {
  if (t.provider === "github") return (await send<GHRepo>("github", `${apiBase}/repos/${t.path}`, token)).default_branch ?? null;
  return (await send<GLProject>("gitlab", `${apiBase}/projects/${projectID(t.path)}`, token)).default_branch ?? null;
}

export async function createPullRequest(
  t: RepoTarget,
  token: string,
  apiBase: string,
  a: { title: string; body: string; source: string; target: string; draft: boolean },
): Promise<PullRequest> {
  if (t.provider === "github") {
    const p = await send<GHPull>("github", `${apiBase}/repos/${t.path}/pulls`, token, "POST", {
      title: a.title, body: a.body, head: a.source, base: a.target, draft: a.draft,
    });
    return fromPull(p, t.path);
  }
  const m = await send<GLMergeRequest>("gitlab", `${apiBase}/projects/${projectID(t.path)}/merge_requests`, token, "POST", {
    title: a.draft ? "Draft: " + a.title : a.title,
    description: a.body,
    source_branch: a.source,
    target_branch: a.target,
  });
  return fromMerge(m);
}

/** 계정이 접근할 수 있는 저장소(최근 활동 순) */
export async function repositories(p: Provider, token: string, apiBase: string): Promise<RemoteRepo[]> {
  if (p === "github") {
    const list = await send<GHRepo[]>(p, `${apiBase}/user/repos?per_page=100&sort=updated`, token);
    return list.map((r) => ({ fullName: r.full_name, cloneURL: r.clone_url, isPrivate: r.private, summary: r.description ?? null }));
  }
  const list = await send<GLProject[]>(p, `${apiBase}/projects?membership=true&simple=true&order_by=last_activity_at&per_page=100`, token);
  return list.map((r) => ({ fullName: r.path_with_namespace, cloneURL: r.http_url_to_repo, isPrivate: r.visibility !== "public", summary: r.description ?? null }));
}
