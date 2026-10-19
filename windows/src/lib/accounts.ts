import { env, isWindows } from "./env";
import * as Hosting from "./hosting";
import { ipc } from "./ipc";
import { accountApiBase, accountHost, type HostAccount, type Provider, type RepoTarget } from "./models";
import { Observable } from "./observable";
import { settings } from "./settings";

export type ClaudeMode = "cli" | "api";

/** GitHub·사내 GitLab 계정(여러 개)과 Claude 연결 설정. 앱 전체에서 하나만 쓴다. (맥 버전 AccountStore) */
class AccountStore extends Observable {
  accounts: HostAccount[] = [];
  /** 계정이 바뀔 때마다 증가 — 열린 저장소가 PR 목록을 다시 읽는 신호 */
  revision = 0;
  /** 열린 저장소가 사내 GitLab 인데 계정이 없을 때, 설정 화면에 미리 채워 둘 서버 주소 */
  suggestedGitLabServer = "";
  claudeMode: ClaudeMode = "cli";
  claudeModel = "claude-opus-5-5";
  claudeCLIModel = "";
  hasClaudeKey = false;
  cliPath: string | null = null;
  ghPath: string | null = null;

  private preferred: Record<string, string> = {};
  private aliases: Record<string, string> = {};
  private secrets = new Map<string, string | null>();

  async load() {
    this.accounts = settings.get<HostAccount[]>("accounts", []);
    this.preferred = settings.get<Record<string, string>>("preferredAccounts", {});
    this.aliases = settings.get<Record<string, string>>("hostAliases", {});
    this.claudeModel = settings.get("claudeModel", "claude-opus-5-5");
    this.claudeCLIModel = settings.get("claudeCLIModel", "");
    this.hasClaudeKey = settings.get("hasClaudeKey", false);
    const { findCLI } = await import("./claude");
    this.cliPath = await findCLI();
    this.claudeMode = settings.get<ClaudeMode | null>("claudeMode", null) ?? (this.cliPath ? "cli" : "api");
    this.ghPath =
      (await ipc.which("gh")) ??
      (isWindows() ? ((await ipc.exists("C:\\Program Files\\GitHub CLI\\gh.exe")) ? "C:\\Program Files\\GitHub CLI\\gh.exe" : null) : null);
    this.emit();
  }

  setClaudeMode(m: ClaudeMode) {
    this.claudeMode = m;
    settings.set("claudeMode", m);
    this.emit();
  }
  setClaudeModel(m: string) {
    this.claudeModel = m;
    settings.set("claudeModel", m);
    this.emit();
  }
  setClaudeCLIModel(m: string) {
    this.claudeCLIModel = m;
    settings.set("claudeCLIModel", m);
    this.emit();
  }

  accountsFor(p: Provider) {
    return this.accounts.filter((a) => a.provider === p);
  }

  /** 이 저장소 서버에 쓸 수 있는 계정(같은 주소이거나, 같은 서버의 다른 주소로 확인된 계정) */
  candidates(t: RepoTarget) {
    return this.accounts.filter((a) => a.provider === t.provider && (accountHost(a) === t.host || this.aliases[t.host] === a.id));
  }

  /** 이 저장소에 쓸 계정: 저장소마다 고른 계정 → 없으면 그 서버의 첫 계정 */
  accountFor(t: RepoTarget, repoPath: string | null) {
    const list = this.candidates(t);
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
  async discoverAlias(t: RepoTarget, sameAddressOnly: boolean): Promise<HostAccount | null> {
    for (const a of this.accountsFor(t.provider)) {
      if (accountHost(a) === t.host) continue;
      if (sameAddressOnly) {
        const [x, y] = await Promise.all([ipc.resolveHost(accountHost(a)), ipc.resolveHost(t.host)]);
        if (!x.some((ip) => y.includes(ip))) continue;
      }
      const tok = await this.token(a);
      if (!tok) continue;
      try {
        const m = await Hosting.me(t.provider, tok, `https://${t.host}/api/v4`);
        if (m.username !== a.username) continue;
      } catch {
        continue;
      }
      this.aliases = { ...this.aliases, [t.host]: a.id };
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

  async claudeKey() {
    if (this.hasClaudeKey) {
      const k = await this.secret("anthropic");
      if (k) return k;
    }
    return null;
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
    if (!host) throw new Error("서버 주소를 확인하세요. 예: https://gitlab.회사.co.kr");
    if (host === "gitlab.com" || host.endsWith(".gitlab.com"))
      throw new Error("지금은 사내(자체 호스팅) GitLab 만 연결할 수 있습니다. 회사 GitLab 서버 주소를 넣어 주세요.");
    return this.add("gitlab", base, token);
  }

  private async add(provider: Provider, server: string, token: string): Promise<HostAccount> {
    const t = token.trim();
    const m = await Hosting.me(provider, t, accountApiBase({ provider, server }));
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
    await ipc.secretSet("acct:" + acc.id, t);
    this.secrets.set("acct:" + acc.id, t);
    this.accounts = [...this.accounts.filter((a) => a.id !== acc.id), acc];
    this.save();
    return acc;
  }

  /** gh CLI 에 로그인돼 있는 GitHub 계정을 가져온다 */
  async importGitHubCLI() {
    if (!this.ghPath) throw new Error("gh CLI 를 찾지 못했습니다.");
    const r = await ipc.run(this.ghPath, ["auth", "token"], { cwd: env.temp, timeoutMs: 30000 });
    const t = r.stdout.trim();
    if (r.status !== 0 || !t) throw new Error(r.stderr.trim() || "gh 에 로그인돼 있지 않습니다. 터미널에서 `gh auth login` 을 먼저 하세요.");
    return this.connectGitHub(t);
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

  async setClaudeKey(key: string) {
    const k = key.trim();
    await ipc.secretSet("anthropic", k || null);
    this.secrets.set("anthropic", k || null);
    this.hasClaudeKey = !!k;
    settings.set("hasClaudeKey", this.hasClaudeKey);
    this.emit();
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
