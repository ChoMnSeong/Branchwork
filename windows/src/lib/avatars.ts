import { accounts } from "./accounts";
import { ipc } from "./ipc";
import { Observable } from "./observable";
import { settings } from "./settings";

/**
 * 커밋 작성자 프로필 사진 주소. 이메일로 찾는다(맥 버전 AvatarStore.swift 와 같은 순서):
 * ① GitHub noreply 주소면 GitHub 프로필 ② 연결한 사내 GitLab 의 프로필 ③ 열린 GitHub 저장소에서 그 이메일로 한 커밋의 계정
 * ④ Gravatar(없으면 404 → 이니셜). 이번 실행 동안만 기억한다(사진 자체는 웹뷰가 캐시).
 */
class AvatarStore extends Observable {
  private urls = new Map<string, string | null>();
  private pending = new Set<string>();
  private queue: string[] = [];
  private running = 0;
  /** 작성자 이름(이메일로 못 찾을 때 GitLab 사용자 이름으로 찾는 데 씀) */
  private names = new Map<string, string>();
  /** 열린 GitHub 저장소들(owner/repo) */
  private githubRepos: string[] = [];
  /** 이미지가 안 열린 주소(404 등) */
  failed = new Set<string>();

  get enabled() {
    return settings.get("avatarFetch", true);
  }

  setEnabled(v: boolean) {
    settings.set("avatarFetch", v);
    this.emit();
  }

  noteGitHubRepo(path: string) {
    if (this.githubRepos.includes(path)) return;
    this.githubRepos.unshift(path);
    if (this.githubRepos.length > 3) this.githubRepos.pop();
  }

  /** 주소가 정해졌으면 주소(없으면 null), 아직이면 undefined 를 돌려주고 뒤에서 찾는다 */
  url(rawEmail: string, name = ""): string | null | undefined {
    if (!this.enabled) return null;
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes("@")) return null;
    if (this.urls.has(email)) return this.urls.get(email);
    if (!this.pending.has(email)) {
      if (name.trim()) this.names.set(email, name.trim());
      this.pending.add(email);
      this.queue.push(email);
      this.pump();
    }
    return undefined;
  }

  markFailed(url: string) {
    if (this.failed.has(url)) return;
    this.failed.add(url);
    this.emit();
  }

  private pump() {
    while (this.running < 4 && this.queue.length) {
      const email = this.queue.shift()!;
      this.running++;
      void resolve(email, this.names.get(email) ?? "", [...this.githubRepos])
        .catch(() => null)
        .then((u) => {
          this.urls.set(email, u);
          this.pending.delete(email);
          this.running--;
          this.emit();
          this.pump();
        });
    }
  }
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function json(url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const r = await ipc.http("GET", url, headers, undefined, 10000);
    return r.status === 200 ? JSON.parse(r.body) : null;
  } catch {
    return null;
  }
}

/** GitLab 사용자 목록에서 사진 주소(올린 사진만 — Gravatar 로 돌려주면 null). 같은 이름이 여럿이면 누군지 몰라 쓰지 않는다. */
function gitlabAvatar(users: unknown, matchName?: string): string | null {
  let list = Array.isArray(users) ? (users as { name?: string; avatar_url?: string }[]) : [];
  const n = matchName?.trim().toLowerCase();
  if (n) list = list.filter((u) => u.name?.trim().toLowerCase() === n);
  const u = list.length === 1 ? list[0].avatar_url : undefined;
  return u && !u.includes("gravatar.com") ? u : null;
}

async function resolve(email: string, name: string, githubRepos: string[]): Promise<string | null> {
  // ① GitHub noreply: 12345+name@users.noreply.github.com 또는 name@users.noreply.github.com
  const gh = email.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
  if (gh) return gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=64` : `https://github.com/${gh[2]}.png?size=64`;
  // ② 사내 GitLab: 공개 이메일 → 이메일 검색 → 사용자 이름(이메일 앞부분) → 이름이 정확히 같은 한 사람
  const q = encodeURIComponent;
  const local = email.split("@")[0];
  for (const a of accounts.accountsFor("gitlab")) {
    const token = await accounts.token(a);
    if (!token) continue;
    const h = { "PRIVATE-TOKEN": token };
    const api = `${a.server}/api/v4`;
    let url: string | null = null;
    const byEmail = (await json(`${api}/avatar?email=${q(email)}&size=64`, h)) as { avatar_url?: string } | null;
    if (byEmail?.avatar_url && !byEmail.avatar_url.includes("gravatar.com")) url = byEmail.avatar_url;
    if (!url) url = gitlabAvatar(await json(`${api}/users?search=${q(email)}&per_page=5`, h));
    // 회사 GitLab 은 보통 사용자 이름 = 이메일 앞부분
    if (!url && local) url = gitlabAvatar(await json(`${api}/users?username=${q(local)}`, h));
    if (!url && name) url = gitlabAvatar(await json(`${api}/users?search=${q(name)}&per_page=20`, h), name);
    if (!url) continue;
    const full = url.startsWith("/") ? a.server + url : url;
    // 같은 서버의 사진은 토큰을 붙여 받아 둔다(비공개 서버는 로그인해야 사진이 열린다)
    if (full.startsWith(a.server)) {
      const data = await ipc.httpImage(full, h).catch(() => null);
      if (data) return data;
    } else return full;
  }
  // ③ GitHub 저장소: 그 이메일로 한 커밋의 GitHub 계정 사진
  const ghAccount = accounts.accountsFor("github")[0];
  const ghToken = ghAccount ? await accounts.token(ghAccount) : null;
  if (ghToken) {
    for (const repo of githubRepos) {
      const list = await json(`https://api.github.com/repos/${repo}/commits?author=${q(email)}&per_page=1`, {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
      });
      const u = Array.isArray(list) ? (list[0] as { author?: { avatar_url?: string } | null } | undefined)?.author?.avatar_url : undefined;
      if (u) return u + (u.includes("?") ? "&s=64" : "?s=64");
    }
  }
  // ④ Gravatar(SHA-256 주소, 없으면 404)
  return `https://www.gravatar.com/avatar/${await sha256(email)}?s=64&d=404`;
}

export const avatars = new AvatarStore();
