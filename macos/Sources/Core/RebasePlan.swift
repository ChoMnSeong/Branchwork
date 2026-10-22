import Foundation

/// 인터랙티브 리베이스(커밋 정리)에서 커밋마다 할 일
enum RebaseAction: String, CaseIterable, Identifiable {
    case pick, reword, squash, fixup, drop
    var id: String { rawValue }

    var title: String {
        switch self {
        case .pick: return "그대로"
        case .reword: return "메시지 고치기"
        case .squash: return "아래 커밋에 합치기"
        case .fixup: return "아래 커밋에 합치기(메시지 버림)"
        case .drop: return "빼기"
        }
    }

    var symbol: String {
        switch self {
        case .pick: return "checkmark"
        case .reword: return "pencil"
        case .squash: return "arrow.down.to.line"
        case .fixup: return "arrow.down.to.line.compact"
        case .drop: return "trash"
        }
    }
}

struct RebaseItem: Identifiable, Hashable {
    let sha: String
    let subject: String
    /// 원래 전체 메시지
    let message: String
    let author: String
    var action: RebaseAction = .pick
    /// 메시지 고치기일 때 새 메시지
    var newMessage: String
    var id: String { sha }

    init(sha: String, message: String, author: String) {
        self.sha = sha
        self.message = message
        self.author = author
        subject = message.split(separator: "\n", maxSplits: 1).first.map { String($0).trimmed } ?? ""
        newMessage = message
    }
}

/// 커밋 정리 계획: base 위로 items 를 다시 쌓는다
struct RebasePlan {
    /// 이 커밋 위로 다시 쌓는다(nil 이면 첫 커밋부터 --root)
    var base: String?
    /// 화면 순서(위가 최신)
    var items: [RebaseItem]
    /// 원래 순서(위가 최신)
    let original: [String]
    /// 이미 원격에 올린 커밋이 들어 있는지
    var pushed = false

    init(base: String?, items: [RebaseItem], pushed: Bool = false) {
        self.base = base
        self.items = items
        original = items.map(\.sha)
        self.pushed = pushed
    }

    /// 실행할 수 없는 계획이면 그 이유
    var problem: String? {
        let kept = items.filter { $0.action != .drop }
        if kept.isEmpty { return "커밋을 하나 이상 남겨야 합니다." }
        if let oldest = kept.last, oldest.action == .squash || oldest.action == .fixup {
            return "가장 아래(오래된) 커밋은 합칠 대상이 없습니다."
        }
        if items.contains(where: { $0.action == .reword && $0.newMessage.trimmed.isEmpty }) { return "고칠 메시지가 비어 있습니다." }
        return nil
    }

    /// 원래와 달라진 게 있는지(순서·할 일·메시지)
    var changed: Bool {
        items.map(\.sha) != original || items.contains { $0.action != .pick && !($0.action == .reword && $0.newMessage == $0.message) }
    }

    /// git-rebase-todo 내용(오래된 것부터). 메시지 고치기는 그 커밋을 고른 뒤 새 메시지 파일로 고쳐 쓴다.
    func todo(messageFile: (String) -> String) -> String {
        var out: [String] = []
        for item in items.reversed() {
            switch item.action {
            case .pick: out.append("pick \(item.sha)")
            case .reword:
                out.append("pick \(item.sha)")
                if item.newMessage != item.message {
                    out.append("exec git commit --amend --no-verify --allow-empty -F \(Self.shellQuote(messageFile(item.sha)))")
                }
            case .squash: out.append("squash \(item.sha)")
            case .fixup: out.append("fixup \(item.sha)")
            case .drop: out.append("drop \(item.sha)")
            }
        }
        return out.joined(separator: "\n") + "\n"
    }

    /// sh 에 넘길 작은따옴표 인용
    static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
