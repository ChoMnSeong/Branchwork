import { accountApiBase, branchRemote, branchShort, type HostAccount, providerInfo, type PullRequest, sameTarget } from "@/entities/git";
import * as Hosting from "@/entities/hosting";
import { accounts, type ReviewAccess, ReviewAPI, type ReviewFile, reviewFileChange } from "@/entities/hosting";
import { t } from "@/shared/i18n";
import { describe } from "@/shared/platform";
import { RepoWorktrees } from "./worktrees";

/** GitHub·GitLab: PR·MR 목록·만들기·체크아웃 */
export abstract class RepoHosting extends RepoWorktrees {
  /** 이 저장소의 PR·MR 에 쓰는 계정(같은 서버에 여럿이면 저장소마다 고른 것) */
  get hostingAccount(): HostAccount | null {
    return this.target ? accounts.accountFor(this.target, this.path) : null;
  }

  /** 사용자가 눌렀을 때: 이미 연결한 계정이 이 저장소 서버에도 통하는지 직접 확인 */
  async tryExistingAccounts() {
    const target = this.target;
    if (!target) return;
    if (!(await accounts.discoverAlias(target, false))) {
      this.errorMessage = t("The connected {0} account can't access {1}. Add an account with a token for this server.", providerInfo[target.provider].title, target.host);
      this.emit();
    } else await this.loadPullRequests();
  }

  useAccount(a: HostAccount) {
    if (this.path) accounts.setPreferred(a, this.path);
  }

  async loadPullRequests() {
    const target = this.target;
    if (!target) {
      this.pullRequests = [];
      this.prState = { kind: "idle" };
      this.emit();
      return;
    }
    // 연결된 계정 서버의 다른 주소(같은 IP)면 그 계정으로 확인해 이어 쓴다
    if (!this.hostingAccount && accounts.accountsFor(target.provider).length) await accounts.discoverAlias(target, true);
    const acct = this.hostingAccount;
    const token = acct ? await accounts.token(acct) : null;
    if (!acct || !token) {
      // 사내 GitLab 이면 설정 화면에 그 서버 주소를 미리 채워 둔다
      if (target.provider === "gitlab") accounts.suggestedGitLabServer = `https://${target.host}`;
      this.pullRequests = [];
      this.prState = { kind: "needsAccount" };
      this.emit();
      return;
    }
    this.prState = { kind: "loading" };
    this.emit();
    try {
      const list = await Hosting.pullRequests(target, token, accountApiBase(acct));
      if (!sameTarget(this.target, target)) return;
      this.pullRequests = list;
      this.prState = { kind: "loaded" };
    } catch (e) {
      if (!sameTarget(this.target, target)) return;
      this.prState = { kind: "failed", message: describe(e) };
    }
    this.emit();
  }

  /** PR 브랜치 체크아웃: 같은 저장소 브랜치면 추적 브랜치로, 포크면 pr/번호 로컬 브랜치로 가져온다 */
  async checkoutPullRequest(pr: PullRequest) {
    const target = this.target;
    if (!target) return;
    const remoteName = `${target.remote}/${pr.source}`;
    if (!pr.fromFork) {
      if (!this.remoteBranches.some((b) => b.name === remoteName)) {
        if (!(await this.run(t("Fetching…"), ["fetch", target.remote, pr.source], { network: true }))) return;
      }
      const b = this.remoteBranches.find((x) => x.name === remoteName);
      if (b) {
        await this.checkout(b);
        return;
      }
    }
    const ref = target.provider === "github" ? `refs/pull/${pr.number}/head` : `refs/merge-requests/${pr.number}/head`;
    const local = `${providerInfo[target.provider].requestShort.toLowerCase()}/${pr.number}`;
    if (this.headBranch === local) await this.run(t("Fetching…"), ["pull", "--ff-only", target.remote, ref], { network: true });
    else if (await this.run(t("Fetching…"), ["fetch", target.remote, `+${ref}:refs/heads/${local}`], { network: true }))
      await this.run(t("Checking out…"), ["switch", local]);
  }

  /** PR 대상 브랜치 후보: 원격 브랜치 이름(원격 접두사 제외) */
  pullRequestBaseCandidates() {
    const target = this.target;
    if (!target) return [];
    return this.remoteBranches.filter((b) => branchRemote(b) === target.remote && branchShort(b) !== this.headBranch).map(branchShort);
  }

  async defaultBaseBranch() {
    const candidates = this.pullRequestBaseCandidates();
    const target = this.target,
      acct = this.hostingAccount;
    if (target && acct) {
      const token = await accounts.token(acct);
      if (token) {
        try {
          const b = await Hosting.defaultBranch(target, token, accountApiBase(acct));
          if (b && candidates.includes(b)) return b;
        } catch {
          /* 아래 */
        }
      }
    }
    return ["main", "master", "develop"].find((b) => candidates.includes(b)) ?? candidates[0] ?? null;
  }

  async createPullRequest(title: string, body: string, base: string, draft: boolean) {
    const target = this.target,
      branch = this.headBranch;
    if (!target || !branch) return;
    const acct = this.hostingAccount;
    const token = acct ? await accounts.token(acct) : null;
    if (!acct || !token) {
      this.errorMessage = t("Connect a {0} ({1}) account first (Settings > Accounts).", providerInfo[target.provider].title, target.host);
      this.emit();
      return;
    }
    // 원격에 브랜치가 없거나 올리지 않은 커밋이 있으면 먼저 push
    if (!this.status.upstream) {
      if (!(await this.run(t("Pushing…"), ["push", "-u", target.remote, branch], { network: true }))) return;
    } else if (this.status.ahead > 0) {
      if (!(await this.run(t("Pushing…"), ["push"], { network: true }))) return;
    }
    this.busy = t("Creating {0}…", providerInfo[target.provider].requestShort);
    this.emit();
    try {
      const pr = await Hosting.createPullRequest(target, token, accountApiBase(acct), { title, body, source: branch, target: base, draft });
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

  // MARK: 리뷰(대화·바뀐 파일·승인) — 맥 버전 RepoStore+Review

  protected async reviewAccess(): Promise<ReviewAccess | null> {
    const target = this.target,
      a = this.hostingAccount;
    const token = a ? await accounts.token(a) : null;
    return target && a && token ? { target: target, token, apiBase: accountApiBase(a), me: a.username } : null;
  }

  async loadReview(n: number) {
    const c = await this.reviewAccess();
    if (!c) {
      this.reviewError = t("Connect an account to see the conversation and approvals.");
      this.emit();
      return;
    }
    if (this.review?.number !== n) this.review = null;
    this.reviewLoading = true;
    this.reviewError = null;
    this.emit();
    try {
      const r = await ReviewAPI.load(c, n);
      if (this.selection?.kind === "pullRequest" && this.selection.number === n) this.review = r;
    } catch (e) {
      if (this.selection?.kind === "pullRequest" && this.selection.number === n) this.reviewError = describe(e);
    }
    this.reviewLoading = false;
    this.emit();
  }

  /** 버튼 동작 공통: 실패하면 권한 안내를 덧붙이고, 성공하면 다시 읽는다 */
  private async reviewAction(n: number, work: (c: ReviewAccess) => Promise<unknown>): Promise<boolean> {
    const c = await this.reviewAccess();
    if (!c || this.reviewBusy) return false;
    this.reviewBusy = true;
    this.emit();
    try {
      await work(c);
    } catch (e) {
      let msg = describe(e);
      if (e instanceof Hosting.HostingError && [403, 404, 422].includes(e.status)) {
        msg +=
          c.target.provider === "gitlab"
            ? t("\n\nThe token needs the api scope, and only people who can approve this MR can approve it.")
            : t("\n\nThe token needs write access to pull requests (classic token: repo). You can't approve your own PR.");
      }
      this.reviewBusy = false;
      this.showError(msg);
      return false;
    }
    this.reviewBusy = false;
    await this.loadReview(n);
    return true;
  }

  postReviewComment(n: number, body: string) {
    return this.reviewAction(n, (c) => ReviewAPI.comment(c, n, body));
  }

  approvePullRequest(n: number, body: string) {
    return this.reviewAction(n, (c) => ReviewAPI.approve(c, n, body));
  }

  unapprovePullRequest(n: number) {
    return this.reviewAction(n, (c) => ReviewAPI.unapprove(c, n));
  }

  requestChanges(n: number, body: string) {
    return this.reviewAction(n, (c) => ReviewAPI.requestChanges(c, n, body));
  }

  /** 바뀐 파일을 누르면 가운데에 그 파일의 diff(PR 의 패치로) */
  openReviewFile(n: number, f: ReviewFile) {
    this.openDiff({ kind: "review", number: n, change: reviewFileChange(f), patch: f.patch ?? "" });
  }
}
