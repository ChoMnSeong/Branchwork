import SwiftUI
import AppKit

/// 실행 파일 위치: 자동으로 못 찾으면 직접 불러온다
struct ToolsSettings: View {
    private let tools = ToolStore.shared
    @ViewState private var error: String?
    @ViewState private var busy: ToolID?

    var body: some View {
        Form {
            Section {
                Text("사람마다 설치 위치가 달라 자동으로 못 찾으면 **불러오기**로 실행 파일을 직접 고르세요. 고른 경로는 저장되어 다음에도 그대로 씁니다.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ForEach(ToolID.allCases) { id in
                let st = tools.state(id)
                Section {
                    HStack {
                        Text(st.path ?? "—")
                            .font(.system(.callout, design: .monospaced))
                            .lineLimit(1).truncationMode(.head)
                            .textSelection(.enabled)
                        Spacer()
                        if busy == id { ProgressView().controlSize(.small) }
                        Button("불러오기…") { choose(id) }
                        if st.source == .custom {
                            Button("자동") { tools.resetToAuto(id) }
                                .help("직접 고른 경로를 지우고 다시 자동으로 찾습니다")
                        }
                        if st.source == .none, let u = id.install.flatMap(URL.init(string:)) {
                            Link("설치", destination: u)
                        }
                    }
                    if let v = st.version { Text(v).font(.caption).foregroundStyle(.secondary) }
                } header: {
                    HStack {
                        Text(id.title)
                        if id == .git { Text("필수").font(.caption2).foregroundStyle(.secondary) }
                        Spacer()
                        switch st.source {
                        case .custom: Text("직접 지정").font(.caption).foregroundStyle(Color.accentColor)
                        case .auto: Text("자동으로 찾음").font(.caption).foregroundStyle(.secondary)
                        case .none: Text("없음").font(.caption).foregroundStyle(.orange)
                        }
                    }
                } footer: {
                    Text(id.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }
        }
        .formStyle(.grouped)
    }

    private func choose(_ id: ToolID) {
        let p = NSOpenPanel()
        p.canChooseFiles = true
        p.canChooseDirectories = false
        p.allowsMultipleSelection = false
        p.treatsFilePackagesAsDirectories = true
        p.showsHiddenFiles = true
        p.prompt = "불러오기"
        p.message = "\(id.title) 실행 파일을 고르세요"
        if let cur = tools.path(id) { p.directoryURL = URL(fileURLWithPath: (cur as NSString).deletingLastPathComponent) }
        guard p.runModal() == .OK, let u = p.url else { return }
        error = nil
        busy = id
        Task {
            do { try await tools.setCustom(id, path: u.path) } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            busy = nil
        }
    }
}
