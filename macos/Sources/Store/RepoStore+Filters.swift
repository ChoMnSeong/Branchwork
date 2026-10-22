import Foundation

/// 그래프 거르기: 브랜치 숨기기·고정, 현재 브랜치만 보기(저장소마다 기억)
extension RepoStore {
    private static let hiddenKey = "graphHiddenRefs"
    private static let pinnedKey = "pinnedBranches"
    private static let currentOnlyKey = "graphCurrentOnly"

    func loadGraphFilters() {
        guard let path = url?.path else { return }
        let d = UserDefaults.standard
        hiddenRefs = Set((d.dictionary(forKey: Self.hiddenKey)?[path] as? [String]) ?? [])
        pinnedBranches = Set((d.dictionary(forKey: Self.pinnedKey)?[path] as? [String]) ?? [])
        graphCurrentOnly = (d.dictionary(forKey: Self.currentOnlyKey)?[path] as? Bool) ?? false
    }

    private func save(_ key: String, _ value: Any?) {
        guard let path = url?.path else { return }
        var dict = UserDefaults.standard.dictionary(forKey: key) ?? [:]
        dict[path] = value
        UserDefaults.standard.set(dict, forKey: key)
    }

    static func ref(of b: Branch) -> String { b.isRemote ? "refs/remotes/\(b.name)" : "refs/heads/\(b.name)" }

    func isHidden(_ b: Branch) -> Bool { hiddenRefs.contains(Self.ref(of: b)) }
    func isPinned(_ b: Branch) -> Bool { !b.isRemote && pinnedBranches.contains(b.name) }

    /// 브랜치를 그래프에서 숨기거나 다시 보인다. 로컬 브랜치면 같은 이름의 원격 브랜치도 함께.
    func setHidden(_ b: Branch, _ hidden: Bool) async {
        var refs = [Self.ref(of: b)]
        if !b.isRemote { refs += remoteBranches.filter { $0.shortName == b.name }.map(Self.ref(of:)) }
        if hidden { hiddenRefs.formUnion(refs) } else { hiddenRefs.subtract(refs) }
        save(Self.hiddenKey, hiddenRefs.isEmpty ? nil : hiddenRefs.sorted())
        await reload()
    }

    func showAllBranches() async {
        hiddenRefs = []
        save(Self.hiddenKey, nil)
        await reload()
    }

    func setPinned(_ b: Branch, _ pinned: Bool) {
        if pinned { pinnedBranches.insert(b.name) } else { pinnedBranches.remove(b.name) }
        save(Self.pinnedKey, pinnedBranches.isEmpty ? nil : pinnedBranches.sorted())
    }

    func setCurrentOnly(_ on: Bool) async {
        graphCurrentOnly = on
        save(Self.currentOnlyKey, on ? true : nil)
        await reload()
        if on, let h = headHash { scrollTarget = h }
    }

    /// 그래프에 그릴 커밋의 범위(git log 인자)
    var logScope: [String] {
        if graphCurrentOnly {
            var scope = ["HEAD"]
            if let up = status.upstream, remoteBranches.contains(where: { $0.name == up }) { scope.append("refs/remotes/\(up)") }
            return scope
        }
        return hiddenRefs.sorted().map { "--exclude=\($0)" } + ["--exclude=refs/stash", "--all"]
    }
}
