import SwiftUI
import AppKit

struct PullRequestSection: View {
    @Environment(RepoStore.self) private var store
    @Environment(\.openSettings) private var openSettings
    let target: RepoTarget

    var body: some View {
        Section {
            switch store.prState {
            case .needsAccount:
                let others = AccountStore.shared.accounts(for: target.provider)
                if let a = others.first {
                    Button("연결된 계정(@\(a.username) · \(a.host))으로 시도") { Task { await store.tryExistingAccounts() } }
                        .buttonStyle(.link)
                        .help("같은 서버가 다른 주소로 쓰이는 경우, 이미 연결한 계정이 그대로 통합니다")
                }
                Button(target.provider == .gitlab ? "사내 GitLab(\(target.host)) 계정 연결…" : "GitHub 계정 연결…") { openSettings() }
                    .buttonStyle(.link)
            case .failed(let m):
                Text(m).font(.caption).foregroundStyle(.red).lineLimit(3)
            case .loading where store.pullRequests.isEmpty:
                ProgressView().controlSize(.small)
            case .loaded where store.pullRequests.isEmpty:
                Text("열린 \(target.provider.requestShort) 없음").font(.callout).foregroundStyle(.secondary)
            default:
                EmptyView()
            }
            ForEach(store.pullRequests) { pr in
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("#\(pr.number)").foregroundStyle(.secondary).monospacedDigit()
                        Text(pr.title).lineLimit(1)
                        if let sha = pr.headSHA, let ci = store.ciBySha[sha] {
                            CIStatusIcon(status: ci.status, size: 10)
                                .help("CI: \(ci.status.title) · #\(ci.number)")
                        }
                    }
                    HStack(spacing: 4) {
                        if pr.isDraft { Text("Draft").font(.caption2.weight(.semibold)).foregroundStyle(.orange) }
                        Text("\(pr.source) → \(pr.target)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { store.select(.pullRequest(pr.number)) }
                .contextMenu {
                    Button("브랜치 체크아웃") { Task { await store.checkoutPullRequest(pr) } }
                    Button("브라우저에서 열기") { if let u = URL(string: pr.url) { NSWorkspace.shared.open(u) } }
                    Button("링크 복사") { store.copy(pr.url) }
                }
            }
        } header: {
            HStack {
                Text(store.prState == .loaded ? "\(target.provider.requestsTitle) \(store.pullRequests.count)" : target.provider.requestsTitle)
                Spacer()
                let candidates = AccountStore.shared.candidates(for: target)
                if let current = store.hostingAccount {
                    Menu {
                        ForEach(candidates) { a in
                            Button {
                                store.useAccount(a)
                            } label: {
                                if a.id == current.id { Label("@\(a.username)", systemImage: "checkmark") } else { Text("@\(a.username)") }
                            }
                        }
                        Divider()
                        Button("계정 추가…") { openSettings() }
                    } label: {
                        Text("@\(current.username)").font(.caption)
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .help(candidates.count > 1 ? "이 저장소에 쓸 계정 고르기" : "이 저장소에 쓰는 계정")
                }
                Button { Task { await store.loadPullRequests() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless)
                    .help("목록 새로 고침")
                Button { store.sheet = .createPullRequest } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .disabled(store.headBranch == nil)
                    .help("현재 브랜치로 새 \(target.provider.requestShort)")
            }
        }
    }
}
