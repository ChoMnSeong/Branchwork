import SwiftUI

/// 화면: 테마(시스템·라이트·다크)
struct AppearanceSettings: View {
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue

    var body: some View {
        Form {
            Section("테마") {
                Picker("테마", selection: $theme) {
                    ForEach(AppTheme.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .pickerStyle(.segmented)
                Text("시스템은 macOS 설정(라이트·다크·자동)을 따릅니다. 그래프·터미널까지 함께 바뀝니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onChange(of: theme) { _, value in AppTheme.apply(AppTheme(rawValue: value) ?? .system) }
    }
}
