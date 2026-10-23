import SwiftUI
import AppKit

/// 화면: 언어, 테마(시스템·라이트·다크), 앱 아이콘
struct AppearanceSettings: View {
    @AppStorage(AppTheme.key) private var theme = AppTheme.system.rawValue
    @AppStorage(AppLanguage.key) private var language = AppLanguage.defaultCode
    @AppStorage(AppIcon.key) private var appIcon = AppIcon.standard.rawValue
    @ViewState private var askRestart = false
    /// 앱 폴더에 쓸 수 없어 Finder 아이콘을 못 바꿨는지
    @ViewState private var iconBlocked = false

    var body: some View {
        Form {
            Section("Language") {
                Picker("Language", selection: $language) {
                    Text("Follow system language").tag("system")
                    Divider()
                    ForEach(AppLanguage.options) { Text(verbatim: $0.name).tag($0.code) }
                }
                Text("Branchwork restarts to apply the change. When there's no commit history to follow, the AI also writes in this language.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Theme") {
                Picker("Theme", selection: $theme) {
                    ForEach(AppTheme.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .pickerStyle(.segmented)
                Text("System follows your macOS setting (light, dark or auto). The graph and terminal change with it.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("App icon") {
                HStack(spacing: 14) {
                    ForEach(AppIcon.allCases) { icon in iconButton(icon) }
                }
                Text("Changes the icon in the Dock, Finder and Launchpad. New icons come with updates.")
                    .font(.caption).foregroundStyle(.secondary)
                if iconBlocked {
                    Text("Couldn't change the icon in Finder because Branchwork's folder isn't writable. The Dock icon still changes while Branchwork is running.")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: theme) { _, value in AppTheme.apply(AppTheme(rawValue: value) ?? .system) }
        .onChange(of: language) { _, value in
            AppLanguage.select(value)
            askRestart = true
        }
        .alert("Restart now?", isPresented: $askRestart) {
            Button("Later", role: .cancel) {}
            Button("Restart now") { AppLanguage.relaunch() }
        } message: {
            Text("The language changes when Branchwork restarts.")
        }
    }

    private func iconButton(_ icon: AppIcon) -> some View {
        let selected = appIcon == icon.rawValue
        return Button { iconBlocked = !AppIcon.select(icon) } label: {
            VStack(spacing: 4) {
                Group {
                    if let image = icon.image { Image(nsImage: image).resizable().interpolation(.high) } else { Color.clear }
                }
                .frame(width: 64, height: 64)
                .padding(4)
                .background(RoundedRectangle(cornerRadius: 16).fill(selected ? Color.accentColor.opacity(0.15) : .clear))
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? Color.accentColor : .clear, lineWidth: 2))
                Text(icon.title).font(.caption)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(icon.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
