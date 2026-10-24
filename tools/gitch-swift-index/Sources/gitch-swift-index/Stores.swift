import Foundation

/// 이 저장소를 빌드할 때 생긴 인덱스 폴더(indexstore_store_create 에 넘기는 곳)
enum Stores {
    /// Xcode 의 DerivedData 폴더들: 기본 위치와 Xcode 설정의 사용자 위치(Locations › Derived Data)
    static func derivedDataRoots(repo: Repository) -> [String] {
        let home = ProcessInfo.processInfo.environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
        var roots = ["\(home)/Library/Developer/Xcode/DerivedData"]
        if let custom = CFPreferencesCopyAppValue("IDECustomDerivedDataLocation" as CFString, "com.apple.dt.Xcode" as CFString) as? String,
           !custom.isEmpty {
            // 「Relative」면 워크스페이스 옆 — Tuist 처럼 워크스페이스가 저장소 뿌리에 있는 경우를 본다
            roots.insert(custom.hasPrefix("/") ? custom : "\(repo.root)/\(custom)", at: 0)
        }
        return roots
    }

    /// 찾는 곳:
    /// - Xcode: DerivedData/<이름-해시>/info.plist 의 WorkspacePath 가 이 저장소 안이면 그 폴더의 Index.noindex/DataStore (Tuist 가 만든 워크스페이스도)
    /// - 저장소 바로 아래에 둔 DerivedData(xcodebuild -derivedDataPath)
    /// - SwiftPM: 추적하는 Package.swift 옆 .build/<triple>/<debug|release>/index/store (SourceKit-LSP 는 .build/index-build 아래)
    static func find(repo: Repository, derivedData: [String]) -> [String] {
        var found: [String] = []
        var seen = Set<String>()
        func add(_ path: String) {
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { return }
            if seen.insert(Repository.realPath(path) ?? path).inserted { found.append(path) }
        }
        let fm = FileManager.default
        let inside = [repo.root, Repository.realPath(repo.root) ?? repo.root]
        func isInside(_ path: String) -> Bool {
            let p = (path as NSString).standardizingPath
            return inside.contains { p == $0 || p.hasPrefix($0 + "/") }
        }
        for root in derivedData {
            guard let names = try? fm.contentsOfDirectory(atPath: root) else { continue }
            for name in names.sorted() {
                let dir = "\(root)/\(name)"
                guard let plist = NSDictionary(contentsOfFile: "\(dir)/info.plist"),
                      let workspace = plist["WorkspacePath"] as? String, isInside(workspace) else { continue }
                add("\(dir)/Index.noindex/DataStore")
                add("\(dir)/Index/DataStore")
            }
        }
        for name in ((try? fm.contentsOfDirectory(atPath: repo.root)) ?? []).sorted() {
            add("\(repo.root)/\(name)/Index.noindex/DataStore")
        }
        let packages = repo.files.filter { $0 == "Package.swift" || $0.hasSuffix("/Package.swift") }
        for manifest in packages {
            let dir = (manifest as NSString).deletingLastPathComponent
            let build = dir.isEmpty ? "\(repo.root)/.build" : "\(repo.root)/\(dir)/.build"
            // swift build 는 .build, SourceKit-LSP 의 백그라운드 인덱싱은 .build/index-build
            for scratch in [build, "\(build)/index-build"] {
                for triple in ((try? fm.contentsOfDirectory(atPath: scratch)) ?? []).sorted() {
                    add("\(scratch)/\(triple)/index/store")   // .build/debug → <triple>/debug 링크
                    for config in ((try? fm.contentsOfDirectory(atPath: "\(scratch)/\(triple)")) ?? []).sorted() {
                        add("\(scratch)/\(triple)/\(config)/index/store")
                    }
                }
            }
        }
        return found
    }
}
