import SwiftUI
import AppKit

/// 사이드바 '에이전트' 탭: 워크트리 카드 + 그 안에서 도는 Claude Code 세션
struct AgentsPanel: View {
    @Environment(RepoStore.self) private var store
    private let agents = AgentCenter.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("워크트리").font(.headline)
                    Text("\(store.worktrees.count)").foregroundStyle(.secondary)
                    Spacer()
                    if agents.sessions.contains(where: { $0.status == .ended }) {
                        Button("종료된 세션 지우기") { agents.clearEnded() }
                            .buttonStyle(.borderless).font(.caption)
                    }
                    Button { store.sheet = .addWorktree(branch: nil, start: nil) } label: { Image(systemName: "plus") }
                        .buttonStyle(.borderless)
                        .help("새 워크트리")
                }

                HStack(spacing: 6) {
                    Button { store.sheet = .startAgent(path: nil) } label: {
                        Label("세션 시작", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    .help("Claude Code 세션 시작 — 작업할 워크트리와 맡길 일을 고릅니다")
                    Button { if let u = store.url { store.startClaude(in: u.path) } } label: {
                        Image(systemName: "bolt.fill")
                    }
                    .controlSize(.large)
                    .help("지금 이 워크트리에서 바로 시작")
                }

                ForEach(store.worktrees) { w in
                    WorktreeCard(worktree: w,
                                 stats: store.worktreeStats[w.path],
                                 sessions: agents.sessions(in: w.path),
                                 isCurrent: AgentCenter.normalize(w.path) == AgentCenter.normalize(store.url?.path ?? ""))
                }

                let known = Set(store.worktrees.map { AgentCenter.normalize($0.path) })
                let others = agents.sessions.filter { !known.contains(AgentCenter.normalize($0.path)) && $0.status != .ended }
                if !others.isEmpty {
                    Text("다른 폴더의 세션").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 6)
                    ForEach(others) { s in
                        SessionRow(session: s, showPath: true)
                    }
                }

                Text("여기서 시작한 세션만 상태가 보입니다. 세션을 누르면 그 Terminal 창으로 이동합니다.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
            }
            .padding(10)
        }
        .task(id: store.worktrees.map(\.path)) {
            // 다른 워크트리는 파일 감시 대상이 아니라 몇 초마다 다시 센다
            while !Task.isCancelled {
                await store.refreshWorktreeStats()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

private struct WorktreeCard: View {
    @Environment(RepoStore.self) private var store
    let worktree: Worktree
    let stats: WorktreeStats?
    let sessions: [AgentSession]
    let isCurrent: Bool

    @ViewState private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: worktree.isMain ? "house" : "arrow.triangle.branch")
                    .foregroundStyle(.secondary)
                Text(worktree.branch ?? "분리된 HEAD")
                    .font(.headline)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(worktree.path)
                Spacer(minLength: 4)
                if hover {
                    Button { store.sheet = .startAgent(path: worktree.path) } label: { Image(systemName: "sparkles") }
                        .buttonStyle(.borderless)
                        .help("이 워크트리에서 Claude Code 세션 시작")
                }
            }

            if let stats {
                HStack(spacing: 8) {
                    if stats.isClean && stats.ahead == 0 && stats.behind == 0 {
                        Text("변경 없음").foregroundStyle(.secondary)
                    }
                    if stats.added > 0 { Text("+\(stats.added)").foregroundStyle(.green).help("새 파일") }
                    if stats.modified > 0 {
                        Label("\(stats.modified)", systemImage: "pencil").labelStyle(.titleAndIcon)
                            .foregroundStyle(.orange).help("수정한 파일")
                    }
                    if stats.deleted > 0 { Text("−\(stats.deleted)").foregroundStyle(.red).help("삭제한 파일") }
                    if stats.conflicted > 0 { Text("!\(stats.conflicted)").foregroundStyle(.red).help("충돌") }
                    if !stats.isClean && (stats.ahead > 0 || stats.behind > 0) { Divider().frame(height: 10) }
                    if stats.ahead > 0 { Text("↑\(stats.ahead)").foregroundStyle(.blue).help("원격에 올리지 않은 커밋") }
                    if stats.behind > 0 { Text("↓\(stats.behind)").foregroundStyle(.orange).help("원격에서 받지 않은 커밋") }
                }
                .font(.callout.monospacedDigit().weight(.medium))
            }

            if !sessions.isEmpty {
                Divider()
                ForEach(sessions) { s in SessionRow(session: s, showPath: false) }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 8)
            .strokeBorder(isCurrent ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: isCurrent ? 1.5 : 1))
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture(count: 2) {
            guard !isCurrent else { return }
            Task { await store.openOrReport(URL(fileURLWithPath: worktree.path, isDirectory: true)) }
        }
        .contextMenu {
            Button("Claude Code 세션 시작…") { store.sheet = .startAgent(path: worktree.path) }
            Button("Branchwork 에서 열기") {
                Task { await store.openOrReport(URL(fileURLWithPath: worktree.path, isDirectory: true)) }
            }
            .disabled(isCurrent)
            Button("Finder 에서 보기") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: worktree.path)]) }
            Button("아래 터미널에서 열기") { store.newTerminal(in: worktree.path) }
            Button("Terminal 앱에서 열기") { Launcher.openTerminal(at: worktree.path) }
            Divider()
            Button("워크트리 제거…", role: .destructive) { store.confirmRemove(worktree) }
                .disabled(worktree.isMain || isCurrent)
        }
    }
}

private struct SessionRow: View {
    @Environment(RepoStore.self) private var store
    let session: AgentSession
    let showPath: Bool

    var body: some View {
        let agents = AgentCenter.shared
        HStack(alignment: .top, spacing: 6) {
            StatusDot(status: session.status)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(session.status.title).fontWeight(.medium)
                    if let d = session.detail, session.status != .ended {
                        Text("· \(d)").foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                if !session.task.isEmpty {
                    Text(session.task).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Text((showPath ? (session.path as NSString).abbreviatingWithTildeInPath + " · " : "") + Fmt.short(session.updated))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 0)
        }
        .font(.callout)
        .contentShape(Rectangle())
        .onTapGesture { agents.focus(session) }
        .help(session.status == .ended ? "끝난 세션" : "눌러서 Terminal 창으로 이동")
        .contextMenu {
            Button("Terminal 창으로 이동") { agents.focus(session) }
                .disabled(session.status == .ended)
            Button("같은 곳에서 새 세션") { store.startClaude(in: session.path) }
            Divider()
            if session.status == .ended {
                Button("목록에서 지우기") { agents.remove(id: session.id) }
            } else {
                Button("세션 끝내기…", role: .destructive) {
                    store.confirm = ConfirmRequest(title: "Claude Code 세션을 끝낼까요?",
                                                   message: session.task.isEmpty ? session.path : session.task,
                                                   actionTitle: "끝내기") { agents.stop(session) }
                }
            }
        }
    }
}

private struct StatusDot: View {
    let status: AgentStatus
    @ViewState private var pulse = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .opacity(status == .working && pulse ? 0.35 : 1)
            .animation(status == .working ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: pulse)
            .onAppear { pulse = true }
    }

    private var color: Color {
        switch status {
        case .working: return .blue
        case .permission: return .red
        case .starting, .waiting: return .orange
        case .ended: return .gray
        }
    }
}

// MARK: - 세션 시작

struct StartAgentSheet: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let presetPath: String?

    /// 빈 문자열 = 새 워크트리 만들기
    @ViewState private var target = ""
    @ViewState private var newBranch = ""
    @ViewState private var task = ""
    @ViewState private var mode = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Claude Code 세션 시작").font(.title3.weight(.semibold)).padding([.top, .horizontal], 20)
            Form {
                Picker("작업할 곳", selection: $target) {
                    ForEach(store.worktrees) { w in
                        Text(label(w)).tag(w.path)
                    }
                    Divider()
                    Text("새 워크트리 만들기…").tag("")
                }
                if target.isEmpty {
                    TextField("새 브랜치 이름", text: $newBranch, prompt: Text("feature/claude-작업"))
                    LabeledContent("위치", value: newBranch.trimmed.isEmpty ? "-" : (store.defaultWorktreePath(for: newBranch.trimmed) as NSString).abbreviatingWithTildeInPath)
                }
                TextField("맡길 작업", text: $task, prompt: Text("예: 로그인 실패 시 잠금 처리 추가하고 테스트까지"), axis: .vertical)
                    .lineLimit(3...6)
                Picker("권한 모드", selection: $mode) {
                    Text("기본 (매번 묻기)").tag("")
                    Text("파일 편집 자동 승인").tag("acceptEdits")
                    Text("계획만 세우기").tag("plan")
                    Text("자동").tag("auto")
                }
            }
            .formStyle(.grouped)
            HStack {
                Text("새 Terminal 창에서 실행되고, 상태는 에이전트 탭에 표시됩니다.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("취소", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("시작") { start() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(target.isEmpty && !validBranch)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 560)
        .onAppear {
            target = presetPath ?? store.url?.path ?? store.worktrees.first?.path ?? ""
        }
    }

    private var validBranch: Bool {
        let b = newBranch.trimmed
        return !b.isEmpty && !b.contains(" ") && !b.hasPrefix("-") && !FileManager.default.fileExists(atPath: store.defaultWorktreePath(for: b))
    }

    private func label(_ w: Worktree) -> String {
        let name = w.branch ?? "분리된 HEAD"
        return w.path == store.url?.path ? "\(name)  (지금 연 곳)" : name
    }

    private func start() {
        let path = target, branch = newBranch.trimmed, t = task, m = mode.isEmpty ? nil : mode
        dismiss()
        if path.isEmpty {
            let wtPath = store.defaultWorktreePath(for: branch)
            Task {
                await store.addWorktree(path: wtPath, branch: branch, createNew: true, start: nil, launchClaude: false, task: "")
                if FileManager.default.fileExists(atPath: wtPath) {
                    store.startClaude(in: wtPath, task: t, permissionMode: m)
                }
            }
        } else {
            store.startClaude(in: path, task: t, permissionMode: m)
        }
    }
}
