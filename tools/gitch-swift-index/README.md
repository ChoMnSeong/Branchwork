# gitch-swift-index

`gitch graph files` 가 Swift 파일 사이 의존을 짐작하지 않고 정확히 읽게 하는 도우미.
Xcode · SwiftPM 이 빌드하면서 남기는 인덱스(index-while-building)를 툴체인의 `libIndexStore.dylib`(C API `indexstore.h`)로 읽는다.
Swift 만으로 썼고 외부 의존이 없다 — 라이브러리는 실행할 때 `dlopen` 한다.

Swift 는 파일끼리 import 하지 않아서 gitch 혼자서는 다른 파일의 타입 이름을 쓰는지로 짐작한다(`"heuristic": true`).
인덱스에는 컴파일러가 푼 답, 곧 어느 파일의 어떤 선언(USR)을 썼는지가 있다.

## 어디에 있나

- 앱: `Gitrochi.app/Contents/Resources/gitch-swift-index`(gitch 바로 옆). [`macos/build.sh`](../../macos/build.sh) 가 만들어 넣는다.
- gitch 가 찾는 순서: `$GITCH_SWIFT_INDEX`(빈 값이면 끔) → gitch 와 같은 폴더(링크를 따라간 실제 위치) → `PATH`. 없으면 gitch 는 지금처럼 짐작한다.
- 앱 없이 CLI 만 설치했거나 저장소의 `tools/gitch/gitch` 를 쓰면 도우미가 없다. 쓰려면 저장소에서 `tools/gitch-swift-index/build.sh ~/bin/gitch-swift-index`(Xcode 또는 Command Line Tools 필요) — gitch 가 `PATH` 에서 찾는다.

## 약속 (gitch ↔ 도우미)

```bash
gitch-swift-index --repo <저장소 절대 경로>
```

- 표준출력: 한 줄에 한 쌍 `참조하는 파일<TAB>정의한 파일<TAB>이름,이름`. 경로는 저장소 뿌리 기준 `/` 구분이고 둘 다 추적하는(`git ls-files`) `.swift` 다. 자기 자신 쌍과 중복은 없고 `LC_ALL=C` 순서다.
- 이름: 정의한 파일에서 쓴 맨 위 선언(타입 · 전역 함수 · 전역 변수 …). 다른 파일에 있는 타입의 익스텐션이면 `타입.멤버`(예: `Square.unit`).
- 종료 코드: 0 성공 · 3 쓸 인덱스가 없음(빌드 전이거나 인덱스에 이 저장소의 파일이 없음) · 그 밖은 실패(1 읽지 못함 · 2 잘못 부름). 실패하면 표준오류 첫 줄이 까닭이다.
- 성공해도 고친 파일이 인덱스보다 새로우면 표준오류에 경고를 한 줄 낸다(`경고: 인덱스가 Swift 파일 N개보다 오래됐습니다(예: …)`).

```text
Sources/App/main.swift	Sources/Geometry/Circle.swift	Circle,totalArea(_:)
Sources/App/main.swift	Sources/Geometry/Square+Unit.swift	Square.unit
Sources/Geometry/Format.swift	Sources/Geometry/Config.swift	Config
```

## 인덱스를 찾는 곳

| | |
|---|---|
| Xcode | `~/Library/Developer/Xcode/DerivedData/*/info.plist` 의 `WorkspacePath` 가 이 저장소 안인 폴더의 `Index.noindex/DataStore`(Tuist 가 만든 워크스페이스도). Xcode 설정에서 고른 DerivedData 위치(`IDECustomDerivedDataLocation`)도 본다 |
| xcodebuild | 저장소 바로 아래 폴더의 `Index.noindex/DataStore`(`-derivedDataPath DerivedData` 등) |
| SwiftPM | 추적하는 `Package.swift` 옆 `.build/<triple>/<debug · release>/index/store`(`swift build`). SourceKit-LSP 의 백그라운드 인덱싱이 만든 `.build/index-build/…` 도 |

- 여러 개면 모두 읽는다. 파일마다 그 파일을 고친 뒤 만든 유닛의 기록만 쓰고(설정 · 플랫폼이 여럿이면 모두), 그런 유닛이 없으면 가장 새 유닛 하나를 쓰고 경고한다. 오래된 DerivedData 가 남아 있어도 지금 내용에 가까운 것만 쓰게.
- `libIndexStore.dylib`: `$DEVELOPER_DIR` → `xcode-select` 로 고른 것 → `/Applications/Xcode.app` → Command Line Tools 순서로 찾는다(Xcode 는 `Toolchains/XcodeDefault.xctoolchain/usr/lib`, Command Line Tools 는 `usr/lib`).

## 옵션

| 옵션 | |
|---|---|
| `--repo 폴더` | 저장소. 하위 폴더를 줘도 뿌리 기준 경로로 낸다. 없으면 지금 폴더 |
| `--store 폴더` | 이 인덱스만 읽는다(찾지 않음). 여러 번 줄 수 있다 |
| `--derived-data 폴더` | `~/Library/Developer/Xcode/DerivedData` 대신 볼 폴더. 여러 번 줄 수 있다 |
| `--covered 파일` | 인덱스에 든 추적 `.swift` 목록(한 줄에 하나)을 이 파일에 쓴다 |
| `--verbose` | 찾은 인덱스 · 인덱스에 든 파일 수 · 걸린 시간을 표준오류로 |

## 무엇을 잇나

- 정의(definition · declaration)한 자리로 USR → 파일 표를 만들고, 다른 파일의 참조(reference)를 쌍으로 낸다. 타입만이 아니라 함수 · 프로퍼티 · 케이스 · typealias · 익스텐션 멤버도.
- 모듈이 달라도 USR 이 같으면 잇고, 다른 모듈에 있는 같은 이름의 타입은 USR 이 달라 섞이지 않는다.
- 빼는 것: 함수 안에서만 보이는 것(로컬 · 파라미터), Swift 가 아닌 심볼(C · ObjC 헤더), 추적하지 않는 파일(생성 코드 · `.build/checkouts`), 시스템 모듈.
- 그 파일이 직접 정의한 USR 은, 다른 파일이 같은 USR 을 정의해도(플랫폼별 `#if` 사본) 잇지 않는다.
- 빠르기: 모듈 10개 · 파일 2,000개인 합성 SwiftPM 패키지(쌍 15,600개)를 0.2초에 읽는다. 참조는 기록의 심볼 표(그 기록 안 모든 자리의 역할을 합친 것)로 보고, 자리(occurrence)는 정의가 속한 곳(childOf)과 익스텐션이 늘린 타입만 본다.

## 개발 / 테스트

```bash
tools/gitch-swift-index/build.sh /tmp/gitch-swift-index      # swiftc 로 빌드(아키텍처를 여럿 주면 유니버설)
tools/gitch-swift-index/tests/run.sh                         # 예제(tests/fixture)를 swift build 해 tests/expected.tsv 와 비교(30초쯤)
swift run --package-path tools/gitch-swift-index gitch-swift-index --repo . --verbose
```

- GitHub Actions 「macOS」의 빌드 작업이 앱에 넣은 그 실행 파일로 같은 테스트를 돌린다.
- 앱 빌드는 SwiftPM 없이 `build.sh` 로 swiftc 를 바로 부른다(일부 Command Line Tools 에서 SwiftPM 이 깨져 있어서 — `macos/build.sh` 와 같은 까닭). `Package.swift` 는 고칠 때 쓰는 것이다.
- C API 는 헤더 없이 `dlsym` 한 함수를 `@convention(c)` 로 부른다. `indexstore_string_ref_t { const char *, size_t }` 는 모양이 같은 `iovec` 으로 받는다.
