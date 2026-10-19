import SwiftUI

extension View {
    /// 마우스를 올리면 설명을 보여 준다: 이름 · 하는 일 · 단축키.
    /// macOS 툴바 버튼은 시스템이 다시 그려 onHover 가 닿지 않으므로 기본 툴팁(.help)을 쓰고,
    /// 뜨는 시간은 앱 시작 때 NSInitialToolTipDelay 로 짧게(0.35초) 맞춘다.
    func hoverTip(_ title: String, _ detail: String, shortcut: String? = nil) -> some View {
        help(title + (shortcut.map { "  (\($0))" } ?? "") + "\n" + detail)
    }
}
