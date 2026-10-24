/// 인덱스의 정의 · 참조로 「참조하는 파일 → 정의한 파일」 쌍을 만든다.
/// 유닛(컴파일한 파일 하나)마다 그 파일의 기록(record)이 있고, 기록에는 심볼(USR)과 그 심볼이 나온 자리(occurrence)가 있다.
final class References {
    struct Pair {
        let source: String
        let target: String
        let names: [String]
    }

    struct Result {
        var pairs: [Pair] = []
        /// 인덱스에 든 파일
        var covered: [String] = []
        /// 인덱스를 만든 뒤 고친 파일
        var stale: [String] = []
        var units = 0
        var records = 0
        /// 읽지 못해 건너뛴 유닛 · 기록(Xcode 가 쓰는 중이면 덜 써진 것이 있다)과 그 첫 까닭
        var skipped = 0
        var firstFailure: String?
    }

    private typealias C = IndexStoreConst
    private struct Unit {
        let store: Int
        let time: Int64
    }
    private struct RecordKey: Hashable {
        let store: Int
        let name: String
    }

    private let lib: IndexStoreLib
    private let repo: Repository
    private var stores: [IndexStoreLib.Handle] = []
    private var units: [Unit] = []
    /// 파일 번호 → (유닛 번호, 기록 이름)
    private var entries: [[(unit: Int, record: String)]]
    private var covered: [Bool]
    private var pathIds: [String: Int32] = [:]
    private var skipped = 0
    private var firstFailure: String?

    // USR 번호마다
    private var usrIds: [String: Int32] = [:]
    private var names: [String] = []
    private var kinds: [UInt32] = []
    private var parents: [Int32] = []
    /// 익스텐션 → 늘린 타입
    private var extended: [Int32] = []
    /// USR → 정의한 파일들
    private var definers: [Int32: [Int32]] = [:]
    /// 파일 → 참조한 USR
    private var refs: [Set<Int32>]

    init(lib: IndexStoreLib, repo: Repository) {
        self.lib = lib
        self.repo = repo
        entries = Array(repeating: [], count: repo.files.count)
        covered = Array(repeating: false, count: repo.files.count)
        refs = Array(repeating: [], count: repo.files.count)
    }

    deinit {
        stores.forEach { lib.storeDispose($0) }
    }

    func read(stores paths: [String]) throws -> Result {
        var result = Result()
        for path in paths {
            stores.append(try lib.openStore(path))
            scanUnits(store: stores.count - 1)
        }
        result.units = units.count

        // 파일마다 쓸 기록: 그 파일을 고친 뒤 만든 유닛들(설정 · 플랫폼이 여럿이면 모두),
        // 그런 유닛이 없으면(빌드한 뒤 고침) 가장 새 유닛 하나 — 오래된 DerivedData 가 섞여도 지금 내용에 가까운 것만 쓴다
        var records: [RecordKey: [Int32]] = [:]
        for f in entries.indices where !entries[f].isEmpty {
            let fresh: [(unit: Int, record: String)]
            if let changed = repo.modificationTime(Int32(f)) {
                fresh = entries[f].filter { units[$0.unit].time >= changed }
            } else {
                fresh = entries[f]
            }
            var chosen = fresh
            if fresh.isEmpty {
                result.stale.append(repo.files[f])
                let newest = entries[f].max { units[$0.unit].time < units[$1.unit].time }!.unit
                chosen = entries[f].filter { $0.unit == newest }
            }
            for e in chosen {
                let key = RecordKey(store: units[e.unit].store, name: e.record)
                if records[key]?.last != Int32(f) { records[key, default: []].append(Int32(f)) }
            }
        }
        result.records = records.count
        for (key, files) in records { readRecord(key, files: files) }

        result.covered = covered.indices.filter { covered[$0] }.map { repo.files[$0] }
        result.pairs = pairs()
        result.skipped = skipped
        result.firstFailure = firstFailure
        return result
    }

    // MARK: - 유닛

    private func scanUnits(store: Int) {
        let handle = stores[store]
        lib.forEachUnit(handle) { name in
            let unit: IndexStoreLib.Handle
            do { unit = try lib.openUnit(handle, name) } catch { return skip(error) }
            defer { lib.unitReaderDispose(unit) }
            // SDK · 시스템 모듈은 저장소 파일을 담지 않는다(유닛 대부분이 이것)
            if lib.unitIsSystem(unit) { return }
            var sec: Int64 = 0
            var nsec: Int64 = 0
            lib.unitModificationTime(unit, &sec, &nsec)
            let index = units.count
            var used = false
            let dir = lib.unitWorkingDir(unit).string
            if lib.unitHasMainFile(unit), let f = fileId(lib.unitMainFile(unit).string, dir) {
                covered[Int(f)] = true
                used = true
            }
            lib.forEachDependency(unit) { dep in
                guard lib.dependencyKind(dep) == C.dependencyRecord,
                      let f = fileId(lib.dependencyFilePath(dep).string, dir) else { return }
                entries[Int(f)].append((index, lib.dependencyName(dep).string))
                covered[Int(f)] = true
                used = true
            }
            if used { units.append(Unit(store: store, time: sec * 1_000_000_000 + nsec)) }
        }
    }

    private func skip(_ error: Error) {
        skipped += 1
        if firstFailure == nil { firstFailure = (error as? Failure)?.message ?? "\(error)" }
    }

    private func fileId(_ path: String, _ workingDir: String) -> Int32? {
        guard !path.isEmpty else { return nil }
        if let id = pathIds[path] { return id < 0 ? nil : id }
        let absolute = path.hasPrefix("/") ? path : "\(workingDir)/\(path)"
        let id = repo.id(of: absolute)
        pathIds[path] = id ?? -1
        return id
    }

    // MARK: - 기록

    private func readRecord(_ key: RecordKey, files: [Int32]) {
        let record: IndexStoreLib.Handle
        do { record = try lib.openRecord(stores[key.store], key.name) } catch { return skip(error) }
        defer { lib.recordReaderDispose(record) }
        var defined: [Int32] = []
        var referenced: [Int32] = []
        // 심볼 표의 역할은 그 기록 안 모든 자리의 역할을 합친 것 — 참조는 자리를 하나씩 보지 않아도 된다
        lib.forEachSymbol(record) { symbol in
            let roles = lib.symbolRoles(symbol)
            let isDefinition = roles & (C.roleDefinition | C.roleDeclaration) != 0
            let isReference = roles & C.roleReference != 0
            guard isDefinition || isReference, let id = usr(symbol) else { return }
            if isDefinition {
                defined.append(id)
                if names[Int(id)].isEmpty { names[Int(id)] = lib.symbolName(symbol).string }
            }
            if isReference { referenced.append(id) }
        }
        if !defined.isEmpty {
            // 정의가 어디에 속하는지(childOf)와 익스텐션이 늘린 타입(extendedBy)은 자리의 관계에만 있다
            lib.forEachOccurrence(record) { occurrence in
                let roles = lib.occurrenceRoles(occurrence)
                let isDefinition = roles & (C.roleDefinition | C.roleDeclaration) != 0
                if isDefinition && roles & C.roleChildOf != 0 {
                    guard let child = usr(lib.occurrenceSymbol(occurrence)), parents[Int(child)] < 0 else { return }
                    lib.forEachRelation(occurrence) { relation in
                        guard parents[Int(child)] < 0, lib.relationRoles(relation) & C.roleChildOf != 0,
                              let symbol = lib.relationSymbol(relation), let parent = usr(symbol), parent != child else { return }
                        parents[Int(child)] = parent
                        if names[Int(parent)].isEmpty { names[Int(parent)] = lib.symbolName(symbol).string }
                    }
                } else if !isDefinition && roles & C.roleExtendedBy != 0 {
                    guard let type = usr(lib.occurrenceSymbol(occurrence)) else { return }
                    lib.forEachRelation(occurrence) { relation in
                        guard lib.relationRoles(relation) & C.roleExtendedBy != 0,
                              let symbol = lib.relationSymbol(relation), let ext = usr(symbol) else { return }
                        extended[Int(ext)] = type
                    }
                }
            }
        }
        for f in files {
            for id in defined where definers[id]?.contains(f) != true { definers[id, default: []].append(f) }
            refs[Int(f)].formUnion(referenced)
        }
    }

    /// 저장소 파일끼리 이어 줄 수 있는 심볼의 USR 번호 — Swift 가 아니거나(C · ObjC 헤더) 함수 안에서만 보이는 것은 뺀다
    private func usr(_ symbol: IndexStoreLib.Handle?) -> Int32? {
        guard let symbol, lib.symbolLanguage(symbol) == C.langSwift else { return nil }
        let kind = lib.symbolKind(symbol)
        guard kind != C.kindModule, kind != C.kindParameter, lib.symbolProperties(symbol) & C.propertyLocal == 0 else { return nil }
        let key = lib.symbolUSR(symbol).string
        if let id = usrIds[key] { return id }
        let id = Int32(names.count)
        usrIds[key] = id
        names.append("")
        kinds.append(kind)
        parents.append(-1)
        extended.append(-1)
        return id
    }

    // MARK: - 쌍

    private func pairs() -> [Pair] {
        var top: [Int32: (top: Int32, member: Int32)] = [:]
        func chain(_ id: Int32) -> (top: Int32, member: Int32) {
            if let known = top[id] { return known }
            var cur = id
            var below: Int32 = -1
            var depth = 0
            while parents[Int(cur)] >= 0 && depth < 64 {
                below = cur
                cur = parents[Int(cur)]
                depth += 1
            }
            top[id] = (cur, below)
            return (cur, below)
        }
        // 그 파일에서 쓴 것의 이름: 맨 위 선언(타입 · 전역 함수 …)의 이름. 다른 파일에 있는 타입의 익스텐션이면 「타입.멤버」
        func label(_ id: Int32, in target: Int32) -> String {
            let (t, member) = chain(id)
            var name = names[Int(t)]
            if kinds[Int(t)] == C.kindExtension, member >= 0 {
                let type = extended[Int(t)]
                if type < 0 || definers[type]?.contains(target) != true { name += "." + names[Int(member)] }
            }
            return Self.clean(name)
        }

        var out: [Pair] = []
        for a in refs.indices where !refs[a].isEmpty {
            let source = Int32(a)
            var targets: [Int32: Set<String>] = [:]
            for id in refs[a] {
                guard let files = definers[id], !files.contains(source) else { continue }
                for b in files { targets[b, default: []].insert(label(id, in: b)) }
            }
            for (b, labels) in targets {
                out.append(Pair(source: repo.files[a], target: repo.files[Int(b)], names: labels.sorted(by: Self.bytewise)))
            }
        }
        return out.sorted { $0.source == $1.source ? Self.bytewise($0.target, $1.target) : Self.bytewise($0.source, $1.source) }
    }

    /// LC_ALL=C sort 와 같은 순서
    static func bytewise(_ a: String, _ b: String) -> Bool {
        a.utf8.lexicographicallyPrecedes(b.utf8)
    }

    /// 출력 칸을 가르는 글자(탭 · 줄바꿈 · 쉼표)는 이름에 들어가지 않게 — `raw identifier` 는 거의 아무 글자나 된다
    static func clean(_ name: String) -> String {
        guard name.contains(where: { $0 == "\t" || $0 == "\n" || $0 == "\r" || $0 == "," }) else { return name }
        return String(name.map { $0 == "\t" || $0 == "\n" || $0 == "\r" || $0 == "," ? " " : $0 })
    }
}
