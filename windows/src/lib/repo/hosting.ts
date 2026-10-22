import { accounts } from "../accounts";
import { describe } from "../git";
import * as Hosting from "../hosting";
import { accountApiBase, branchRemote, branchShort, providerInfo, sameTarget, type HostAccount, type PullRequest } from "../models";
import { RepoWorktrees } from "./worktrees";

/** GitHub·GitLab: PR·MR 목록·만들기·체크아웃 */
export abstract class RepoHosting extends RepoWorktrees {
  /** 이 저장소의 PR·MR 에 쓰는 계정(같은 서버에 여럿이면 저장소마다 고른 것) */
  get hostingAccount(): HostAccount | null {
    return this.target ? accounts.accountFor(this.target, this.path) : null;
  }

  /** 사용자가 눌렀을 때: 이미 연결한 계정이 이 저장소 서버에도 통하는지 직접 확인 */
  async tryExistingAccounts() {
    const t = this.target;
    if (!t) return;
    if (!(await accounts.discoverAlias(t, false))) {
      this.errorMessage = `연결된 ${providerInfo[t.provider].title} 계정으로는 ${t.host} 에 접속되지 않습니다. 이 서버의 토큰으로 계정을 추가해 주세요.`;
      this.emit();
    } else await this.loadPullRequests();
  }

  useAccount(a: HostAccount) {
    if (this.path) accounts.setPreferred(a, this.path);
  }

  async loadPullRequests() {
    const t = this.target;
    if (!t) {
      this.pullRequests = [];
      this.prState = { kind: "idle" };
      this.emit();
      return;
    }
    // 연결된 계정 서버의 다른 주소(같은 IP)면 그 계정으로 확인해 이어 쓴다
    if (!this.hostingAccount && accounts.accountsFor(t.provider).length) await accounts.discoverAlias(t, true);
    const acct = this.hostingAccount;
    const token = acct ? await accounts.token(acct) : null;
    if (!acct || !token) {
      // 사내 GitLab 이면 설정 화면에 그 서버 주소를 미리 채워 둔다
      if (t.provider === "gitlab") accounts.suggestedGitLabServer = `https://${t.host}`;
      this.pullRequests = [];
      this.prState = { kind: "needsAccount" };
      this.emit();
      return;
    }
    this.prState = { kind: "loading" };
    this.emit();
    try {
      const list = await Hosting.pullRequests(t, token, accountApiBase(acct));
      if (!sameTarget(this.target, t)) return;
      this.pullRequests = list;
      this.prState = { kind: "loaded" };
    } catch (e) {
      if (!sameTarget(this.target, t)) return;
      this.prState = { kind: "failed", message: describe(e) };
    }
    this.emit();
  }

  /** PR 브랜치 체크아웃: 같은 저장소 브랜치면 추적 브랜치로, 포크면 pr/번호 로컬 브랜치로 가져온다 */
  async checkoutPullRequest(pr: PullRequest) {
    const t = this.target;
    if (!t) return;
    const remoteName = `${t.remote}/${pr.source}`;
    if (!pr.fromFork) {
      if (!this.remoteBranches.some((b) => b.name === remoteName)) {
        if (!(await this.run("가져오는 중…", ["fetch", t.remote, pr.source], { network: true }))) return;
      }
      const b = this.remoteBranches.find((x) => x.name === remoteName);
      if (b) {
        await this.checkout(b);
        return;
      }
    }
    const ref = t.provider === "github" ? `refs/pull/${pr.number}/head` : `refs/merge-requests/${pr.number}/head`;
    const local = `${providerInfo[t.provider].requestShort.toLowerCase()}/${pr.number}`;
    if (this.headBranch === local) await this.run("가져오는 중…", ["pull", "--ff-only", t.remote, ref], { network: true });
    else if (await this.run("가져오는 중…", ["fetch", t.remote, `+${ref}:refs/heads/${local}`], { network: true }))
      await this.run("체크아웃 중…", ["switch", local]);
  }

  /** PR 대상 브랜치 후보: 원격 브랜치 이름(원격 접두사 제외) */
  pullRequestBaseCandidates() {
    const t = this.target;
    if (!t) return [];
    return this.remoteBranches.filter((b) => branchRemote(b) === t.remote && branchShort(b) !== this.headBranch).map(branchShort);
  }

  async defaultBaseBranch() {
    const candidates = this.pullRequestBaseCandidates();
    const t = this.target,
      acct = this.hostingAccount;
    if (t && acct) {
      const token = await accounts.token(acct);
      if (token) {
        try {
          const b = await Hosting.defaultBranch(t, token, accountApiBase(acct));
          if (b && candidates.includes(b)) return b;
        } catch {
          /* 아래 */
        }
      }
    }
    return ["main", "master", "develop"].find((b) => candidates.includes(b)) ?? candidates[0] ?? null;
  }

  async createPullRequest(title: string, body: string, base: string, draft: boolean) {
    const t = this.target,
      branch = this.headBranch;
    if (!t || !branch) return;
    const acct = this.hostingAccount;
    const token = acct ? await accounts.token(acct) : null;
    if (!acct || !token) {
      this.errorMessage = `${providerInfo[t.provider].title}(${t.host}) 계정을 먼저 연결하세요(설정 > 계정).`;
      this.emit();
      return;
    }
    // 원격에 브랜치가 없거나 올리지 않은 커밋이 있으면 먼저 push
    if (!this.status.upstream) {
      if (!(await this.run("Push 중…", ["push", "-u", t.remote, branch], { network: true }))) return;
    } else if (this.status.ahead > 0) {
      if (!(await this.run("Push 중…", ["push"], { network: true }))) return;
    }
    this.busy = `${providerInfo[t.provider].requestShort} 만드는 중…`;
    this.emit();
    try {
      const pr = await Hosting.createPullRequest(t, token, accountApiBase(acct), { title, body, source: branch, target: base, draft });
      this.busy = null;
      await this.loadPullRequests();
      this.select({ kind: "pullRequest", number: pr.number });
      this.openUrl(pr.url);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = null;
      this.emit();
    }
  }
}
