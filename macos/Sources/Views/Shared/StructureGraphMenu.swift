import SwiftUI

/// 저장소 메뉴(툴바 · 메뉴 막대)의 gitch graph 항목들 — 앱에 든 gitch 로 html 을 만들어 기본 브라우저로 연다.
/// 「Structure graph」(관계를 고름), 「Dependencies changed on this branch」(gitch graph diff), 「Check dependency rules…」(gitch graph check, 결과 창).
/// gitch 계정이 없어도 되는 기능이라, 계정을 만들어 두었을 때만 보이는 커밋 칸 위 ⋯ 메뉴가 아니라 저장소 메뉴에 둔다.
struct StructureGraphMenu: View {
    /// 메뉴 막대에서는 앞에 있는 창의 저장소(없을 수 있다)
    let store: RepoStore?

    var body: some View {
        let summary = String(localized: "Draws this repository's imports, modules, files that change together or folders with gitch graph, and opens it in your browser.")
        let diffSummary = String(localized: "Compares the dependencies in your working tree, uncommitted changes included, with where this branch split off from the default branch (gitch graph diff), and opens what changed in your browser.")
        let checkSummary = String(localized: "Checks the dependencies against the rules in .gitch/graph.rules (gitch graph check) and lists what breaks them.")
        let unavailable = Gitch.graphUnavailableReason
        if unavailable != nil || store?.url == nil {
            // 하위 메뉴에 .disabled 를 걸면 macOS 메뉴에서는 고를 수 있는 채로 빈 하위 메뉴가 열려서, 끈 항목 하나로 이유를 보인다
            Button("Structure graph") {}
                .disabled(true)
                .help(unavailable ?? summary)
            Button("Dependencies changed on this branch") {}
                .disabled(true)
                .help(unavailable ?? diffSummary)
            Button("Check dependency rules…") {}
                .disabled(true)
                .help(unavailable ?? checkSummary)
        } else {
            // 페이지는 한 번에 하나만 만든다(그동안 툴바에 진행 표시)
            let working = store?.graphJob != nil
            Menu("Structure graph") {
                ForEach(Gitch.GraphRelation.allCases) { r in
                    Button(r.title) { Task { await store?.openStructureGraph(r) } }
                        .help(r.detail)
                        .disabled(working)
                }
                Divider()
                Button("Precise file references") { Task { await store?.openStructureGraph(.files, precise: true) } }
                    .help("Uses an existing index.scip or .gitch/index.scip for symbol references. Shows the analysis coverage when no current index is available.")
                    .disabled(working)
                Button("Files affected by changes") { Task { await store?.openAffectedGraph() } }
                    .help("Shows changed files and the files that depend on them, including uncommitted changes.")
                    .disabled(working)
            }
            .help(store?.graphProgress ?? summary)
            Menu("Dependencies changed on this branch") {
                ForEach(Gitch.GraphRelation.compared) { r in
                    Button(r.title) { Task { await store?.openGraphDiff(r) } }
                        .help(r.diffDetail)
                        .disabled(working)
                }
                Divider()
                Button("Compare with…") { store?.sheet = .graphDiff }
                    .help(String(localized: "Pick a branch or tag. Gitrochi compares with where this branch split off from it."))
                    .disabled(working)
            }
            .help(store?.graphProgress ?? diffSummary)
            Button("Check dependency rules…") { store?.checkGraphRules() }
                .help(checkSummary)
        }
    }
}
