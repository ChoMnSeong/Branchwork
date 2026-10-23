# 기여 안내

Branchwork 에 관심 가져 주셔서 고맙습니다. 버그 제보·기능 요청은 [이슈](https://github.com/ChoMnSeong/Branchwork/issues/new/choose)로, 코드는 PR 로 보내 주세요.

> **English** — Issues and PRs are welcome in English too. UI text in the code is English (translated into 20 languages); code comments are in Korean. Please follow the conventions below.

## 시작하기

| | 맥 | Windows |
|---|---|---|
| 위치 | `macos/` (SwiftUI, macOS 15+) | `windows/` (Tauri 2: Rust + React/TypeScript) |
| 필요 | Swift 6 이상(Xcode 또는 Command Line Tools) | Node.js 22, Rust stable |
| 빌드 | `macos/build.sh` | `cd windows && npm ci && npx tauri build` |
| 확인 | 빌드 오류·경고 없이 | `npx tsc --noEmit -p .` · `npx vitest run` · `cargo check` |

- 맥은 SwiftPM 없이 `swiftc` 로 바로 빌드합니다. 새 파일은 `macos/Sources/` 아래 알맞은 폴더에 두면 자동으로 포함됩니다.
- Windows 는 맥에서도 `npx tauri dev` 로 띄워 볼 수 있습니다(데이터 폴더는 `Branchwork (Tauri)` 로 분리).
- 화면을 바꿨다면 [데모 저장소](docs/make-demo-repo.sh)(`docs/make-demo-repo.sh <폴더>`)로 확인하고 스크린샷을 PR 에 붙여 주세요.

## 구조

```
macos/Sources/
  App/       앱·창·탭·업데이트·테마
  Core/      git 실행(Git.swift), 출력 해석(Parsers), 그래프 배치(Graph), 모델, 파일 감시
  Store/     RepoStore(탭 하나의 상태) + 기능별 확장 RepoStore+Actions·+Selection·+CI …
  Services/  GitHub·GitLab(Hosting), CI/CD, AI, 계정, 에이전트, 도구, 프로필 사진, 터미널 세션
  Views/     Graph · Sidebar · Inspector · Settings · Sheets · Shared
windows/src/
  lib/       상태·로직. lib/repo/ 는 RepoStore 를 기능별 단계 클래스로 나눈 것(core → … → terminal)
  components/ graph · sidebar · inspector · settings · sheets · shared
windows/src-tauri/src/  프로세스 실행·pty·파일 감시·HTTP·자격 증명(Rust)
```

## 규칙

### 두 플랫폼은 같이

- **기능은 맥과 Windows 에 함께** 넣습니다. 한쪽만 되는 기능이면 PR 에 이유를 적어 주세요.
- 이름과 나누는 방식을 맞춥니다: 맥 `RepoStore+CI.swift` ↔ Windows `lib/ci/store.ts`, `Views/Sheets/X.swift` ↔ `components/sheets/X.tsx`. 한쪽 코드를 읽으면 다른 쪽을 찾을 수 있게.
- git 동작은 새로 만들지 않고 **시스템 `git` 을 호출**합니다(맥 `Git.run`, Windows `git()` / `this.g()`). 출력은 기계용 형식(`--porcelain=v2 -z`, `--format=…%x1f…`)으로 받아 `Parsers` 로 해석합니다.

### 코드

- **들여쓰기**: Swift · Rust 4칸, TypeScript · JSON · CSS · YAML 2칸. LF, 파일 끝 줄바꿈([`.editorconfig`](.editorconfig)).
- **Swift**
  - 상태는 `@MainActor @Observable final class`, 화면 상태는 `@State` 대신 `@ViewState`(일부 Command Line Tools 에서 매크로가 깨져서 쓰는 별칭).
  - 무거운 일(그래프 배치 등)은 `Task.detached` 로 메인 스레드 밖에서.
  - `private` 이 기본. 다른 파일의 확장에서 써야 할 때만 넓힙니다.
- **TypeScript**
  - `strict` · 쓰지 않는 변수·import 금지(`tsc` 가 막습니다). `any` 대신 정확한 타입.
  - 상태는 `Observable` 을 상속한 클래스 + 바뀐 뒤 `this.emit()`, 화면은 `useObserve(store)`.
  - 백엔드 호출은 `lib/ipc.ts` 를 거칩니다. 컴포넌트에서 `invoke` 를 바로 부르지 않습니다.
  - 큰따옴표, 세미콜론, 화살표 함수 위주. 한 파일이 400줄을 넘으면 나눌 때가 됐다는 신호입니다.
- **Rust**: `cargo fmt`. Windows 에서 띄우는 프로세스는 콘솔 창이 뜨지 않게(`CREATE_NO_WINDOW`).
- **주석**: 한국어로, **왜** 그렇게 하는지를 씁니다. 무엇을 하는지는 코드가 말하게. 공개 타입·함수는 `///`(Swift) · `/** */`(TS) 한 줄 설명.
- **성능**: 파일 감시로 불리는 코드는 큰 저장소(커밋 수만 개)를 생각합니다. 같은 값을 다시 넣어 화면을 다시 그리게 하지 않고, git 프로세스 수를 줄입니다. 맥은 `BRANCHWORK_TRACE=1` 로 새로 고침 시간을 볼 수 있습니다.

### 화면과 글

- **화면 글은 코드에 영어로** 쓰고, 그 영어가 번역의 키입니다. 짧고 문장형 대소문자(sentence case), 메뉴·버튼은 동사형(「Stage」, 「Create branch…」).
  - 맥: SwiftUI 의 `Text("…")`·`Button("…")` 등은 그대로 번역되고, 그 밖의 글자(오류 메시지 등)는 `String(localized: "…")`.
  - Windows: `t("…")`, 값은 `t("Commit {0} files", n)` 처럼 `{0}`·`{1}`.
  - 번역: 맥 `macos/Resources/Localizations/<언어>.lproj/Localizable.strings`, Windows `windows/src/locales/<언어>.json`. 새 글자를 넣었으면 같은 PR 에서 한국어(`ko`)는 꼭, 다른 언어는 할 수 있는 만큼 채워 주세요(없으면 영어로 보입니다).
  - 기본 화면 언어는 영어이고, 설정 > 화면에서 바꿉니다.
- **아이콘 버튼의 뜻은 글자 대신 마우스를 올렸을 때**(맥 `.help(…)`, Windows `tip=` / `data-tip`) 보여 줍니다.
- 되돌리기 어려운 동작(삭제·강제 Push·Reset hard·배포 실행·세션 종료)은 확인을 한 번 받습니다.
- 라이트·다크 두 테마에서 모두 확인합니다. 색은 맥 시스템 색 / Windows CSS 변수(`--text`, `--accent` …)만 씁니다.
- 맥은 VoiceOver 로 읽히고 눌리게(`accessibilityElement` · `accessibilityAction`).

### 개인정보 · 보안

- **토큰은 키체인(맥) · 자격 증명 관리자(Windows)에만.** 설정 파일·로그·오류 메시지에 남기지 않습니다.
- 코드·테스트·스크린샷에 실제 회사·사람 이름, 사내 주소, 개인 이메일을 넣지 않습니다. 예시는 `example.com` 과 데모 저장소로.
- 외부로 보내는 요청(GitHub·GitLab·AI·Gravatar)은 사용자가 연결·선택한 것만.

### 테스트

- 파서·그래프·YAML 처럼 순수한 로직은 `windows/tests/*.test.ts` 에 단위 테스트를 더합니다.
- Windows 에 화면·동작을 더했다면 `windows/src/selftest.ts` 에 실제 앱으로 해 보는 항목을 하나 더합니다. 푸시하면 GitHub Actions 의 Windows 서버에서 돕니다.
- 외부 서버가 필요한 기능은 `windows/tests/mock-ai-server.mjs` 에 가짜 응답을 더해 점검합니다.

## 커밋 메시지

이 저장소는 한국어 한 줄 요약 + 필요하면 본문 목록을 씁니다.

```
영역: 무엇을 했는지(필요하면 왜)

- 바뀐 점 하나
- 바뀐 점 둘
```

- 영역 예: `그래프`, `CI/CD 탭`, `Windows`, `맥`, `성능`, `README`, `CI`. 두 플랫폼 모두면 영역 없이 기능 이름으로.
- 한 커밋에는 한 가지 주제. 정리(파일 이동)와 동작 변경은 나눕니다.
- 버전 커밋은 `버전 0.3.2 (요약)` 형식이며 관리자가 만듭니다.

## PR

1. `main` 에서 브랜치를 만들어 작업합니다(`feature/…`, `fix/…`).
2. 위의 확인(빌드·`tsc`·`vitest`·`cargo check`)을 통과시키고, 화면이 바뀌었으면 라이트·다크 스크린샷을 붙입니다.
3. PR 설명의 체크리스트를 채워 주세요. CI(Windows 자동 점검)가 통과해야 합칩니다.

릴리스(버전 올리기·서명·배포)는 관리자가 합니다.
