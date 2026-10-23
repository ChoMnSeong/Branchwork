import { accountApiBase, accountHost, type HostAccount, type Provider, type RepoTarget } from "@/entities/git";
import { ipc } from "@/shared/api";
import { env, settings } from "@/shared/config";
import { t } from "@/shared/i18n";
import { Observable } from "@/shared/lib";
import { tools } from "@/shared/platform";
import * as Hosting from "../api/hosting";

/** GitHub·사내 GitLab 계정(여러 개). 앱 전체에서 하나만 쓴다. (맥 버전 AccountStore) */
class AccountStore extends Observable {
  accounts: HostAccount[] = [];
  /** 계정이 바뀔 때마다 증가 — 열린 저장소가 PR 목록을 다시 읽는 신호 */
  revision = 0;
  /** 열린 저장소가 사내 GitLab 인데 계정이 없을 때, 설정 화면에 미리 채워 둘 서버 주소 */
  suggestedGitLabServer = "";

  private preferred: Record<string, string> = {};
  private aliases: Record<string, string> = {};
  private secrets = new Map<string, string | null>();

  async load() {
    this.accounts = settings.get<HostAccount[]>("accounts", []);
    this.preferred = settings.get<Record<string, string>>("preferredAccounts", {});
    this.aliases = settings.get<Record<string, string>>("hostAliases", {});
    this.emit();
  }

  get ghPath() {
    return tools.path("gh");
  }

  accountsFor(p: Provider) {
    return this.accounts.filter((a) => a.provider === p);
  }

  /** 이 저장소 서버에 쓸 수 있는 계정(같은 주소이거나, 같은 서버의 다른 주소로 확인된 계정) */
  candidates(target: RepoTarget) {
    return this.accounts.filter((a) => a.provider === target.provider && (accountHost(a) === target.host || this.aliases[target.host] === a.id));
  }

  /** 이 저장소에 쓸 계정: 저장소마다 고른 계정 → 없으면 그 서버의 첫 계정 */
  accountFor(target: RepoTarget, repoPath: string | null) {
    const list = this.candidates(target);
    const id = repoPath ? this.preferred[repoPath] : undefined;
    return list.find((a) => a.id === id) ?? list[0] ?? null;
  }

  setPreferred(a: HostAccount, repoPath: string) {
    this.preferred = { ...this.preferred, [repoPath]: a.id };
    settings.set("preferredAccounts", this.preferred);
    this.revision++;
    this.emit();
  }

  /**
   * 저장소 서버 주소가 연결된 계정 서버의 다른 이름인지 확인해 같은 서버로 기억한다.
   * sameAddressOnly 이면 두 주소가 같은 IP 를 가리킬 때만 토큰으로 확인한다(엉뚱한 서버로 토큰을 보내지 않게).
   */
  async discoverAlias(target: RepoTarget, sameAddressOnly: boolean): Promise<HostAccount | null> {
    for (const a of this.accountsFor(target.provider)) {
      if (accountHost(a) === target.host) continue;
      if (sameAddressOnly) {
        const [x, y] = await Promise.all([ipc.resolveHost(accountHost(a)), ipc.resolveHost(target.host)]);
        if (!x.some((ip) => y.includes(ip))) continue;
      }
      const tok = await this.token(a);
      if (!tok) continue;
      try {
        const m = await Hosting.me(target.provider, tok, `https://${target.host}/api/v4`);
        if (m.username !== a.username) continue;
      } catch {
        continue;
      }
      this.aliases = { ...this.aliases, [target.host]: a.id };
      settings.set("hostAliases", this.aliases);
      this.revision++;
      this.emit();
      return a;
    }
    return null;
  }

  private async secret(name: string) {
    if (this.secrets.has(name)) return this.secrets.get(name) ?? null;
    const v = await ipc.secretGet(name).catch(() => null);
    this.secrets.set(name, v);
    return v;
  }

  token(a: HostAccount) {
    return this.secret("acct:" + a.id);
  }

  // MARK: 연결·해제

  /** "gitlab.회사.co.kr" → "https://gitlab.회사.co.kr" (끝 / 제거) */
  static normalizeServer(s: string) {
    let v = s.trim();
    if (!v.includes("://")) v = "https://" + v;
    return v.replace(/\/+$/, "");
  }

  connectGitHub(token: string) {
    return this.add("github", "https://github.com", token);
  }

  /** 사내(자체 호스팅) GitLab 만 받는다 — gitlab.com 은 지금은 연결하지 않는다 */
  connectGitLab(server: string, token: string) {
    const base = AccountStore.normalizeServer(server);
    let host = "";
    try {
      host = new URL(base).hostname.toLowerCase();
    } catch {
      /* 아래에서 */
    }
    if (!host) throw new Error(t("Check the server address. Example: https://gitlab.example.com"));
    if (host === "gitlab.com" || host.endsWith(".gitlab.com"))
      throw new Error(t("Only self-hosted GitLab can be connected for now. Enter your GitLab server address."));
    return this.add("gitlab", base, token);
  }

  private async add(provider: Provider, server: string, token: string): Promise<HostAccount> {
    const text = token.trim();
    const m = await Hosting.me(provider, text, accountApiBase({ provider, server }));
    const probeHost = accountHost({ id: "", provider, server, username: "", name: null, avatarURL: null });
    // 같은 서버의 같은 사용자면 토큰만 바꾼다
    const existing = this.accounts.find((a) => a.provider === provider && accountHost(a) === probeHost && a.username === m.username);
    const acc: HostAccount = {
      id: existing?.id ?? crypto.randomUUID(),
      provider,
      server,
      username: m.username,
      name: m.name,
      avatarURL: m.avatarURL,
    };
    await ipc.secretSet("acct:" + acc.id, text);
    this.secrets.set("acct:" + acc.id, text);
    this.accounts = [...this.accounts.filter((a) => a.id !== acc.id), acc];
    this.save();
    return acc;
  }

  /** gh CLI 에 로그인돼 있는 GitHub 계정을 가져온다 */
  async importGitHubCLI() {
    if (!this.ghPath) throw new Error(t("Couldn't find the gh CLI."));
    const r = await ipc.run(this.ghPath, ["auth", "token"], { cwd: env.temp, timeoutMs: 30000 });
    const text = r.stdout.trim();
    if (r.status !== 0 || !text) throw new Error(r.stderr.trim() || t("You're not logged in to gh. Run `gh auth login` in a terminal first."));
    return this.connectGitHub(text);
  }

  async disconnect(a: HostAccount) {
    await ipc.secretSet("acct:" + a.id, null).catch(() => {});
    this.secrets.delete("acct:" + a.id);
    this.accounts = this.accounts.filter((x) => x.id !== a.id);
    this.preferred = Object.fromEntries(Object.entries(this.preferred).filter(([, v]) => v !== a.id));
    this.aliases = Object.fromEntries(Object.entries(this.aliases).filter(([, v]) => v !== a.id));
    settings.set("preferredAccounts", this.preferred);
    settings.set("hostAliases", this.aliases);
    this.save();
  }

  private save() {
    settings.set("accounts", this.accounts);
    this.revision++;
    this.emit();
  }

  /**
   * 네트워크 git 명령에 붙일 환경: 서버마다 계정 하나씩(이 저장소에 고른 계정 우선) 토큰으로 HTTPS 인증에 답한다.
   * 자격 증명 관리자·도우미가 먼저 답하면 그것이 쓰이고, 비어 있을 때만 이 토큰이 쓰인다.
   * 답하는 프로그램은 Branchwork 실행 파일 자신이다(BRANCHWORK_ASKPASS=1 로 불리면 창 없이 답만 한다).
   */
  async gitEnvironment(target: RepoTarget | null, repoPath: string | null): Promise<Record<string, string>> {
    const byHost = new Map<string, HostAccount>();
    for (const a of this.accounts) if (!byHost.has(accountHost(a))) byHost.set(accountHost(a), a);
    for (const [host, id] of Object.entries(this.aliases)) {
      const a = this.accounts.find((x) => x.id === id);
      if (a && !byHost.has(host)) byHost.set(host, a);
    }
    if (target) {
      const a = this.accountFor(target, repoPath);
      if (a) byHost.set(target.host, a);
    }
    const out: Record<string, string> = { GIT_ASKPASS: env.exe, BRANCHWORK_ASKPASS: "1" };
    let i = 0;
    for (const [host, a] of [...byHost.entries()].sort(([x], [y]) => x.localeCompare(y))) {
      const tok = await this.token(a);
      if (!tok) continue;
      i++;
      out[`BRANCHWORK_ASKPASS_HOST_${i}`] = host;
      out[`BRANCHWORK_ASKPASS_USER_${i}`] = a.provider === "github" ? "x-access-token" : "oauth2";
      out[`BRANCHWORK_ASKPASS_PASS_${i}`] = tok;
    }
    if (!i) return {};
    out["BRANCHWORK_ASKPASS_COUNT"] = String(i);
    return out;
  }
}

export const accounts = new AccountStore();
export { AccountStore };
