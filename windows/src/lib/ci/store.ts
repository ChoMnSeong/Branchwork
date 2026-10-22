import { accounts } from "../accounts";
import { joinPath } from "../env";
import { describe } from "../git";
import * as Hosting from "../hosting";
import { ipc } from "../ipc";
import { branchRemote, branchShort, type Provider, type RepoTarget } from "../models";
import { Observable } from "../observable";
import type { RepoStore } from "../repo";
import { settings } from "../settings";
import { CIAPI, type CIAccess } from "./api";
import { type CIDeployment, type CIInput, type CIJob, type CIPipeline, type CIWorkflow, isActiveCI } from "./models";
import { pipelineVariables } from "./yaml";

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
