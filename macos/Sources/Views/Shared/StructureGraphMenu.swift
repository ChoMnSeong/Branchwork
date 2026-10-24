import SwiftUI

/// 저장소 메뉴(툴바 · 메뉴 막대)의 「Structure graph」: 관계를 고르면 앱에 든 gitch 로 html 을 만들어 기본 브라우저로 연다(gitch graph).
/// gitch 계정이 없어도 되는 기능이라, 계정을 만들어 두었을 때만 보이는 커밋 칸 위 ⋯ 메뉴가 아니라 저장소 메뉴에 둔다.
struct StructureGraphMenu: View {
    /// 메뉴 막대에서는 앞에 있는 창의 저장소(없을 수 있다)
    let store: RepoStore?

    var body: some View {
        let summary = String(localized: "Draws this repository's imports, modules, files that change together or folders with gitch graph, and opens it in your browser.")
        let unavailable = Gitch.graphUnavailableReason
        if unavailable != nil || store?.url == nil {
            // 하위 메뉴에 .disabled 를 걸면 macOS 메뉴에서는 고를 수 있는 채로 빈 하위 메뉴가 열려서, 끈 항목 하나로 이유를 보인다
            Button("Structure graph") {}
                .disabled(true)
                .help(unavailable ?? summary)
        } else {
            Menu("Structure graph") {
                ForEach(Gitch.GraphRelation.allCases) { r in
                    Button(r.title) { Task { await store?.openStructureGraph(r) } }
                        .help(r.detail)
                        .disabled(store?.drawingGraph != nil)
                }
            }
            .help(store?.graphProgress ?? summary)
        }
    }
}
