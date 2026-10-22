import SwiftUI
import AppKit

/// 버전과 자동 업데이트
struct UpdateSettings: View {
    private let center = UpdateCenter.shared

    var body: some View {
        @Bindable var center = center
        Form {
            Section {
                HStack(spacing: 12) {
                    Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 48, height: 48)
                    VStack(alignment: .leading) {
                        Text("Branchwork \(UpdateCenter.currentVersion)").font(.headline)
                        Text("Git 저장소를 그래프로 보고 다루는 앱 · MIT").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Link("릴리스 노트", destination: URL(string: "https://github.com/\(UpdateCenter.repo)/releases")!)
                }
            }
            Section("자동 업데이트") {
                Toggle("켤 때와 하루에 한 번 새 버전 확인", isOn: $center.autoCheck)
                HStack {
                    Button("지금 확인") { Task { await center.check(manual: true) } }
                        .disabled(center.phase == .checking || center.phase == .downloading)
                    if center.phase == .checking { ProgressView().controlSize(.small) }
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
                Text("새 버전이 있으면 알려 주고, 누르면 받아서 바꿔 넣은 뒤 다시 시작합니다. 받은 파일은 릴리스의 SHA-256 과 서명이 맞을 때만 설치됩니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var status: String {
        switch center.phase {
        case .checking: return "확인하는 중…"
        case .available: return "새 버전 \(center.latest?.version ?? "") 이(가) 있습니다"
        case .upToDate: return "최신 버전입니다"
        case .failed(let m): return "확인 실패: \(m)"
        default: return ""
        }
    }
}
