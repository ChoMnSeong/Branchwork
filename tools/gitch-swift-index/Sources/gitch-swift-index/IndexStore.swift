import Darwin

/// indexstore_string_ref_t { const char *data; size_t length } — 헤더 없이 부르므로 모양이 같은 iovec 으로 받는다.
/// 둘 다 포인터 + size_t 인 16바이트 구조체라 arm64 · x86_64 모두 정수 레지스터 두 개로 오간다.
typealias StringRef = iovec

extension StringRef {
    var string: String {
        guard let base = iov_base, iov_len > 0 else { return "" }
        return String(decoding: UnsafeRawBufferPointer(start: base, count: iov_len), as: UTF8.self)
    }
}

/// indexstore.h 의 값 중 이 도우미가 쓰는 것
enum IndexStoreConst {
    static let dependencyRecord: UInt32 = 2
    static let langSwift: UInt32 = 100
    static let kindModule: UInt32 = 1
    static let kindExtension: UInt32 = 9
    static let kindParameter: UInt32 = 25
    static let propertyLocal: UInt64 = 1 << 7
    static let roleDeclaration: UInt64 = 1 << 0
    static let roleDefinition: UInt64 = 1 << 1
    static let roleReference: UInt64 = 1 << 2
    static let roleChildOf: UInt64 = 1 << 9
    static let roleExtendedBy: UInt64 = 1 << 14
}

/// Xcode · Command Line Tools 의 libIndexStore.dylib(C API, indexstore.h)를 dlopen 해서 부른다.
/// 앱 번들에 넣는 실행 파일이라 툴체인에 링크하지 않는다 — 툴체인이 없는 맥에서도 뜨고, 못 찾으면 까닭을 알린다.
struct IndexStoreLib {
    typealias Handle = OpaquePointer
    typealias Visit = @convention(c) (UnsafeMutableRawPointer?, Handle?) -> Bool
    typealias VisitName = @convention(c) (UnsafeMutableRawPointer?, StringRef) -> Bool

    let path: String
    let errorDescription: @convention(c) (Handle?) -> UnsafePointer<CChar>?
    let errorDispose: @convention(c) (Handle?) -> Void
    let storeCreate: @convention(c) (UnsafePointer<CChar>, UnsafeMutablePointer<Handle?>?) -> Handle?
    let storeDispose: @convention(c) (Handle?) -> Void
    let unitsApply: @convention(c) (Handle?, UInt32, UnsafeMutableRawPointer?, VisitName) -> Bool
    let unitReaderCreate: @convention(c) (Handle?, UnsafePointer<CChar>, UnsafeMutablePointer<Handle?>?) -> Handle?
    let unitReaderDispose: @convention(c) (Handle?) -> Void
    let unitModificationTime: @convention(c) (Handle?, UnsafeMutablePointer<Int64>, UnsafeMutablePointer<Int64>) -> Void
    let unitIsSystem: @convention(c) (Handle?) -> Bool
    let unitHasMainFile: @convention(c) (Handle?) -> Bool
    let unitMainFile: @convention(c) (Handle?) -> StringRef
    let unitWorkingDir: @convention(c) (Handle?) -> StringRef
    let unitDependenciesApply: @convention(c) (Handle?, UnsafeMutableRawPointer?, Visit) -> Bool
    let dependencyKind: @convention(c) (Handle?) -> UInt32
    let dependencyFilePath: @convention(c) (Handle?) -> StringRef
    let dependencyName: @convention(c) (Handle?) -> StringRef
    let recordReaderCreate: @convention(c) (Handle?, UnsafePointer<CChar>, UnsafeMutablePointer<Handle?>?) -> Handle?
    let recordReaderDispose: @convention(c) (Handle?) -> Void
    let recordSymbolsApply: @convention(c) (Handle?, Bool, UnsafeMutableRawPointer?, Visit) -> Bool
    let recordOccurrencesApply: @convention(c) (Handle?, UnsafeMutableRawPointer?, Visit) -> Bool
    let occurrenceSymbol: @convention(c) (Handle?) -> Handle?
    let occurrenceRoles: @convention(c) (Handle?) -> UInt64
    let occurrenceRelationsApply: @convention(c) (Handle?, UnsafeMutableRawPointer?, Visit) -> Bool
    let relationRoles: @convention(c) (Handle?) -> UInt64
    let relationSymbol: @convention(c) (Handle?) -> Handle?
    let symbolKind: @convention(c) (Handle?) -> UInt32
    let symbolLanguage: @convention(c) (Handle?) -> UInt32
    let symbolProperties: @convention(c) (Handle?) -> UInt64
    let symbolRoles: @convention(c) (Handle?) -> UInt64
    let symbolName: @convention(c) (Handle?) -> StringRef
    let symbolUSR: @convention(c) (Handle?) -> StringRef

    /// 찾는 순서: DEVELOPER_DIR → xcode-select 로 고른 것 → Xcode.app → Command Line Tools
    static var candidates: [String] {
        var dirs: [String] = []
        if let d = getenv("DEVELOPER_DIR").map({ String(cString: $0) }), !d.isEmpty { dirs.append(d) }
        var buf = [CChar](repeating: 0, count: Int(PATH_MAX))
        let n = readlink("/var/db/xcode_select_link", &buf, buf.count - 1)
        if n > 0 { dirs.append(String(decoding: buf[0..<n].map { UInt8(bitPattern: $0) }, as: UTF8.self)) }
        dirs += ["/Applications/Xcode.app/Contents/Developer", "/Library/Developer/CommandLineTools"]
        var seen = Set<String>()
        return dirs.flatMap { d in
            ["\(d)/Toolchains/XcodeDefault.xctoolchain/usr/lib/libIndexStore.dylib", "\(d)/usr/lib/libIndexStore.dylib"]
        }.filter { seen.insert($0).inserted }
    }

    static func load() throws -> IndexStoreLib {
        guard let path = candidates.first(where: { access($0, R_OK) == 0 }) else {
            throw Failure(message: "libIndexStore.dylib 를 찾지 못했습니다 — Xcode 나 Command Line Tools 가 필요합니다(xcode-select --install).")
        }
        guard let h = dlopen(path, RTLD_NOW | RTLD_LOCAL) else {
            throw Failure(message: "\(path) 를 열지 못했습니다: \(dlerror().map { String(cString: $0) } ?? "")")
        }
        func fn<T>(_ name: String) throws -> T {
            guard let p = dlsym(h, name) else {
                throw Failure(message: "\(path) 에 \(name) 가 없습니다 — 더 새 Xcode 가 필요합니다.")
            }
            return unsafeBitCast(p, to: T.self)
        }
        return try IndexStoreLib(
            path: path,
            errorDescription: fn("indexstore_error_get_description"),
            errorDispose: fn("indexstore_error_dispose"),
            storeCreate: fn("indexstore_store_create"),
            storeDispose: fn("indexstore_store_dispose"),
            unitsApply: fn("indexstore_store_units_apply_f"),
            unitReaderCreate: fn("indexstore_unit_reader_create"),
            unitReaderDispose: fn("indexstore_unit_reader_dispose"),
            unitModificationTime: fn("indexstore_unit_reader_get_modification_time"),
            unitIsSystem: fn("indexstore_unit_reader_is_system_unit"),
            unitHasMainFile: fn("indexstore_unit_reader_has_main_file"),
            unitMainFile: fn("indexstore_unit_reader_get_main_file"),
            unitWorkingDir: fn("indexstore_unit_reader_get_working_dir"),
            unitDependenciesApply: fn("indexstore_unit_reader_dependencies_apply_f"),
            dependencyKind: fn("indexstore_unit_dependency_get_kind"),
            dependencyFilePath: fn("indexstore_unit_dependency_get_filepath"),
            dependencyName: fn("indexstore_unit_dependency_get_name"),
            recordReaderCreate: fn("indexstore_record_reader_create"),
            recordReaderDispose: fn("indexstore_record_reader_dispose"),
            recordSymbolsApply: fn("indexstore_record_reader_symbols_apply_f"),
            recordOccurrencesApply: fn("indexstore_record_reader_occurrences_apply_f"),
            occurrenceSymbol: fn("indexstore_occurrence_get_symbol"),
            occurrenceRoles: fn("indexstore_occurrence_get_roles"),
            occurrenceRelationsApply: fn("indexstore_occurrence_relations_apply_f"),
            relationRoles: fn("indexstore_symbol_relation_get_roles"),
            relationSymbol: fn("indexstore_symbol_relation_get_symbol"),
            symbolKind: fn("indexstore_symbol_get_kind"),
            symbolLanguage: fn("indexstore_symbol_get_language"),
            symbolProperties: fn("indexstore_symbol_get_properties"),
            symbolRoles: fn("indexstore_symbol_get_roles"),
            symbolName: fn("indexstore_symbol_get_name"),
            symbolUSR: fn("indexstore_symbol_get_usr"))
    }

    private func check<T>(_ value: T?, _ error: Handle?, _ what: String) throws -> T {
        if let value { return value }
        let detail = error.flatMap { errorDescription($0) }.map { String(cString: $0) } ?? "알 수 없는 오류"
        if error != nil { errorDispose(error) }
        throw Failure(message: "\(what): \(detail)")
    }

    func openStore(_ path: String) throws -> Handle {
        var error: Handle?
        let store = storeCreate(path, &error)
        return try check(store, error, "인덱스를 열지 못했습니다(\(path))")
    }

    func openUnit(_ store: Handle, _ name: String) throws -> Handle {
        var error: Handle?
        let unit = unitReaderCreate(store, name, &error)
        return try check(unit, error, "인덱스 단위 \(name) 를 읽지 못했습니다")
    }

    func openRecord(_ store: Handle, _ name: String) throws -> Handle {
        var error: Handle?
        let record = recordReaderCreate(store, name, &error)
        return try check(record, error, "인덱스 기록 \(name) 을 읽지 못했습니다")
    }

    /// 유닛 이름마다 body — C 콜백은 값을 품지 못하므로 클로저를 context 포인터로 넘긴다
    func forEachUnit(_ store: Handle, _ body: (String) -> Void) {
        withoutActuallyEscaping(body) { body in
            let box = NameVisitor(body)
            withExtendedLifetime(box) {
                _ = unitsApply(store, 0, Unmanaged.passUnretained(box).toOpaque()) { ctx, name in
                    Unmanaged<NameVisitor>.fromOpaque(ctx!).takeUnretainedValue().body(name.string)
                    return true
                }
            }
        }
    }

    func forEachDependency(_ unit: Handle, _ body: (Handle) -> Void) {
        visit(body) { unitDependenciesApply(unit, $0, Self.trampoline) }
    }

    /// nocache = false: 기록의 심볼을 읽은 채로 두어, 이어지는 occurrence 순회가 같은 심볼을 다시 풀지 않게
    func forEachSymbol(_ record: Handle, _ body: (Handle) -> Void) {
        visit(body) { recordSymbolsApply(record, false, $0, Self.trampoline) }
    }

    func forEachOccurrence(_ record: Handle, _ body: (Handle) -> Void) {
        visit(body) { recordOccurrencesApply(record, $0, Self.trampoline) }
    }

    func forEachRelation(_ occurrence: Handle, _ body: (Handle) -> Void) {
        visit(body) { occurrenceRelationsApply(occurrence, $0, Self.trampoline) }
    }

    private static let trampoline: Visit = { ctx, item in
        if let item { Unmanaged<Visitor>.fromOpaque(ctx!).takeUnretainedValue().body(item) }
        return true
    }

    private func visit(_ body: (Handle) -> Void, _ apply: (UnsafeMutableRawPointer) -> Bool) {
        withoutActuallyEscaping(body) { body in
            let box = Visitor(body)
            withExtendedLifetime(box) { _ = apply(Unmanaged.passUnretained(box).toOpaque()) }
        }
    }

    private final class Visitor {
        let body: (Handle) -> Void
        init(_ body: @escaping (Handle) -> Void) { self.body = body }
    }

    private final class NameVisitor {
        let body: (String) -> Void
        init(_ body: @escaping (String) -> Void) { self.body = body }
    }
}
