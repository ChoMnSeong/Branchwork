import { accounts } from "./accounts";
import { ipc } from "./ipc";
import { Observable } from "./observable";
import { settings } from "./settings";

/**
 * 커밋 작성자 프로필 사진 주소. 이메일로 찾는다:
 * ① GitHub noreply 주소면 GitHub 프로필 ② 연결한 사내 GitLab 의 프로필 ③ Gravatar(없으면 404 → 이니셜).
 * 이번 실행 동안만 기억한다(사진 자체는 웹뷰가 캐시).
 */
class AvatarStore extends Observable {
  private urls = new Map<string, string | null>();
  private pending = new Set<string>();
  private queue: string[] = [];
  private running = 0;
  /** 이미지가 안 열린 주소(404 등) */
  failed = new Set<string>();

  get enabled() {
    return settings.get("avatarFetch", true);
  }

  setEnabled(v: boolean) {
    settings.set("avatarFetch", v);
    this.emit();
  }

  /** 주소가 정해졌으면 주소(없으면 null), 아직이면 undefined 를 돌려주고 뒤에서 찾는다 */
  url(rawEmail: string): string | null | undefined {
    if (!this.enabled) return null;
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes("@")) return null;
    if (this.urls.has(email)) return this.urls.get(email);
    if (!this.pending.has(email)) {
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
      void resolve(email)
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

async function resolve(email: string): Promise<string | null> {
  // ① GitHub noreply: 12345+name@users.noreply.github.com 또는 name@users.noreply.github.com
  const gh = email.match(/^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/);
  if (gh) return gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=64` : `https://github.com/${gh[2]}.png?size=64`;
  // ② 사내 GitLab: 그 서버에 사진을 올린 사용자만(Gravatar 로 돌려주면 ③)
  for (const a of accounts.accountsFor("gitlab")) {
    const token = await accounts.token(a);
    if (!token) continue;
    try {
      const r = await ipc.http("GET", `${a.server}/api/v4/avatar?email=${encodeURIComponent(email)}&size=64`, { "PRIVATE-TOKEN": token }, undefined, 10000);
      if (r.status !== 200) continue;
      const u = JSON.parse(r.body).avatar_url as string | undefined;
      if (u && !u.includes("gravatar.com")) return u.startsWith("/") ? a.server + u : u;
    } catch {
      /* 다음 서버 */
    }
  }
  // ③ Gravatar(SHA-256 주소, 없으면 404)
  return `https://www.gravatar.com/avatar/${await sha256(email)}?s=64&d=404`;
}

export const avatars = new AvatarStore();
