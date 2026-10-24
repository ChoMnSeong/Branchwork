import SwiftUI

/// 설정 > CLI: 앱에 든 셸 명령(gitch) 설치·계정
struct CLISettings: View {
    var body: some View {
        Form {
            GitchSection()
        }
        .formStyle(.grouped)
    }
}
