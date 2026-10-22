import SwiftUI
import AppKit

struct WorktreeSection: View {
    @Environment(RepoStore.self) private var store

    var body: some View {
        Section {
            ForEach(store.worktrees) { w in
                let current = w.path == store.url?.path
                HStack(spacing: 6) {
                    Image(systemName: current ? "folder.fill" : "folder")
                        .foregroundStyle(current ? Color.accentColor : .secondary)
                        .frame(width: 16)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(w.branch ?? "분리된 HEAD \(w.head.map { String($0.prefix(7)) } ?? "")")
                            .fontWeight(current ? .semibold : .regular)
                            .lineLimit(1)
                        Text((w.path as NSString).abbreviatingWithTildeInPath)
                            .font(.caption).foregroundStyle(.secondary)
                            .lineLimit(1).truncationMode(.head)
                    }
                    Spacer(minLength: 4)
                    if isTemporary(w.path) && !w.prunable {
                        Text("임시").font(.caption2.weight(.semibold)).foregroundStyle(.orange)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.15)))
                            .help("임시 폴더 안의 워크트리 — 재부팅하면 폴더가 지워져 깨질 수 있습니다")
                    }
                    if w.prunable {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
                            .help("폴더가 사라진 워크트리 — '정리'로 지울 수 있습니다")
                    } else if w.locked {
                        Image(systemName: "lock").foregroundStyle(.secondary).help("잠긴 워크트리")
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { open(w) }
                .contextMenu {
                    Button("Branchwork 에서 열기") { open(w) }.disabled(current)
                    Button("Finder 에서 보기") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: w.path)]) }
                    Button("아래 터미널에서 열기") { store.newTerminal(in: w.path) }
                    Button("Terminal 앱에서 열기") { Launcher.openTerminal(at: w.path) }
                    Button("에이전트 실행 (\(AgentCenter.shared.defaultKind.title))") { store.startAgent(in: w.path) }
                    Button("경로 복사") { store.copy(w.path) }
                    Divider()
                    Button("제거…", role: .destructive) { store.confirmRemove(w) }.disabled(w.isMain || current)
                    Button("강제 제거…", role: .destructive) { store.confirmRemove(w, force: true) }.disabled(w.isMain || current)
                }
            }
        } header: {
            HStack {
                Text("워크트리 \(store.worktrees.count)")
                Spacer()
                if store.worktrees.contains(where: \.prunable) {
                    Button("정리") { Task { await store.pruneWorktrees() } }
                        .buttonStyle(.borderless).font(.caption)
                }
                Button { store.sheet = .addWorktree(branch: nil, start: nil) } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help("새 워크트리")
            }
        }
    }

    private func open(_ w: Worktree) {
        Task { await store.openOrReport(URL(fileURLWithPath: w.path, isDirectory: true)) }
    }

    private func isTemporary(_ path: String) -> Bool {
        ["/private/tmp/", "/tmp/", "/private/var/folders/", "/var/folders/"].contains { path.hasPrefix($0) }
    }
}
