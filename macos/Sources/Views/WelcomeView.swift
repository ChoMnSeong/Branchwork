import SwiftUI
import AppKit

/// 저장소를 열기 전 첫 화면: 열기·복제·새로 만들기 + 최근 저장소
struct WelcomeView: View {
    @Environment(RepoStore.self) private var store
    @ViewState private var dropping = false

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 16) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .frame(width: 112, height: 112)
                Text("Branchwork").font(.largeTitle.weight(.bold))
                Text("Git 저장소를 그래프로 보고 다루는 맥 앱")
                    .foregroundStyle(.secondary)
                VStack(spacing: 8) {
                    action("저장소 열기…", "folder", prominent: true) { store.presentOpenPanel() }
                    action("저장소 복제…", "arrow.down.circle") { store.sheet = .clone }
                    action("새 저장소 만들기…", "plus.square.on.square") { store.presentInitPanel() }
                }
                .padding(.top, 8)
                Text("폴더를 이 창에 끌어다 놓아도 열립니다")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(dropping ? Color.accentColor.opacity(0.08) : Color.clear)

            Divider()

            VStack(alignment: .leading, spacing: 0) {
                Text("최근 저장소")
                    .font(.headline)
                    .padding(16)
                if store.recents.isEmpty {
                    Text("아직 연 저장소가 없습니다")
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                    Spacer()
                } else {
                    List(store.recents, id: \.self) { u in
                        Button {
                            Task { await store.openOrReport(u) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(u.lastPathComponent).fontWeight(.medium)
                                Text((u.path as NSString).abbreviatingWithTildeInPath)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.head)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 3)
                        .contextMenu {
                            Button("Finder 에서 보기") { NSWorkspace.shared.activateFileViewerSelecting([u]) }
                            Button("목록에서 제거") { store.forgetRecent(u) }
                        }
                    }
                    .listStyle(.sidebar)
                }
            }
            .frame(width: 320)
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let u = urls.first else { return false }
            Task { await store.openOrReport(u) }
            return true
        } isTargeted: { dropping = $0 }
    }

    private func action(_ title: String, _ icon: String, prominent: Bool = false, _ run: @escaping () -> Void) -> some View {
        Group {
            if prominent {
                Button(action: run) { Label(title, systemImage: icon).frame(width: 220) }
                    .buttonStyle(.borderedProminent)
            } else {
                Button(action: run) { Label(title, systemImage: icon).frame(width: 220) }
                    .buttonStyle(.bordered)
            }
        }
        .controlSize(.large)
    }
}
