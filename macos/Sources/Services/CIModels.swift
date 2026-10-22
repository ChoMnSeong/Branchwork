import SwiftUI

/// 파이프라인·작업 상태(GitLab status 와 GitHub status+conclusion 을 하나로)
enum CIStatus: String, Hashable {
    case created, waiting, pending, running, success, failed, canceled, skipped, manual, scheduled, neutral, unknown

    init(gitlab s: String) {
        switch s {
        case "created": self = .created
        case "waiting_for_resource", "preparing", "waiting_for_callback": self = .waiting
        case "pending": self = .pending
        case "running": self = .running
        case "success": self = .success
        case "failed": self = .failed
        case "canceled", "canceling": self = .canceled
        case "skipped": self = .skipped
        case "manual": self = .manual
        case "scheduled": self = .scheduled
        default: self = .unknown
        }
    }

    init(github status: String?, conclusion: String?) {
        switch status {
        case "queued", "requested", "pending": self = .pending
        case "waiting": self = .waiting           // 환경 보호 규칙의 승인 대기
        case "in_progress": self = .running
        case "completed":
            switch conclusion {
            case "success": self = .success
            case "failure", "timed_out", "startup_failure": self = .failed
            case "cancelled": self = .canceled
            case "skipped": self = .skipped
            case "action_required": self = .manual
            case "neutral", "stale": self = .neutral
            default: self = .unknown
            }
        default: self = .unknown
        }
    }

    var title: String {
        switch self {
        case .created: return "생성됨"
        case .waiting: return "대기 중"
        case .pending: return "대기열"
        case .running: return "실행 중"
        case .success: return "성공"
        case .failed: return "실패"
        case .canceled: return "취소됨"
        case .skipped: return "건너뜀"
        case .manual: return "수동 실행 대기"
        case .scheduled: return "예약됨"
        case .neutral: return "완료"
        case .unknown: return "알 수 없음"
        }
    }

    var symbol: String {
        switch self {
        case .created, .pending: return "circle.dashed"
        case .waiting: return "pause.circle.fill"
        case .running: return "arrow.triangle.2.circlepath.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .canceled: return "slash.circle.fill"
        case .skipped: return "forward.circle"
        case .manual: return "hand.tap.fill"
        case .scheduled: return "clock.fill"
        case .neutral, .unknown: return "circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .success: return .green
        case .failed: return .red
        case .running: return .blue
        case .waiting, .manual: return .orange
        case .scheduled: return .purple
        default: return .secondary
        }
    }

    /// 아직 끝나지 않아 자주 새로 고쳐야 하는 상태
    var isActive: Bool { [.created, .waiting, .pending, .running].contains(self) }
    var isFinished: Bool { [.success, .failed, .canceled, .skipped, .neutral].contains(self) }
}

/// GitLab 파이프라인 / GitHub Actions 실행
struct CIPipeline: Identifiable, Hashable {
    let id: Int
    /// GitLab iid / GitHub run_number
    let number: Int
    /// GitHub 워크플로 이름, GitLab 파이프라인 이름(있으면)
    let name: String
    /// GitHub: 커밋 메시지·PR 제목. GitLab 은 없어서 화면에서 로컬 커밋 제목으로 채운다
    let title: String
    let ref: String
    let sha: String
    let status: CIStatus
    let url: String
    let created: Date?
    /// push, web, schedule, workflow_dispatch …
    let event: String
    let actor: String?

    var eventTitle: String {
        switch event {
        case "push": return "push"
        case "web", "workflow_dispatch": return "수동"
        case "schedule": return "예약"
        case "merge_request_event", "pull_request", "pull_request_target": return "MR·PR"
        case "api": return "API"
        case "trigger", "repository_dispatch": return "트리거"
        case "parent_pipeline", "pipeline", "workflow_run": return "연결"
        default: return event
        }
    }
}

struct CIJob: Identifiable, Hashable {
    let id: Int
    let name: String
    /// GitLab 단계(GitHub 은 빈 문자열)
    let stage: String
    let status: CIStatus
    let url: String
    let allowFailure: Bool
    let duration: Double?

    /// GitLab 수동 작업(when: manual)·지연 작업(when: delayed)은 바로 실행할 수 있다
    var canPlay: Bool { status == .manual || status == .scheduled }
}

/// GitHub 환경 보호 규칙 때문에 승인을 기다리는 배포
struct CIDeployment: Identifiable, Hashable {
    let environmentID: Int
    let environment: String
    let canApprove: Bool
    var id: Int { environmentID }
}

/// "Run workflow" 버튼이 있는(workflow_dispatch) GitHub 워크플로
struct CIWorkflow: Identifiable, Hashable {
    let id: Int
    let name: String
    let path: String
    var inputs: [CIInput]
}

/// workflow_dispatch 입력값 / GitLab 파이프라인 변수(.gitlab-ci.yml 에 설명이 있는 변수)
struct CIInput: Identifiable, Hashable {
    let name: String
    let description: String
    let required: Bool
    let defaultValue: String
    /// string, boolean, choice, number, environment
    let type: String
    let options: [String]
    var id: String { name }
}
