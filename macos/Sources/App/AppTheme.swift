import AppKit

/// 화면 테마: macOS 설정을 따르거나 라이트·다크로 고정(설정 > 화면)
enum AppTheme: String, CaseIterable, Identifiable {
    case system, light, dark

    static let key = "appTheme"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: return "시스템"
        case .light: return "라이트"
        case .dark: return "다크"
        }
    }

    static var current: AppTheme { AppTheme(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .system }

    /// 앱 전체(모든 창·터미널)에 적용. 시스템이면 macOS 설정을 따른다.
    @MainActor static func apply(_ theme: AppTheme = current) {
        switch theme {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }
}
