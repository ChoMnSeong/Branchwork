import AppKit

/// 앱 아이콘(설정 > 화면). 새 아이콘은 assets/app-icons/<id>.png(1024)를 넣고 여기와 Windows(shared/platform/app-icon.ts)에 한 줄씩 더한다.
enum AppIcon: String, CaseIterable, Identifiable {
    case standard = "default"
    case shadow

    static let key = "appIcon"
    /// 번들에 넣어 둔 아이콘(업데이트로 번들이 바뀌면 사라지므로 켤 때 다시 맞추려고 기억)
    private static let fileKey = "appIconFile"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: return String(localized: "Default")
        case .shadow: return String(localized: "Shadow")
        }
    }

    var image: NSImage? {
        let url = self == .standard
            ? Bundle.main.url(forResource: "AppIcon", withExtension: "icns")
            : Bundle.main.url(forResource: rawValue, withExtension: "png", subdirectory: "AppIcons")
        return url.flatMap(NSImage.init(contentsOf:))
    }

    static var current: AppIcon { AppIcon(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .standard }

    /// 고르고 바로 적용: 실행 중인 Dock 아이콘, 그리고 Finder·Launchpad·꺼져 있을 때의 Dock(앱 번들 아이콘).
    /// 앱 폴더에 쓸 수 없으면 번들 아이콘은 못 바꾸고 false.
    @MainActor @discardableResult
    static func select(_ icon: AppIcon) -> Bool {
        UserDefaults.standard.set(icon.rawValue, forKey: key)
        NSApp.applicationIconImage = icon.image
        return setBundleIcon(icon)
    }

    /// 켤 때: Dock 아이콘을 다시 걸고, 업데이트로 번들 아이콘이 사라졌거나 다르면 다시 넣는다
    @MainActor static func restore() {
        let icon = current
        if icon != .standard { NSApp.applicationIconImage = icon.image }
        let custom = FileManager.default.fileExists(atPath: Bundle.main.bundlePath + "/Icon\r")
        let applied = UserDefaults.standard.string(forKey: fileKey) ?? AppIcon.standard.rawValue
        if icon == .standard ? custom : (!custom || applied != icon.rawValue) { setBundleIcon(icon) }
    }

    /// 번들 루트에 사용자 지정 아이콘을 넣거나(기본이면 지운다). Finder 의 '정보 가져오기'로 아이콘을 바꾸는 것과 같다.
    @MainActor @discardableResult
    private static func setBundleIcon(_ icon: AppIcon) -> Bool {
        let path = Bundle.main.bundlePath
        // 다운로드 폴더에서 바로 연 앱은 읽기 전용 임시 위치에서 돈다
        guard !path.contains("/AppTranslocation/") else { return false }
        let ok = NSWorkspace.shared.setIcon(icon == .standard ? nil : icon.image, forFile: path, options: [])
        if ok { UserDefaults.standard.set(icon.rawValue, forKey: fileKey) }
        return ok
    }
}
