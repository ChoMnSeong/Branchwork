// gitch-swift-index — Xcode · SwiftPM 인덱스(libIndexStore)에서 Swift 파일 사이 참조를 읽어 gitch graph files 에 넘긴다.
// Swift 는 파일끼리 import 하지 않아서 gitch 혼자서는 타입 이름으로 짐작하는데, 빌드가 남긴 인덱스에는 컴파일러가 푼 정확한 답이 있다.
//   gitch-swift-index --repo <저장소> [--store <인덱스 폴더>]... [--derived-data <폴더>]... [--covered <파일>] [--verbose]
// 표준출력: 한 줄에 한 쌍 「참조하는 파일<TAB>정의한 파일<TAB>이름,이름」 — 저장소 뿌리 기준 / 경로, 둘 다 추적하는 .swift
// 종료 코드: 0 성공 · 3 쓸 인덱스가 없음(빌드 전 등) · 그 밖은 실패 — 표준오류 첫 줄이 까닭(gitch 가 notes 에 적는다)
import Foundation

let version = "1.0.0"

/// 사용자에게 보일 까닭이 든 실패
struct Failure: Error {
    let message: String
}

func say(_ message: String) {
    FileHandle.standardError.write(Data("gitch-swift-index: \(message)\n".utf8))
}

func fail(_ code: Int32, _ message: String) -> Never {
    say(message)
    exit(code)
}

let usage = """
    사용법: gitch-swift-index --repo <저장소> [--store <인덱스 폴더>]... [--derived-data <폴더>]... [--covered <파일>] [--verbose]
      --repo          저장소(하위 폴더여도 뿌리 기준으로 낸다). 없으면 지금 폴더
      --store         이 인덱스 폴더만 읽는다(찾지 않음). 여러 번 줄 수 있다
      --derived-data  DerivedData 대신 볼 폴더. 여러 번 줄 수 있다
      --covered       인덱스에 든 Swift 파일 목록을 이 파일에 쓴다(한 줄에 하나)
      --verbose       찾은 인덱스 · 걸린 시간을 표준오류로
    표준출력: 참조하는 파일<TAB>정의한 파일<TAB>이름,이름
    종료 코드: 0 성공 · 3 쓸 인덱스가 없음 · 그 밖은 실패
    """

var repoPath = FileManager.default.currentDirectoryPath
var storePaths: [String] = []
var derivedData: [String]?
var coveredPath: String?
var verbose = false
var args = CommandLine.arguments.dropFirst()
while let arg = args.popFirst() {
    func value() -> String {
        guard let v = args.popFirst(), !v.isEmpty else { fail(2, "\(arg) 뒤에 값이 필요합니다.\n\(usage)") }
        return v
    }
    switch arg {
    case "--repo": repoPath = value()
    case "--store": storePaths.append(value())
    case "--derived-data": derivedData = (derivedData ?? []) + [value()]
    case "--covered": coveredPath = value()
    case "--verbose", "-v": verbose = true
    case "--version": print("gitch-swift-index \(version)"); exit(0)
    case "--help", "-h": print(usage); exit(0)
    default: fail(2, "모르는 옵션: \(arg)\n\(usage)")
    }
}

let started = DispatchTime.now()
func elapsed() -> String {
    String(format: "%.2f초", Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e9)
}

let repo: Repository
do { repo = try Repository(path: repoPath) } catch { fail(1, (error as? Failure)?.message ?? "\(error)") }
if repo.files.isEmpty { exit(0) }

let stores = storePaths.isEmpty ? Stores.find(repo: repo, derivedData: derivedData ?? Stores.derivedDataRoots(repo: repo)) : storePaths
if stores.isEmpty {
    fail(3, "이 저장소를 빌드한 인덱스가 없습니다 — Xcode 나 swift build 로 한 번 빌드하면 생깁니다.")
}
if verbose { stores.forEach { say("인덱스: \($0)") } }

let lib: IndexStoreLib
do { lib = try IndexStoreLib.load() } catch { fail(1, (error as? Failure)?.message ?? "\(error)") }
if verbose { say("libIndexStore: \(lib.path)") }

let result: References.Result
do {
    result = try References(lib: lib, repo: repo).read(stores: stores)
} catch {
    fail(1, (error as? Failure)?.message ?? "\(error)")
}
if result.covered.isEmpty {
    // 하나도 읽지 못했으면 인덱스가 없는 것이 아니라 읽기 실패(형식이 다른 툴체인 등)
    if let failure = result.firstFailure { fail(1, failure) }
    fail(3, "인덱스에 이 저장소의 Swift 파일이 없습니다 — 빌드한 뒤 다시 해 보세요.")
}

var out = ""
out.reserveCapacity(result.pairs.count * 96)
for p in result.pairs {
    out += "\(p.source)\t\(p.target)\t\(p.names.joined(separator: ","))\n"
}
FileHandle.standardOutput.write(Data(out.utf8))

if let coveredPath {
    let text = result.covered.map { $0 + "\n" }.joined()
    do { try Data(text.utf8).write(to: URL(fileURLWithPath: coveredPath)) } catch {
        fail(1, "\(coveredPath) 에 쓰지 못했습니다: \(error.localizedDescription)")
    }
}

// gitch 는 표준오류 첫 줄만 notes 에 적는다 — 자주 나오고 할 일이 분명한 오래된 인덱스 경고를 먼저
if !result.stale.isEmpty {
    say("경고: 인덱스가 Swift 파일 \(result.stale.count)개보다 오래됐습니다(예: \(result.stale[0])) — 다시 빌드하면 맞춰집니다.")
}
if result.skipped > 0, let failure = result.firstFailure {
    say("경고: 인덱스 \(result.skipped)곳을 읽지 못해 건너뛰었습니다(\(failure)).")
}
if verbose {
    let missing = repo.files.count - result.covered.count
    say("Swift 파일 \(repo.files.count)개 중 \(result.covered.count)개가 인덱스에 있음\(missing > 0 ? "(없는 것 \(missing)개)" : "") · 유닛 \(result.units) · 기록 \(result.records) · 쌍 \(result.pairs.count) · \(elapsed())")
}
