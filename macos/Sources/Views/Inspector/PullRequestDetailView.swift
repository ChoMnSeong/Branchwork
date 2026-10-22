import SwiftUI
import AppKit

struct PullRequestDetailView: View {
    @Environment(RepoStore.self) private var store
    let number: Int

    var body: some View {
        if let pr = store.pullRequests.first(where: { $0.number == number }), let t = store.target {
            VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.pull").foregroundStyle(.secondary)
                Text("\(t.provider.requestShort) #\(pr.number)").font(.headline)
                if pr.isDraft {
                    Text("Draft").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(Color.orange.opacity(0.2)))
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(pr.title).font(.title3.weight(.semibold)).textSelection(.enabled)

                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 6) {
                        GridRow { Text("작성자").foregroundStyle(.secondary); Text("@\(pr.author)") }
                        GridRow {
                            Text("브랜치").foregroundStyle(.secondary)
                            Text("\(pr.source) → \(pr.target)\(pr.fromFork ? "  (포크)" : "")")
                        }
                        if let d = pr.updated {
                            GridRow { Text("업데이트").foregroundStyle(.secondary); Text(Fmt.long(d)) }
                        }
                    }
                    .font(.callout)

                    HStack {
                        Button { Task { await store.checkoutPullRequest(pr) } } label: {
                            Label("브랜치 체크아웃", systemImage: "arrow.down.to.line")
                        }
                        .buttonStyle(.borderedProminent)
                        Button { if let u = URL(string: pr.url) { NSWorkspace.shared.open(u) } } label: {
                            Label("브라우저", systemImage: "safari")
                        }
                        if let sha = pr.headSHA, store.commitIndex[sha] != nil {
                            Button { store.reveal(sha) } label: { Label("그래프에서 보기", systemImage: "point.3.connected.trianglepath.dotted") }
                        }
                    }

                    Divider()

                    if pr.body.trimmed.isEmpty {
                        Text("설명 없음").foregroundStyle(.secondary)
                    } else {
                        Text(markdown(pr.body)).textSelection(.enabled)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(number)
            }
        } else {
            ContentUnavailableView("목록에 없는 \(store.target?.provider.requestShort ?? "PR")", systemImage: "arrow.triangle.pull",
                                   description: Text("닫혔거나 아직 불러오지 않았습니다."))
        }
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}
