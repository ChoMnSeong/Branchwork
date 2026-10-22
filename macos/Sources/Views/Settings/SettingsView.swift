import SwiftUI
import AppKit

/// ⌘, 설정: 계정(GitHub·GitLab), AI, 규칙, 도구(실행 파일 위치), 화면(테마), 업데이트
struct SettingsView: View {
    var body: some View {
        TabView {
            AccountsSettings()
                .tabItem { Label("계정", systemImage: "person.crop.circle") }
            AISettings()
                .tabItem { Label("AI", systemImage: "sparkles") }
            RulesSettings()
                .tabItem { Label("규칙", systemImage: "text.badge.checkmark") }
            ToolsSettings()
                .tabItem { Label("도구", systemImage: "wrench.and.screwdriver") }
            AppearanceSettings()
                .tabItem { Label("화면", systemImage: "paintpalette") }
            UpdateSettings()
                .tabItem { Label("업데이트", systemImage: "arrow.down.circle") }
        }
        .frame(width: 600, height: 560)
    }
}
