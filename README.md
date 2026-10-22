# Branchwork

> A native Git client for macOS and Windows with a commit graph, worktrees, GitHub/GitLab pull requests, Claude Code agents and a built-in terminal. (macOS: SwiftUI · Windows: Tauri)

Git 저장소를 커밋 그래프로 보고 다루는 macOS 앱(SwiftUI, macOS 15+).
Git 동작은 시스템 `git` 을 그대로 호출하고, 화면·그래프 배치·파싱은 처음부터 새로 만들었다.

## 설치

1. [Releases](https://github.com/ChoMnSeong/Branchwork/releases) 에서 `Branchwork-<버전>-macOS.dmg`(또는 `.zip`)를 받아 `Branchwork.app` 을 응용 프로그램 폴더로 옮긴다. Apple Silicon·Intel 모두 지원(유니버설).
2. 아직 Apple 공증(notarization)을 받지 않은 빌드라 처음 열 때 "확인되지 않은 개발자" 경고가 뜬다. 다음 중 하나로 연다.
   - **시스템 설정 → 개인정보 보호 및 보안** 아래쪽의 **"그래도 열기"** 를 누른 뒤 다시 실행
   - 또는 터미널에서 `xattr -dr com.apple.quarantine /Applications/Branchwork.app`

필요한 것: macOS 15 이상, `git`(Xcode 또는 Command Line Tools — `xcode-select --install`).
선택: [Claude Code](https://claude.com/claude-code)(Claude 기능·에이전트), [GitHub CLI](https://cli.github.com)(`gh` 로그인 가져오기).

## 기능

- **커밋 그래프**: 모든 브랜치를 레인 색으로 그리고 머지·분기를 곡선으로 연결. 브랜치·원격·태그 배지, 맨 위에 "작업 중인 변경" 행
- **사이드바**: 로컬 브랜치(↑/↓ 표시), 원격 브랜치(리모트별), 태그, 스태시
  - 클릭 = 그래프에서 해당 커밋으로 이동, 더블클릭 = 체크아웃
  - 우클릭: 머지, 리베이스, 새 브랜치, Push, 삭제, 강제 삭제
- **작업 영역**: 스테이지/언스테이지(파일별·전체), 변경 버리기, 커밋(⌘↩), Amend
- **커밋 상세**: 메시지, 작성자, 부모 커밋 이동, 변경 파일 목록 → diff
- **diff**: 줄 번호와 추가/삭제 색 표시, 바이너리·새 파일 처리
- **커밋 우클릭**: 브랜치·태그 만들기, 체크아웃(분리된 HEAD), Cherry-pick, Revert, Reset(soft/mixed/hard)
- **툴바**: Fetch, Pull(기본/ff-only/merge/rebase), Push(업스트림 자동 설정, force-with-lease), 새 브랜치, Stash/Pop
- **진행 중 작업**: 머지·리베이스·cherry-pick 충돌 배너(중단/계속), 충돌 파일 "해결됨으로 표시"
- **워크트리**: 목록(사이드바), 새 워크트리(새 브랜치/기존 브랜치, 기본 위치 `<저장소>-worktrees/<브랜치>`), 제거·강제 제거·정리, Branchwork·Finder·터미널에서 열기, 다른 워크트리가 쓰는 브랜치 표시
- **AI** (설정 > AI) — 커밋 메시지·커밋 설명·PR/MR 제목·본문 작성
  - 고를 수 있는 AI: Claude Code·Codex(ChatGPT 로그인)·Gemini CLI(이 PC 의 로그인 그대로, 도구는 끈 채 글만), Claude API·ChatGPT API·Gemini API(키), OpenAI 호환 서버(Ollama·LM Studio·OpenRouter 등). API 는 계정의 모델 목록을 받아 온다
  - **규칙**(설정 > 규칙): 공통 규칙 + 커밋 메시지·커밋 설명·PR 설명 규칙(예: `prefix 는 Feature, Fix, Hotfix 중 하나`), 자주 쓰는 규칙 버튼, 기능마다 다른 AI 지정
  - **나눠서 커밋**: AI 가 바뀐 파일을 주요 내용별로 묶은 계획을 보여 주고, 메시지·파일을 고친 뒤 차례로 커밋
- **에이전트**: Claude Code·Codex·Gemini CLI 세션을 워크트리·저장소에서 실행(첫 작업 지시, 권한 모드). Claude Code 는 상태(작업 중·권한 요청·입력 대기)까지 보인다
- **도구**(설정 > 도구): git·Claude Code·Codex·Gemini CLI·gh·터미널 셸을 자동으로 찾고, 못 찾으면 **불러오기**로 실행 파일을 직접 고른다
- **자동 업데이트**: 켤 때와 하루에 한 번 새 버전을 확인해 알리고, 누르면 받아서 설치한 뒤 다시 시작한다(맥: SHA-256·번들 ID·코드 서명 확인, Windows: 업데이트 서명 확인). 메뉴 '업데이트 확인…'
- **GitHub / GitLab**
  - 계정 연결: 토큰(키체인 보관), GitHub 는 `gh` 로그인 가져오기 지원, GitLab 은 자체 호스팅 주소 지정
  - 열린 PR/MR 목록·상세(사이드바), 브랜치 체크아웃(포크는 `pr/번호`·`mr/번호`), 브라우저로 열기
  - 현재 브랜치로 PR/MR 만들기(필요하면 먼저 push, Draft 지원)
  - 복제 창에서 내 저장소 목록·검색
  - HTTPS push/pull/clone 인증: 연결한 토큰으로 GIT_ASKPASS 응답(기존 키체인·자격 증명 도우미가 우선)
- **CI/CD 탭**(사이드바 목록/에이전트/CI/CD 전환): GitLab 파이프라인·GitHub Actions 실행 목록(상태·브랜치·시간, 현재 브랜치만 보기), 펼치면 단계별 작업
  - **수동 작업 실행**: GitLab `when: manual`·`when: delayed` 작업의 ▶ 버튼(최근 파이프라인은 기다리는 수동 작업 수를 미리 표시)
  - 작업·파이프라인 다시 실행(GitHub 은 실패한 작업만도), 실행 취소, 브라우저로 열기·커밋 보기
  - **실행…**: GitLab — 브랜치와 변수로 새 파이프라인(`.gitlab-ci.yml` 의 설명 붙은 변수는 미리 채움) / GitHub — `workflow_dispatch` 워크플로를 브랜치·입력값(선택·참거짓·글)으로 실행
  - GitHub 환경 보호 규칙의 배포 승인·거부
  - 실행 중인 게 있으면 8초마다, 없으면 45초마다 새로 고침. 실행하려면 토큰에 GitLab 은 `api` 권한, GitHub 은 Actions 쓰기 권한(클래식 토큰은 `repo`)이 필요하다
- **에이전트 탭**(사이드바 목록/에이전트 전환): 워크트리 카드(새 파일·수정·삭제 수, 원격 대비 ↑↓)와 그 안에서 도는 에이전트 세션 상태(작업 중·권한 요청·입력 대기·종료), 세션 시작(워크트리 선택 또는 새 워크트리, 맡길 작업, 권한 모드), 세션을 누르면 그 Terminal 탭으로 이동
  - 상태는 Branchwork 가 띄운 세션에 `--settings` 로 더한 훅(`~/Library/Application Support/Branchwork/agents/hook.sh`)이 남기는 파일로 판단한다. 사용자 설정·훅은 그대로 유지된다.
- **변경 파일 보기**: 목록 / 폴더 트리 전환(작업 영역·커밋 상세), 트리에서 폴더 단위 스테이지·언스테이지
- **탭**: macOS 기본 창 탭으로 여러 저장소·워크트리를 열어 두고 오간다(⌘T 새 탭, ⌘W 닫기, ⌃Tab 이동, 탭을 끌어 새 창으로). 다른 저장소·워크트리를 열면 새 탭(이미 열려 있으면 그 탭). 다시 켜면 탭 복원
- **터미널**(⌃` 보이기/숨기기, ⌃⇧` 새 터미널): 그래프 아래 패널에서 저장소 폴더의 로그인 셸(zsh)을 연다. 패널 안 탭으로 여러 개, 경계선을 끌어 높이 조절, 숨겨도 셸은 계속 실행, 탭 이름은 현재 폴더나 실행 중인 프로그램, 워크트리 우클릭 → '아래 터미널에서 열기'. git 명령을 치면 그래프가 자동으로 갱신된다. 터미널 에뮬레이터는 [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm)(MIT, `macos/Vendor/SwiftTerm`)
- **커밋 검색**(⌘F): 커밋(제목·작성자·SHA·브랜치 + 메시지 본문), 파일 경로, 코드 변경(-G). 결과 강조·나머지 흐리게, ⌘G/⇧⌘G·Enter 로 이동, 그래프 밖 결과는 더 불러와서 찾기
- **기타**: 저장소 열기·복제·새로 만들기, 최근 저장소, 파일 변경 자동 새로 고침(FSEvents), 설정(⌘,)

## 저장소 구조

```
macos/     맥 앱(SwiftUI)
  Sources/App       앱·창·탭·업데이트
  Sources/Core      git 실행·출력 해석·그래프 배치·모델·파일 감시
  Sources/Store     저장소 화면 상태(RepoStore)와 기능별 확장
  Sources/Services  GitHub·GitLab·CI/CD·AI·계정·에이전트·도구·프로필 사진
  Sources/Views     화면
  Resources/ Tools/ Vendor/SwiftTerm/  build.sh
windows/   Windows 앱(Tauri 2 + React): src-tauri(Rust), src/lib(상태·로직), src/components(화면), tests
```

## 빌드(맥)

Swift 6 이상(Xcode 또는 Command Line Tools)만 있으면 된다. 외부 패키지를 내려받지 않는다.

```sh
macos/build.sh           # macos/build/Branchwork.app (이 맥의 아키텍처)
macos/build.sh install   # 빌드 후 /Applications 에 설치
macos/build.sh release   # macos/dist/ 에 배포용 dmg·zip (arm64 + x86_64 유니버설, ad-hoc 서명)
```

- SwiftPM 없이 `swiftc` 로 직접 컴파일한다(일부 Command Line Tools 에서 SwiftPM 이 동작하지 않아서).
- 같은 이유로 SwiftUI `@State` 매크로 대신 `ViewState` 별칭을 쓴다(`Views/Theme.swift`).
- 내장 터미널용 SwiftTerm 은 `macos/Vendor/SwiftTerm` 소스를 아키텍처별 정적 라이브러리(`macos/.build/swiftterm/<arch>/`)로 따로 컴파일한다(처음 한 번 1분쯤, 소스가 바뀔 때만 다시).
- 키체인에 저장한 토큰을 빌드마다 다시 허용하지 않도록, 이 맥에 Apple Development 인증서가 있으면 그걸로 서명한다(`BRANCHWORK_SIGN_IDENTITY` 로 바꿀 수 있음).
- 아이콘은 `macos/Tools/makeicon.sh` 가 처음 빌드할 때 만든다.

## 인증

push/pull 이 자격 증명을 물으면 멈추지 않고 실패하도록 해 두었다(`GIT_TERMINAL_PROMPT=0`).
설정(⌘,)에서 GitHub·GitLab 계정을 연결하면 HTTPS push/pull 에 그 토큰을 쓰고, 그 밖에는 키체인·SSH 키 등 기존 git 자격 증명을 그대로 쓴다.

## Windows

`windows/` 폴더에 같은 기능의 Windows 앱이 있다([Tauri](https://tauri.app) 2 — Rust 백엔드 + React 화면).

- **설치**: [Releases](https://github.com/ChoMnSeong/Branchwork/releases) 의 `Branchwork_<버전>_x64-setup.exe`. Windows 10(1809 이상)·11, [Git for Windows](https://git-scm.com/download/win) 필요.
  코드 서명을 하지 않은 빌드라 처음 실행할 때 SmartScreen 이 막으면 **추가 정보 → 실행** 을 누른다.
- **맥 버전과 다른 점**
  - 저장소 탭은 창 안의 탭(Ctrl+T 새 탭, Ctrl+W 닫기, Ctrl+Tab 이동, 가운데 클릭으로 닫기)
  - 단축키는 ⌘ 대신 Ctrl(새로 고침은 F5, 다음 검색 결과는 F3)
  - 터미널은 PowerShell(pwsh 가 있으면 pwsh). Ctrl+C 는 선택이 있으면 복사, Ctrl+V 붙여넣기
  - 에이전트 세션(Claude Code·Codex·Gemini CLI)은 Terminal 앱 대신 아래 터미널 패널의 탭에서 돈다
  - 토큰은 Windows 자격 증명 관리자에, 설정은 `%APPDATA%\Branchwork` 에 둔다
- **빌드**: Node.js 22 와 Rust(stable) 가 있으면

  ```sh
  cd windows
  npm ci
  npx tauri build      # src-tauri/target/release/bundle/nsis/*-setup.exe
  npx vitest run       # 파서·그래프 단위 테스트
  ```

- **자동 점검**: `BRANCHWORK_SELFTEST=<테스트 저장소>` 로 실행하면 저장소 열기·스테이지·커밋·브랜치·머지·검색·stash·터미널·자격 증명·도우미 모드·도구 불러오기·AI 커밋 메시지·규칙·나눠서 커밋·업데이트 서명 확인·CI/CD(가짜 GitLab·GitHub 로 수동 작업 실행·워크플로 실행)를 실제 앱에서 차례로 해 보고 결과를 남긴다(가짜 AI·업데이트·GitLab·GitHub 서버 `tests/mock-ai-server.mjs`). GitHub Actions 의 Windows 서버에서 푸시마다 돈다(`.github/workflows/windows.yml`).
- **업데이트 서명**: 릴리스 빌드는 `TAURI_SIGNING_PRIVATE_KEY`(GitHub Actions 비밀 값)로 설치 파일에 서명하고, 앱은 `tauri.conf.json` 의 공개 키로 확인한 뒤에만 설치한다. 릴리스에 `latest.json`(`windows/scripts/latest-json.mjs`)을 함께 올린다.

## 라이선스

[MIT](LICENSE) © 2026 조문성 (ChoMnSeong)

포함된 서드파티 코드: [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) v1.20.0 — MIT ([macos/Vendor/SwiftTerm/LICENSE](macos/Vendor/SwiftTerm/LICENSE))

Windows 앱이 쓰는 오픈소스: [Tauri](https://tauri.app)(MIT/Apache-2.0), [React](https://react.dev)(MIT), [xterm.js](https://xtermjs.org)(MIT), [portable-pty](https://github.com/wezterm/wezterm)(MIT), [Lucide](https://lucide.dev) 아이콘(ISC) 등 — 각 패키지의 라이선스를 따른다.
