import { ChevronRight, Circle, CircleCheck, CircleDashed, CirclePause, CirclePlay, CircleSlash, CircleStop, CircleX, Clock, Hand, ListFilter, Play, RefreshCw, RotateCw, SkipForward, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { accounts } from "../../lib/accounts";
import { canPlay, eventTitle, isActiveCI, isFinishedCI, statusInfo, type CIDeployment, type CIJob, type CIPipeline, type CIStatus } from "../../lib/ci/models";
import { shortDate } from "../../lib/format";
import type { Provider } from "../../lib/models";
import { useObserve } from "../../lib/observable";
import type { RepoStore } from "../../lib/repo";
import { Button, IconButton, showContextMenu, Spinner } from "../shared/ui";

/** 사이드바 'CI/CD' 탭: GitLab 파이프라인·GitHub Actions 실행. 수동 작업 ▶ 실행, 다시 실행, 취소, 배포 승인. */
export function CIPanel({ store, openSettings }: { store: RepoStore; openSettings: () => void }) {
  useObserve(store);
  const ci = useObserve(store.ci);
  useObserve(accounts);
  const target = store.target;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const key = target ? `${target.host}/${target.path}/${ci.currentBranchOnly}/${accounts.revision}` : "";

  // 처음 읽고, 실행 중인 게 있으면 8초·없으면 45초마다 새로 고친다(펼친 파이프라인의 작업도)
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stop) return;
      await ci.load(true);
      for (const p of ci.pipelines) {
        if (expandedRef.current.has(p.id) && (isActiveCI(p.status) || !ci.jobs.has(p.id))) await ci.loadJobs(p, true);
      }
      schedule();
    };
    const schedule = () => {
      if (stop) return;
      const active = ci.pipelines.some((p) => isActiveCI(p.status));
      timer = setTimeout(() => void tick(), active ? 8000 : 45000);
    };
    void ci.load().then(schedule);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, ci]);

  if (!target) {
    return (
      <div className="side-scroll col" style={{ alignItems: "center", justifyContent: "center", gap: 8, padding: 20, textAlign: "center" }}>
        <Zap size={28} style={{ opacity: 0.35 }} />
        <span className="muted">GitHub·GitLab 원격이 있는 저장소에서 파이프라인을 보고 실행할 수 있습니다.</span>
      </div>
    );
  }

  const toggle = (p: CIPipeline, open?: boolean) => {
    const next = new Set(expanded);
    const willOpen = open ?? !next.has(p.id);
    if (willOpen) {
      next.add(p.id);
      void ci.loadJobs(p);
    } else next.delete(p.id);
    setExpanded(next);
  };

  const st = ci.state;
  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: "4px 12px 6px", gap: 4, borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600 }}>{target.provider === "gitlab" ? "파이프라인" : "Actions"}</span>
        {st.kind === "loading" && <Spinner size={11} />}
        <span className="spacer" />
        <IconButton
          small
          className={ci.currentBranchOnly ? "on" : ""}
          icon={<ListFilter size={13} />}
          tip={ci.currentBranchOnly ? "모든 브랜치 보기" : `현재 브랜치(${ci.currentRef ?? "-"})만 보기`}
          onClick={() => ci.setCurrentBranchOnly(!ci.currentBranchOnly)}
        />
        <IconButton small icon={<RefreshCw size={12} />} tip="새로 고침" onClick={() => void ci.load()} />
        <IconButton
          small
          icon={<CirclePlay size={14} />}
          tip={target.provider === "gitlab" ? "새 파이프라인 실행|브랜치와 변수를 골라 실행합니다" : "워크플로 실행(Run workflow)|workflow_dispatch 워크플로를 브랜치·입력값으로 실행합니다"}
          disabled={!ci.hasAccess || ci.busy.has("run")}
          onClick={() => {
            store.sheet = { kind: "runPipeline" };
            store.changed();
          }}
        />
      </div>
      <div className="side-scroll">
        {st.kind === "needsAccount" && (
          <div className="col" style={{ gap: 6, padding: 8, alignItems: "flex-start" }}>
            <span className="muted">파이프라인을 보려면 {target.provider === "gitlab" ? `사내 GitLab(${target.host})` : "GitHub"} 계정을 연결하세요.</span>
            <button className="link" onClick={openSettings}>
              계정 연결…
            </button>
          </div>
        )}
        {st.kind === "failed" && (
          <div className="col" style={{ gap: 6, padding: 8, alignItems: "flex-start" }}>
            <span className="error-text" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", userSelect: "text" }}>
              {st.message}
            </span>
            <button className="link" onClick={() => void ci.load()}>
              다시 시도
            </button>
          </div>
        )}
        {st.kind === "loaded" && !ci.pipelines.length && <div className="muted" style={{ padding: 8 }}>{ci.currentBranchOnly ? "이 브랜치의 실행 기록이 없습니다." : "실행 기록이 없습니다."}</div>}
        {st.kind !== "needsAccount" &&
          st.kind !== "failed" &&
          ci.pipelines.map((p) => (
            <div key={p.id}>
              <PipelineRow store={store} pipeline={p} provider={target.provider} open={expanded.has(p.id)} toggle={(o) => toggle(p, o)} />
              {expanded.has(p.id) && <PipelineJobs store={store} pipeline={p} />}
            </div>
          ))}
      </div>
    </div>
  );
}

/** 파이프라인·작업 상태 아이콘(실행 중이면 도는 표시) — 그래프·PR 목록에서도 쓴다 */
export function CIStatusIcon({ status, size = 14 }: { status: CIStatus; size?: number }) {
  const info = statusInfo[status];
  let icon: ReactNode;
  switch (status) {
    case "running":
      return (
        <span data-tip={info.title} style={{ display: "inline-flex", width: size, justifyContent: "center", flex: "none" }}>
          <Spinner size={size - 2} />
        </span>
      );
    case "success":
      icon = <CircleCheck size={size} />;
      break;
    case "failed":
      icon = <CircleX size={size} />;
      break;
    case "canceled":
      icon = <CircleSlash size={size} />;
      break;
    case "skipped":
      icon = <SkipForward size={size} />;
      break;
    case "manual":
      icon = <Hand size={size} />;
      break;
    case "waiting":
      icon = <CirclePause size={size} />;
      break;
    case "scheduled":
      icon = <Clock size={size} />;
      break;
    case "created":
    case "pending":
      icon = <CircleDashed size={size} />;
      break;
    default:
      icon = <Circle size={size} />;
  }
  return (
    <span data-tip={info.title} style={{ color: info.color, display: "inline-flex", flex: "none" }}>
      {icon}
    </span>
  );
}

function PipelineRow({ store, pipeline: p, provider, open, toggle }: { store: RepoStore; pipeline: CIPipeline; provider: Provider; open: boolean; toggle: (open?: boolean) => void }) {
  const ci = store.ci;
  const title = p.title || ci.subject(p.sha) || p.name || p.sha.slice(0, 8);
  const manual = (ci.jobs.get(p.id) ?? []).filter(canPlay).length;
  const busy = ci.busy.has(`pipeline:${p.id}`);
  const failed = p.status === "failed" || p.status === "canceled";
  return (
    <div
      className="side-row"
      style={{ alignItems: "center", cursor: "default" }}
      onClick={() => toggle()}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: "브라우저에서 열기", onClick: () => store.openUrl(p.url) },
          { label: "커밋 보기", onClick: () => store.reveal(p.sha) },
          "divider",
          ...(isActiveCI(p.status)
            ? [{ label: "실행 취소", onClick: () => ci.cancelPipeline(p) }]
            : provider === "github"
              ? [
                  { label: "모든 작업 다시 실행", onClick: () => void ci.retryPipeline(p, false) },
                  { label: "실패한 작업만 다시 실행", disabled: !failed, onClick: () => void ci.retryPipeline(p, true) },
                ]
              : [{ label: "실패·취소된 작업 다시 실행", disabled: !failed, onClick: () => void ci.retryPipeline(p, true) }]),
          "divider",
          { label: "링크 복사", onClick: () => store.copy(p.url) },
        ])
      }
    >
      <ChevronRight size={12} style={{ flex: "none", opacity: 0.6, transform: open ? "rotate(90deg)" : undefined, transition: "transform .12s" }} />
      <CIStatusIcon status={p.status} />
      <div className="col grow" style={{ minWidth: 0, gap: 0 }}>
        <span className="ellipsis">{title}</span>
        <span className="side-sub row" style={{ gap: 4, minWidth: 0 }}>
          {provider === "github" && p.name && <span className="ellipsis" style={{ flex: "0 1 auto" }}>{p.name}</span>}
          <span style={{ flex: "none" }}>#{p.number}</span>
          <span className="mono ellipsis" style={{ flex: "0 1 auto" }}>
            {p.ref}
          </span>
          {p.created != null && <span style={{ flex: "none" }}>{shortDate(p.created)}</span>}
          {p.event && p.event !== "push" && <span style={{ flex: "none" }}>· {eventTitle(p.event)}</span>}
        </span>
      </div>
      {manual > 0 && (
        <button
          className="link row"
          style={{ gap: 2, color: "#e8912d", fontWeight: 600, fontSize: 11, flex: "none" }}
          data-tip={`수동 실행을 기다리는 작업 ${manual}개 — 펼쳐서 실행`}
          onClick={(e) => {
            e.stopPropagation();
            toggle(true);
          }}
        >
          <Play size={10} fill="currentColor" /> {manual}
        </button>
      )}
      {busy ? (
        <Spinner size={11} />
      ) : isActiveCI(p.status) ? (
        <IconButton
          small
          icon={<CircleStop size={13} />}
          tip="실행 취소"
          onClick={(e) => {
            e.stopPropagation();
            ci.cancelPipeline(p);
          }}
        />
      ) : failed ? (
        <IconButton
          small
          icon={<RotateCw size={12} />}
          tip={provider === "gitlab" ? "실패·취소된 작업 다시 실행" : "실패한 작업만 다시 실행"}
          onClick={(e) => {
            e.stopPropagation();
            void ci.retryPipeline(p, true);
          }}
        />
      ) : null}
    </div>
  );
}

function PipelineJobs({ store, pipeline }: { store: RepoStore; pipeline: CIPipeline }) {
  const ci = store.ci;
  const jobs = ci.jobs.get(pipeline.id);
  if (!jobs)
    return (
      <div style={{ padding: "4px 30px" }}>
        <Spinner size={12} />
      </div>
    );
  const order: string[] = [];
  const by = new Map<string, CIJob[]>();
  for (const j of jobs) {
    if (!by.has(j.stage)) order.push(j.stage);
    by.set(j.stage, [...(by.get(j.stage) ?? []), j]);
  }
  const deps = ci.deployments.get(pipeline.id) ?? [];
  return (
    <div className="col" style={{ padding: "2px 4px 6px 26px", gap: 1 }}>
      {deps.length > 0 && <DeploymentApproval store={store} pipeline={pipeline} deployments={deps} />}
      {!jobs.length && <span className="muted" style={{ fontSize: 11.5 }}>작업 없음</span>}
      {order.map((stage) => (
        <div key={stage || "-"} className="col" style={{ gap: 1 }}>
          {stage && (
            <span className="muted" style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", marginTop: 3 }}>
              {stage}
            </span>
          )}
          {by.get(stage)!.map((j) => (
            <JobRow key={j.id} store={store} job={j} pipeline={pipeline} />
          ))}
        </div>
      ))}
    </div>
  );
}

function JobRow({ store, job, pipeline }: { store: RepoStore; job: CIJob; pipeline: CIPipeline }) {
  const ci = store.ci;
  const provider = store.target?.provider ?? "gitlab";
  const canRetry = provider === "gitlab" ? job.status === "failed" || job.status === "canceled" || job.status === "success" : isFinishedCI(job.status) && !isActiveCI(pipeline.status);
  const playable = canPlay(job) && provider === "gitlab";
  const cancellable = isActiveCI(job.status) && provider === "gitlab";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  let action: ReactNode = null;
  if (ci.busy.has(`job:${job.id}`)) action = <Spinner size={11} />;
  else if (playable)
    action = (
      <IconButton
        small
        icon={<CirclePlay size={15} />}
        style={{ color: "var(--accent)" }}
        tip={job.status === "scheduled" ? "지금 실행(예약 기다리지 않음)" : "수동 작업 실행"}
        onClick={(e) => {
          stop(e);
          ci.playJob(job, pipeline);
        }}
      />
    );
  else if (cancellable)
    action = (
      <IconButton
        small
        icon={<CircleStop size={13} />}
        tip="작업 취소"
        onClick={(e) => {
          stop(e);
          void ci.cancelJob(job, pipeline);
        }}
      />
    );
  else if (canRetry && job.status !== "success")
    action = (
      <IconButton
        small
        icon={<RotateCw size={12} />}
        tip="작업 다시 실행"
        onClick={(e) => {
          stop(e);
          void ci.retryJob(job, pipeline);
        }}
      />
    );
  return (
    <div
      className="side-row"
      style={{ minHeight: 22, cursor: "default" }}
      data-tip={statusInfo[job.status].title}
      onDoubleClick={() => store.openUrl(job.url)}
      onContextMenu={(e) =>
        showContextMenu(e, [
          { label: "로그 보기(브라우저)", onClick: () => store.openUrl(job.url) },
          ...(playable ? [{ label: "실행", onClick: () => ci.playJob(job, pipeline) }] : []),
          ...(canRetry ? [{ label: "다시 실행", onClick: () => void ci.retryJob(job, pipeline) }] : []),
          ...(cancellable ? [{ label: "취소", onClick: () => void ci.cancelJob(job, pipeline) }] : []),
          "divider",
          { label: "링크 복사", onClick: () => store.copy(job.url) },
        ])
      }
    >
      <CIStatusIcon status={job.status} size={12} />
      <span className="ellipsis grow">{job.name}</span>
      {job.allowFailure && job.status === "failed" && (
        <span data-tip="실패해도 되는 작업" style={{ color: "#e8912d", display: "inline-flex" }}>
          <TriangleAlert size={11} />
        </span>
      )}
      {job.duration != null && job.duration > 0 && (
        <span className="side-sub" style={{ flex: "none" }}>
          {duration(job.duration)}
        </span>
      )}
      {action}
    </div>
  );
}

function duration(s: number) {
  const t = Math.round(s);
  return t >= 60 ? `${Math.floor(t / 60)}분 ${t % 60}초` : `${t}초`;
}

function DeploymentApproval({ store, pipeline, deployments }: { store: RepoStore; pipeline: CIPipeline; deployments: CIDeployment[] }) {
  const mine = deployments.filter((d) => d.canApprove);
  return (
    <div className="col" style={{ gap: 6, padding: 8, margin: "2px 0 4px", borderRadius: 6, background: "color-mix(in srgb, #e8912d 10%, transparent)" }}>
      <span className="row" style={{ gap: 4, color: "#e8912d", fontWeight: 600, fontSize: 11.5 }}>
        <Hand size={12} /> 배포 승인 대기: {deployments.map((d) => d.environment).join(", ")}
      </span>
      {mine.length ? (
        <div className="row" style={{ gap: 6 }}>
          <Button kind="primary" size="small" onClick={() => store.ci.reviewDeployment(pipeline, mine, true)}>
            승인
          </Button>
          <Button size="small" onClick={() => store.ci.reviewDeployment(pipeline, mine, false)}>
            거부
          </Button>
        </div>
      ) : (
        <span className="muted" style={{ fontSize: 11.5 }}>
          이 계정에는 승인 권한이 없습니다.
        </span>
      )}
    </div>
  );
}

// MARK: - 실행 시트
