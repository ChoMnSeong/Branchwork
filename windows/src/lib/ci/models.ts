

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
