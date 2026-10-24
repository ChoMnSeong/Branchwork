# gitch

여러 Git 계정(GitHub 개인 계정들 + 회사 GitLab)을 한 컴퓨터에서 섞이지 않게 쓰기 위한 도구.
사람이 터미널에서 쓰는 것과 AI(Claude Code, Codex 등)가 쓰는 것을 모두 고려했다.
Gitrochi 맥 앱(`Gitrochi.app/Contents/Resources/gitch`)과 Windows 앱(설치 폴더의 `gitch`, 보통 `%LOCALAPPDATA%\Gitrochi\gitch`)에 함께 들어 있다. MIT 라이선스(저장소 [LICENSE](../../LICENSE)) · © 2026 jjunhaa0211.

- 저장소마다 계정을 **잠그고**, 커밋/push 할 때 작성자·push 주소를 검사한다.
- 폴더 / GitHub 조직 / 주소로 **계정을 자동으로 고른다**.
- 비밀값·큰 파일·강제 push·다른 계정 커밋을 **git 훅에서 막는다** (어떤 도구로 git 을 써도 적용).
- AI 에게는 규칙(CLAUDE.md/AGENTS.md), 스킬, Claude Code 명령 검사 훅을 깔아 준다.
- macOS 기본 bash 3.2 + git 만으로 동작한다 (jq 는 Claude 훅/JSON 요약에만 사용). Windows 는 Git for Windows 의 Git Bash 로 돈다 — 아래 [Windows](#windows).

## 설치

**Gitrochi 에서** — 설정 > CLI
1. 계정이 없으면 **Terminal 에서 계정 추가** → `gitch add` 가 아이디·이메일·서버를 묻고 SSH 키를 만든다.
2. **설치** → 무엇이 바뀌는지 보여 준 뒤 `gitch install` 을 실행한다(`~/bin/gitch` 가 앱 안의 gitch 를 가리키므로 앱을 업데이트하면 gitch 도 같이 바뀐다). 앱이 응용 프로그램 폴더(`/Applications` 또는 `~/Applications`)에 있어야 한다 — 디스크 이미지 · 다운로드 폴더 · 임시 위치(App Translocation)의 앱에 연결하면 디스크를 꺼내거나 앱을 옮길 때 끊기므로, 앱도 `gitch install` 도 거부하고 옮길 곳을 알려 준다.
3. 새 터미널을 연다. 저장소 화면의 커밋 칸 위에 이 저장소의 계정(잠금)과 커밋·push 전 점검(`gitch preflight`)이 보이고, 계정 이름을 눌러 이 저장소의 계정을 바꾼다(`gitch use`).

**CLI 만** — 앱 없이 터미널에서 (curl + macOS 기본 bash)

```bash
curl -fsSL https://raw.githubusercontent.com/Gitrochi/Gitrochi/main/tools/gitch/install.sh | bash
~/.local/share/gitch/gitch add       # 계정이 없으면 (터미널에서 사용자가 직접)
~/.local/share/gitch/gitch install   # ~/bin/gitch 연결, 자동 규칙, 검사 훅, AI 연동, 터미널 연동
source ~/.zshrc
```

- [install.sh](install.sh) 는 [릴리스](https://github.com/Gitrochi/Gitrochi/releases)의 `gitch` 를 `gitch.sha256` 으로 확인한 뒤 `~/.local/share/gitch/gitch` 에 둔다(임시 파일 → mv). 그 자리에 gitch 가 아닌 파일이나 링크가 있으면 덮어쓰지 않고 멈춘다.
- `gitch install` 은 `~/.zshrc` · `~/.gitconfig` · `~/.claude` · `~/.codex` 를 바꾸므로 설치기가 하지 않고 할 일만 보여 준다.
- 업데이트: `gitch self-update` — 이렇게 따로 받은 gitch 만 같은 방법으로 바꾼다(바뀐 버전을 보여 줌). 앱에 든 gitch 는 앱과 함께, 저장소의 gitch 는 그 저장소와 함께 바뀐다.

**직접**

```bash
tools/gitch/gitch add          # 계정 추가 (터미널에서 사용자가 직접)
tools/gitch/gitch org add github.com/<조직> <계정>   # (선택) 조직 → 계정 규칙
tools/gitch/gitch install      # ~/bin/gitch 연결, 자동 규칙, 검사 훅, AI 연동, 터미널 연동
source ~/.zshrc
gitch doctor
```

터미널에서 `gitch install` 을 하면 맨 위에 로고(앱 아이콘의 두 눈)가 창 크기에 맞춰 크게·중간·작게(아주 좁으면 이름만) 나오고, 단계(명령 · 터미널 · 자동 규칙 · 검사 훅 · AI 도구)별로 설치한다. 로고는 사람이 보는 터미널에서만 나온다(`GITSW_BANNER=never` 로 끄고 `always` 로 켠다).

새 컴퓨터: `gitch import <내보낸 설정>` → `gitch install` → `gitch setup` (SSH 키 생성·등록).

### Windows

Git for Windows(Git Bash)만 있으면 된다. gitch 는 bash 스크립트라 Gitrochi 도 Git Bash 의 `bash.exe` 로 실행한다.

- **Gitrochi 에서**: 설정 > CLI 는 맥과 같다. 계정 추가 · SSH 키 · doctor 는 새 콘솔 창(Git Bash)에서 열린다. 설치 프로그램으로 깐 Gitrochi(옆에 `uninstall.exe`)만 연결한다 — 포터블 zip · 빌드 폴더에 연결하면 옮기거나 지울 때 끊기므로 앱도 `gitch install` 도 거부한다.
- **CLI 만**: Git Bash 에서 위의 `curl … | bash` 그대로. 다음 안내의 `source ~/.zshrc` 대신 `source ~/.bashrc`.
- `gitch install` 이 맥과 다르게 하는 것
  - `~/bin/gitch` · `~/bin/gitsw`: Git Bash 의 `ln -s` 는 링크 대신 복사본을 만들어서, 대상 경로를 적은 작은 연결 스크립트(`# gitch-link: <경로>` + `exec`)로 만든다. 앱을 업데이트하면 gitch 도 같이 바뀌는 것은 맥과 같다.
  - `~/bin/gitch.cmd` · `gitsw.cmd`: PowerShell · cmd · Codex 에서 `gitch` 로 부르게 Git Bash 로 넘긴다. 사용자 PATH(레지스트리, `%VAR%` 는 그대로)에 `%USERPROFILE%\bin` 이 없으면 넣는다 — `gitch uninstall` 은 gitch 가 넣었을 때만 뺀다.
  - 터미널 연동: `~/.zshrc` 대신 Git Bash 의 `~/.bashrc` (PATH + 프롬프트 마지막 줄 앞에 이 저장소 계정).
  - SSH 설정에 `UseKeychain`(맥 전용 옵션 — Windows 의 OpenSSH 는 모르는 옵션이라 멈춘다)을 넣지 않는다. 공개키 복사 · 페이지 열기는 `clip` · 기본 브라우저.
- Claude Code 검사 훅에는 jq 가 필요하다: `winget install jqlang.jq`

## Gitrochi 앱에서

터미널에서 하는 일을 앱에서도 한다(앱은 같은 gitch 를 실행한다). 아직 앱에 없는 명령은 터미널에서.

| gitch | 앱 |
|---|---|
| `install` · `list` · `doctor` | 설정 > CLI |
| `add` · `setup` | 설정 > CLI 에서 Terminal 로 연다(묻는 것이 있어서) |
| `status` · `preflight` | 커밋 칸 위 — 계정(잠금)과 점검 결과, 누르면 점검 항목 · fetch 하고 다시 점검 |
| `use` · `unlock` | 커밋 칸 위 계정 이름 |
| `up` · `sync` · `fix` · `rescue` · `ignore` | 커밋 칸 위 ⋯ 메뉴 |
| `protect` | 사이드바 브랜치 우클릭 — 보호된 브랜치에는 방패 표시 |
| `c` · `p` · `pl` · `b` · `wt` · `pr` · `ci` · `continue` · `abort` | 앱의 커밋 · push · pull · 브랜치 · 워크트리 · PR · CI 화면(앱도 시스템 git 을 써서 gitch 훅이 그대로 걸린다) |
| `graph` | 저장소 메뉴 › 구조 그래프 — 맥: 툴바의 폴더 아이콘 · 메뉴 막대 Repository, Windows: 툴바의 폴더 아이콘 · ≡ 메뉴. 관계를 고르면 html 을 만들어 기본 브라우저로 연다(아래 「구조 그래프」) |

## 예전 이름 gitsw

gitch 는 gitsw 의 새 이름이다. 이미 gitsw 를 쓰던 컴퓨터는 `gitch install` 한 번이면 그대로 이어진다.

- `~/bin/gitsw` 도 같은 파일을 가리킨다 — gitsw 로 부르는 AI 규칙·스크립트가 계속 된다(링크가 아닌 파일이면 건드리지 않음).
- 설정·잠금·기록은 예전 이름 그대로 읽고 쓴다: `~/.config/gitsw/config`(`[gitsw]` 섹션), 저장소의 `gitswitch.*`, `~/.local/state/gitsw`, 전역 훅 `hook.gitsw-*`, 백업 `refs/gitsw/backup/*`, 환경 변수 `GITSW_*`, 비밀값 예외 주석 `gitsw:allow`(새 이름 `gitch:allow` 도 됨).
- `gitch install` 이 CLAUDE.md·AGENTS.md 의 규칙 블록, 스킬(`skills/gitsw` → `skills/gitch`), Claude Code 검사 훅과 허용 목록의 `gitsw` 항목을 gitch 로 바꾼다.

## 개념

| 이름 | 뜻 |
|---|---|
| 계정 | 커밋 작성자(이름/이메일) + 서버 목록. `host = github.com` / `host = gitlab.example.com:2222` |
| 별칭 | 계정마다 SSH 별칭(`github-<계정>`, `gitlab-<계정>`)과 키(`~/.ssh/id_ed25519_<계정>`)를 쓴다 |
| 잠금 | `gitch use/clone` 이 저장소에 계정을 기록(`gitswitch.account`)하고 주소를 별칭으로 바꾼다 |
| 자동 규칙 | 폴더(`~/Develop/<계정>`), 조직(`github.com/<조직>`), 주소 소유자, 서버(계정이 하나뿐인 서버)로 계정을 고름 |
| 검사 훅 | git 전역 설정 훅(`hook.gitsw-*`) + 저장소 보조 훅(Apple git 대비) |

계정 판단 순서: 잠금 → 주소 소유자 → 조직 규칙 → 폴더 기본 → 주소 별칭 → 서버에 계정이 하나뿐.

## 매일 쓰는 명령

```bash
gitch preflight            # 커밋/push 전 한 번에 점검 (PREFLIGHT=OK|WARN|STOP)
gitch ck                   # 바뀐 파일 / push 안 한 커밋 / 받을 커밋 / 진행 중 rebase 등
gitch c -m "제목" -m "본문"  # 커밋 (-a 전부, -F 파일, --trailer "키: 값")
gitch p                    # push (--force 는 확인 후 --force-with-lease)
gitch cp -a -m "..."       # 커밋 + push
gitch pl                   # pull --rebase --autostash
gitch up                   # 기본 브랜치 최신을 지금 브랜치에 (push 전 rebase, push 후 merge)
gitch pr --title "..."     # GitHub PR / GitLab MR (브라우저 없이)
gitch pr status / gitch ci
gitch continue / abort     # 충돌난 rebase/merge
gitch rescue               # pl/up/sync/fix/undo/amend 전에 자동으로 남긴 백업으로 복구
gitch clone [계정] <주소>   # 계정 자동 선택 + 계정 폴더에 받기 + 잠금
gitch publish [이름]       # 원격이 없는 새 저장소를 GitHub/GitLab 에 비공개로 만들고 첫 push
gitch scan [--fix]         # ~/Develop 아래 저장소 전체 점검
gitch report --today       # 오늘 누가(사람/claude/codex) 어디에 무엇을 커밋/push 했나
```

`gitch help` 에 전체 명령이 있다. `--json` 은 status / ck / preflight / scan / doctor / list / audit / report / graph 에 있다.

종료코드: 0 정상, 1 문제/실패, 2 사용자 확인 필요(`--yes`), 3 커밋할 것 없음, 4 올릴 파일을 고르지 않음(비대화형).

## 구조 그래프 (`gitch graph`)

`tuist graph` 처럼 저장소의 구조와 관계를 그린다. 사람은 그림(html · svg · png)으로 보고, AI · 스크립트는 JSON 으로 읽는다. 추적하는 파일(`git ls-files`)만 본다.

```bash
gitch graph                                  # 파일 import — 터미널이면 html 을 만들어 브라우저로 연다
gitch graph modules                          # 모듈/타깃 의존
gitch graph changes --since "6 months ago"   # 같이 바뀌는 파일 · 핫스팟
gitch graph tree --depth 2                   # 폴더 크기 · 파일 수
gitch graph files src/feature                # 그 폴더 아래만 (폴더 밖 대상은 outside: true)
gitch graph --lang swift                     # 그 언어만 (ts · js · web · swift · python · go · rust · kotlin · java · jvm, 쉼표로 여럿)
gitch graph --json | jq -r '.edges[] | select(.target == "src/api/client.ts") | .source'   # 이 파일을 쓰는 곳
gitch graph modules --out deps.png           # graphviz(dot) 로 그림
```

| 관계 | 보는 것 | 노드 · 연결 |
|---|---|---|
| `files` (기본) | 파일 → 파일 import | 파일, 저장소 밖 패키지(`pkg:npm/react`), Swift 모듈(`module:SwiftUI`), Go 패키지 폴더(`internal/store/`) |
| `modules` | 모듈/타깃 의존 | `swift:App` · `tuist:App` · `npm:@acme/ui` · `cargo:core` · `go:example.com/x/api` · `gradle::app`, 연결의 `scope`(`devDependencies` · `testImplementation` …) |
| `changes` | 한 커밋에 같이 바뀐 파일 쌍과 바뀐 횟수(핫스팟) | 파일(`changes` · `lastChanged`), 연결 `weight` = 같이 바뀐 커밋 수 · `degree` = 두 파일 바뀐 횟수 평균에 대한 % |
| `tree` | 폴더 구조와 크기 | 폴더(`files` · `bytes` · `filesHere` · `dirs` · `exts`), `--files` 면 파일도 |

`files` 가 읽는 것:

| 언어 | 읽는 문장 | 잇는 곳 |
|---|---|---|
| TypeScript/JavaScript | `import` · `export … from` · `require()` · `import()` | 상대 경로(확장자 · `index` · `.js` 로 쓴 `.ts`)와 tsconfig `paths` · `baseUrl` 은 파일, 그 밖은 패키지 |
| Python | `import` · `from … import` (상대 포함) | 모듈 파일 · 패키지(`__init__.py`), 못 찾으면 패키지 |
| Go | `import` | `go.mod` 의 모듈 안이면 패키지 폴더, 밖이면 모듈(`require` 기준) |
| Rust | `mod` · `use crate::/self::/super::` · 다른 crate | `a.rs` · `a/mod.rs`, 같은 저장소 crate 는 그 crate 의 파일 |
| Kotlin/Java | `package` + `import` | 그 이름을 선언한 파일. 같은 패키지 타입은 import 없이 쓰므로 이름으로 추정 |
| Swift | 파일끼리 import 가 없다 | 다른 파일에 선언된 최상위 타입(class · struct · enum · protocol · actor · typealias) 이름을 쓰면 추정, `import 모듈` 은 모듈 노드. Tuist(`Project.swift` 의 `sources` · 도우미 매니페스트는 `Sources/**` · `Tests/**`) · SwiftPM 으로 파일의 모듈(`modules`)을 정해, 같은 모듈이거나 import 한 모듈의 공개(public · open · package) 타입만 잇는다(`@testable import` 면 internal 도) |

- 추정한 연결은 JSON 에 `"heuristic": true`, 그림에서는 점선이다. 같은 두 파일에 정확한 연결이 있으면 더하지 않는다. 주석 · 문자열 속 이름과 `private` 타입은 세지 않는다. 모듈(Swift) · 패키지(Kotlin/Java)로 확인한 추정은 `"checked": true` 다.
- Swift 의 정확한 참조는 Xcode 인덱스에 있다. 앱이 gitch 옆에 두는 도우미 `gitch-swift-index`(또는 `GITCH_SWIFT_INDEX` 에 적은 실행 파일, 빈 값이면 끔, 그다음 `PATH`)가 있으면 `gitch-swift-index --repo <저장소> --covered <파일>` 의 `원본<TAB>대상<TAB>심볼,…` 줄을 정확한 연결(`"kind": "ref"`)로 쓰고, `--covered` 에 적힌(인덱스에 든) 파일은 추정하지 않는다 — 빌드하지 않은 타깃 · 빌드 뒤 새 파일은 그대로 이름으로 추정한다(목록을 쓰지 않으면 모두 든 것으로). 성공해도 표준오류 첫 줄(오래된 인덱스 경고 등)은 notes 에 적고, 3 으로 끝나면(인덱스 없음 — Xcode 로 한 번 빌드) 추정으로 돌아간다.
- `modules`: Package.swift 는 `swift package describe --type json` 으로 읽고(매니페스트를 컴파일해서 몇 초), 안 되면 파일을 직접 읽는다(`GITSW_SWIFT_DESCRIBE=0` 이면 늘 직접). Tuist 는 Project.swift 의 Target 선언과 의존(`.target` · `.project` · `.external` · `.package` · `.sdk`)을, 도우미 함수로 만든 매니페스트(`Project.module(…)`)는 파일 안의 참조를 모은다. 그 밖에 모든 package.json(작업 공간 구성원은 `workspace`), Cargo 의 `path` · `workspace = true` 의존, Go 패키지 사이 import, Gradle 의 `include` · `project(":x")` · `projects.x`.
- `changes`: `--since 날짜` · `--max-commits N`(기본 1000) · `--max-files N`(기본 30, 더 큰 커밋은 쌍이 너무 많아 뺀다) · `--min N`(기본 2). merge 커밋과 lock 파일은 뺀다.
- `--no-external` 은 저장소 밖 패키지 · 모듈을 뺀다. `--lang` 은 고른 언어의 파일(modules 는 그 언어의 생태계)만 남기고, JSON 의 `lang` 에 적는다.
- 파일마다 프로세스를 띄우지 않고 awk 한 번에 읽는다. 파일 21,000개(150만 줄) 저장소의 `files` 가 Apple Silicon 맥에서 7초 안팎, `modules` · `changes` · `tree` 는 1초 안이다.

| 형식 | |
|---|---|
| 기본 | 사람이 보는 터미널이면 `html` 을 만들어 열고, 아니면(스크립트 · AI) `json` 을 표준출력. `--format` 이나 `--out` 의 확장자(`.json` · `.html` · `.svg` · `.png` · `.dot`)로 바꾼다 |
| `html` | Gitrochi 앱 아이콘을 따른 오프라인 한 페이지(CDN 없음): 남색 화면, git 노드처럼 가운데가 빈 고리, 고른 것은 초록 빛, 커서를 보는 마스코트. 네 관계를 모두 담아 위 탭(파일 · 모듈 · 같이 바뀜 · 폴더, 키 1~4)으로 바꾸고, 단위(파일 · 폴더 1~8단계로 묶기) · 언어 · 그리기(점 = 옵시디언 그래프 보기, 상자 = tuist graph 같은 다이어그램)를 고른다. 배치는 힘 · 층(위 → 아래, 모듈 탭 기본) · 나무(왼쪽 → 오른쪽, 폴더 탭 기본) · 방사형 · 폴더 원이고, 노드와 상자가 겹치지 않게 놓는다(이름은 겹치면 그리지 않는다). 폴더 원은 폴더마다 원, 그 안에 파일(넓이 = 줄 수)을 채운 것으로, 멀리서는 폴더가 접힌 원 하나(파일 수 · 비교의 +/−)로 보이고 가까이 가거나 누르면 그 자리에서 펼쳐진다. 접힌 폴더끼리의 연결은 합쳐서 굵기로, 공통 폴더 쪽으로 휘어 묶인다. 노드가 600개를 넘는 파일 · 같이 바뀜 탭은 폴더 원으로 시작한다. 찾기(`/`), 설정 창(필터 · 묶음 · 표시 · 힘), 표로 보기(정렬), 지금 화면을 PNG 로 저장, 어둡게 · 밝게(기억) |
| `html` 비교 · 규칙 | `gitch graph diff --format html` 은 새로 생긴 노드 · 연결을 초록, 없어진 것을 빨간 점선으로(「바뀐 것만」이 기본), 분석 창 맨 위에 새 순환 · 없어진 순환 · 더한 연결 · 뺀 연결. 규칙 파일이 있으면 어긴 연결을 빨갛게, 분석 창에 「규칙 위반」 |
| `html` 분석 (`A`) | 순환 의존 · 가장 긴 의존 사슬 · 많이 쓰이는 것 · 많이 쓰는 것 · 많이 쓰이는데 불안정한 것 · 아무도 안 쓰는 것 · 많이 쓰는 외부 패키지 · 폴더 사이 연결 · 핫스팟(바뀐 횟수 × 줄) · 숨은 결합(같이 바뀌는데 import 는 없음). 폴더 탭은 큰 폴더 · 파일이 바로 많이 든 폴더 · 가장 깊은 경로 · 자주 바뀌는 폴더 · 확장자, 같이 바뀜 탭은 자주 같이 바뀌는 쌍. 줄을 누르면 그래프에서 강조한다(`Esc` 로 풀기) |
| `html` 노드 | 누르면 들어옴 · 나감 · 불안정도 · 영향 범위(바꾸면 흔들리는 것 전부) · 전체 의존 · 순환과, 가져오는 것 · 가져다 쓰는 곳(폴더면 안의 파일) 목록. 단추로 영향 범위 보기 · 전체 의존 보기 · 경로 찾기(다음에 누른 노드까지 가장 짧은 길) · 주변만(로컬 그래프). 색은 언어 · 종류(모듈: 앱 · 라이브러리 · 테스트) · 바뀐 횟수, 크기는 연결 · 줄 · 바뀐 횟수. 언어 색은 노드가 많은 계열 셋(TS/JS · Swift · Python · Go · Rust · Kotlin/Java)에만 주고 나머지는 회색 — 색 세 가지를 넘으면 서로 잘 구별되지 않는다 |
| `svg` · `png` | graphviz 의 `dot` 으로 그린다(`brew install graphviz`, Windows 는 `winget install Graphviz.Graphviz`, 없으면 그렇게 알린다). `--format dot` 은 DOT 원문 |
| 저장 | `--out 파일`(`-` 는 표준출력). 없으면 html · svg · png 는 `$TMPDIR/gitch-graph/<저장소>-<관계>.<형식>`. 파일로 쓰면 끝에 `GRAPH_FILE=… NODES=… EDGES=…` |

JSON (노드 · 연결이 한 줄에 하나):

```json
{
  "tool": "gitch graph",
  "version": "3.2.0",
  "relation": "files",
  "directed": true,
  "repo": "app",
  "scope": "",
  "lang": null,
  "commit": "872fcdd",
  "generated": "2026-10-24T10:56:55+0900",
  "stats": {"nodes":6,"edges":4,"heuristicEdges":1,"languages":{"swift":2,"ts":2},"unresolved":0},
  "notes": ["Swift: 파일끼리 import 하지 않아서, … 연결로 추정했습니다 (heuristic: true, 그림에서는 점선)."],
  "nodes": [
    {"id":"Sources/Feed/FeedModel.swift","kind":"file","label":"FeedModel.swift","group":"swift","path":"Sources/Feed/FeedModel.swift","lang":"swift","lines":1},
    {"id":"Sources/Feed/FeedView.swift","kind":"file","label":"FeedView.swift","group":"swift","path":"Sources/Feed/FeedView.swift","lang":"swift","lines":6},
    {"id":"module:SwiftUI","kind":"module","label":"SwiftUI","group":"module","name":"SwiftUI"},
    {"id":"pkg:npm/react","kind":"package","label":"react","group":"package","ecosystem":"npm","name":"react"},
    {"id":"src/App.tsx","kind":"file","label":"App.tsx","group":"ts","path":"src/App.tsx","lang":"ts","lines":2},
    {"id":"src/api/client.ts","kind":"file","label":"client.ts","group":"ts","path":"src/api/client.ts","lang":"ts","lines":1}
  ],
  "edges": [
    {"source":"Sources/Feed/FeedView.swift","target":"Sources/Feed/FeedModel.swift","kind":"type-ref","weight":1,"heuristic":true,"via":["FeedModel"]},
    {"source":"Sources/Feed/FeedView.swift","target":"module:SwiftUI","kind":"import","weight":1},
    {"source":"src/App.tsx","target":"pkg:npm/react","kind":"import","weight":1,"via":["react"]},
    {"source":"src/App.tsx","target":"src/api/client.ts","kind":"import","weight":1,"via":["./api/client"]}
  ]
}
```

연결 `kind`: `import` · `reexport` · `require` · `dynamic-import` · `mod` · `use` · `type-ref`(추정) · `ref`(Xcode 인덱스) · `contains` · `depends` · `cochange`. `via` 는 근거(import 한 글 · 쓴 타입 이름, 다섯 개까지), `weight` 는 횟수다.

### 비교 (`gitch graph diff`)

```bash
gitch graph diff                 # 기본 브랜치(upstream > origin)와 갈라진 곳 → 지금 작업 트리 (files)
gitch graph diff main modules    # 기준을 주면 그 커밋 · 브랜치와
gitch graph diff --json          # AI · 스크립트: 바뀐 것만 (status: added · removed, cycles.new · changed · gone)
gitch graph diff --format html   # 전체 그래프에 더한 것 · 뺀 것을 색으로
```

- 기준 커밋의 추적 파일을 `git archive` 로 임시 폴더에 풀어 같은 방법으로 그래프를 만들고(저장소는 건드리지 않는다), 노드 · 연결 · 순환을 비교한다. 커밋하지 않은 바꿈도 들어간다(추적하는 파일만).
- 터미널에서는 요약: 연결 +/−(그중 추정), 노드 +/−, 새로 생긴 · 커지거나 줄어든(노드가 둘 넘게 겹침) · 없어진 순환, 더하고 뺀 연결. `tree` 는 폴더마다 파일 수 · 크기 변화(`"status": "changed"`, `filesDelta` · `bytesDelta`).
- 양쪽을 같은 방법으로 읽으려고 Package.swift 는 swift 없이 직접 읽고, Xcode 인덱스 도우미는 쓰지 않는다. `changes` 는 비교하지 않는다.

### 규칙 검사 (`gitch graph check`)

```bash
gitch graph check --init         # 예시가 든 .gitch/graph.rules 를 만든다
gitch graph check                # 위반이 있으면 종료 코드 1 — CI 에 그대로 넣는다
gitch graph check --base main    # main 에도 있던 위반은 「기존」으로 따로 적고 실패로 세지 않는다
```

```
[modules]
no-cycles
forbid  *Feature -> *Feature            # 기능 모듈끼리 기대지 않는다 (같은 모듈 안은 괜찮다)
layers  *App > *Feature > Domain* > Core*   # 왼쪽이 오른쪽에 기대는 것만 된다

[files]
no-cycles src/**
forbid  src/ui -> src/db
allow   src/ui/debug -> src/db          # 위반의 예외
```

| 규칙 | 뜻 |
|---|---|
| `forbid A -> B` | A 가 B 에 기대면 위반. A 와 B 가 같은 패턴이면 같은 곳(같은 모듈 · 같은 폴더)끼리는 괜찮다 |
| `allow A -> B` | `forbid` · `layers` 위반의 예외 |
| `layers A > B > …` | 노드는 처음 맞는 층에 속하고, 오른쪽 층이 왼쪽 층에 기대면 위반 |
| `no-cycles [패턴]` | 순환 의존(패턴을 주면 그 안에서만) |

- 패턴: `files` 는 경로 glob(`*` 한 마디, `**` 여러 폴더, 폴더 이름만 쓰면 그 아래 전부, 외부는 `pkg:npm/react`), `modules` 는 모듈 이름(`*Feature`) 또는 id(`tuist:App`).
- 정확한 연결과 모듈 · 패키지로 확인한 추정(`checked`)은 위반, 이름만으로 한 추정은 경고(실패 아님)다. 틀린 규칙 줄은 줄 번호와 까닭을 알리고 멈춘다.
- 규칙 파일이 있으면 `gitch graph` 의 html 분석 창에 「규칙 위반」이 같이 나온다. JSON: `{"ok", "violations": [{"relation", "severity", "line", "rule", "kind", "source", "target" | "nodes", "existing"}]}`.

## 검사 훅이 막는 것

| 언제 | 무엇을 | 사람이 꼭 넘겨야 할 때 |
|---|---|---|
| 커밋 | 잠금/규칙과 다른 작성자, 계정이 정해지지 않은 관리 서버 저장소 | `GITSW_SKIP=identity` |
| 커밋 | 비밀값(개인키, ghp_/github_pat_, glpat-, AKIA, xox?, sk-ant-, sk-, sk_live_, npm_), `.env`·`*.p12`·`*.jks`·SSH 키 파일 | 줄에 `gitsw:allow`, 또는 `GITSW_SKIP=secrets` |
| 커밋 | `maxFileMB`(기본 50MB) 이상 파일 (`warnFileMB` 이상은 경고) | `GITSW_SKIP=bigfile` |
| push | 별칭 없는 주소 / 다른 계정 별칭 | `GITSW_SKIP=identity` |
| push | 강제 push(기존 원격 커밋 덮어쓰기) | `gitch p --force` |
| push | push 할 새 커밋 중 커미터가 이 계정이 아니거나 작성자가 '다른 내 계정' | `gitch fix --yes` 로 고치기 |
| push | 기본/보호 브랜치 삭제, 보호 브랜치(`gitch protect`) 직접 push | `GITSW_SKIP=protect` |
| push | 폴더 허용 목록(`allowRemote`) 밖으로 push | `GITSW_SKIP=remote` |
| 커밋 메시지 | 계정 정책 `aiTrailer = strip` 이면 `Co-Authored-By: Claude` 같은 줄 제거 | — |

- `gitch.ignore` 로 저장소를 검사에서 뺄 수 있다: `gitch ignore` / `gitch ignore --off`.
- `user.useConfigOnly=true` 를 켜서, 규칙 밖 저장소에서 `me@컴퓨터이름` 같은 엉뚱한 작성자로 커밋되지 않게 한다.
- 설정 파일이 깨지면 커밋을 막지 않고 경고만 한다 (`gitch doctor` 로 확인).
- gitch 를 찾지 못하면(앱을 지웠거나 옮김) 커밋 · push 는 막지 않고 `[gitch] ~/bin/gitch 를 찾을 수 없어 검사를 건너뜁니다` 한 줄로 알린다. 훅 연결 스크립트는 gitch 가 바뀌면 다음 훅 실행 때 스스로 새로 쓴다.
- `--no-verify` 는 git 자체 기능이라 훅으로 막을 수 없다. AI 는 Claude 훅이 막는다.

## AI 연동

`gitch install`(또는 `gitch ai`)이 만든다.

- `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`(, `~/.gemini/GEMINI.md`) 에 규칙 블록
- `~/.claude/skills/gitch/SKILL.md`, `~/.codex/skills/gitch/SKILL.md` 스킬
- `~/.claude/settings.json`
  - PreToolUse 훅 `gitch guard --claude`: Bash 명령과 Edit/Write 대상 파일을 검사
    - 거부: `--no-verify`, `git push --force/+refspec`, `GITSW_*`/`GIT_AUTHOR_*`/`GIT_SSH_COMMAND` 환경변수, `git -c user.*|core.hooksPath|hook.*|url.*`, 전역 git 설정 쓰기, 작성자/원격 설정 쓰기, `~/.ssh`·`~/.gitconfig`·`~/.config/gitsw`·`.git/hooks` 수정, 관리 서버 저장소의 `git clone`(→ `gitch clone`), `gitch add/remove/setup/sign on|off/import`
    - 확인 창: push·PR 생성(아래 push 정책), 원격 브랜치 삭제, `reset --hard`, `clean -f`, `checkout -- 파일`, `restore`, `branch -D`, `stash drop`, `remote add/set-url`, `gitch unlock`, 잠긴 저장소를 다른 계정으로 `gitch use`, `gitch undo/amend/fix --yes/abort/rescue --restore`, gitch 설정 변경
  - 자동 허용: 읽기 명령(`gitch ck/status/preflight/l/d/doctor/...`, `git status/diff/log/show/...`)과 일상 명령(`git add`, `gitch c/cp/p/pl/up/b/wt/clone/pr`, `git commit/push/pull/branch/switch/checkout/restore/stash/remote`).
    위험한 옵션은 위의 훅이 먼저 거부하거나 확인을 받으므로, 자동 허용이어도 그대로 지켜진다.
- push 정책 (`gitsw.aiPush`)
  - `branch` (권장): 작업 브랜치 push 는 확인 없이, **main/master/원격 기본 브랜치/보호 브랜치(`gitch protect`) push 와 PR/MR 생성만 확인**. 어느 브랜치로 가는지 모르면(detached 등) 확인. 태그 push 도 확인.
  - `ask` (기본값): push·PR 생성마다 확인
  - `allow`: 확인 없음 (검사 훅은 그대로)
  - 바꾸기: `gitch config set gitsw.aiPush branch` — AI 규칙과 Claude 설정도 같이 갱신된다.
- 실행 주체는 환경변수(`CLAUDECODE`, Codex 샌드박스 변수, `AI_AGENT` 등)로 구분해 `gitch report` 에 남는다. 터미널(TTY)이면 사람으로 본다.
- 비대화형(AI)에서 `gitch c` 는 스테이지된 파일만 커밋한다 (모두 올리려면 `-a`).

지우기: `gitch ai --remove`.

## 설정 파일 (`~/.config/gitsw/config`)

git config 형식이다. `gitch config set|add|unset <키> <값>` 으로 바꾸면 바꾼 뒤 검사하고, 틀리면 되돌린다.

```ini
[gitsw]
	scanRoot = ~/Develop
	aiPush = branch         # ask(매번 확인) | branch(main/보호 브랜치 push 와 PR 만 확인) | allow
	maxFileMB = 50
	warnFileMB = 10
	sshStrict = false       # true 면 별칭 없는 github.com 등은 SSH 키 인증 안 함 (공개 저장소 SSH clone 도 막힘)
[account "alice"]
	email = alice@example.com
	host = github.com
[account "carol"]
	email = carol@corp.example
	host = gitlab.example.com:2222
	aiTrailer = keep        # strip 이면 이 계정 커밋에서 AI 표기 줄 제거
[folder "~/Develop/corp"]
	account = carol
	allowRemote = gitlab.example.com/*
	allowRemote = github.com/acme/*
[org "github.com/acme"]
	account = alice
```

고급: `host = github.com via 다른계정` — 이 계정의 신원(이메일)으로 커밋하지만 GitHub 접속은 다른 계정의 SSH 키/로그인을 빌려 쓴다.

## GitHub CLI / PR

- PR 은 `gh auth token --user <계정>` 으로 그 계정 토큰만 꺼내 쓴다. `gh auth switch` 처럼 전역 계정을 바꾸지 않아서 여러 AI 세션이 동시에 일해도 꼬이지 않는다.
- 계정마다 한 번씩 사용자가 직접 로그인해야 한다: `gh auth login --hostname github.com`
- GitLab MR 은 push 옵션(`-o merge_request.create`)으로 만든다. 토큰이나 glab 이 필요 없다 (새 커밋이 있어야 함, 설명은 한 줄로 합쳐짐).
- 새 저장소 올리기: `gitch publish [이름] [--public] [--description 설명]` — GitHub 은 그 계정 토큰으로 저장소를 만들고, GitLab 은 push 하면 비공개 프로젝트가 생긴다.

## 파일 위치

| 파일 | 내용 |
|---|---|
| `~/.config/gitsw/config` | 설정 |
| `~/.local/state/gitsw/actions.jsonl` | 작업 기록 (`gitch report`) |
| `~/.local/state/gitsw/backups/` | gitch 가 고치기 전 파일 백업 (내용이 바뀐 것만, 날짜 폴더 최근 30개. 다른 이름의 폴더는 지우지 않음) |
| `~/.local/share/gitsw/hook` | git 훅 연결 스크립트 (gitch 가 없으면 막지 않고 커밋 · push 때 한 줄로 알림) |
| `refs/gitsw/backup/*` (저장소 안) | `gitch rescue` 백업 (최근 30개, push 안 됨) |
| `~/.local/share/gitch/gitch` | 앱 없이 받은 gitch (`install.sh`, `gitch self-update`) |

## (선택) push 를 Touch ID 로 승인하기

AI 의 push 마다 손가락 승인을 받고 싶다면 하드웨어 키(Secretive, 1Password SSH 에이전트)로 push 전용 키를 만들어 `pushurl` 만 그 키를 쓰게 한다. fetch/pull 은 지금 키 그대로라 불편이 적다.

1. Secretive(또는 1Password)에서 "사용할 때마다 확인" 키를 만들고 공개키를 GitHub 계정에 추가
2. `~/.ssh/config` 에 `Host github-<계정>-push` (HostName github.com, IdentityAgent 는 그 앱의 소켓)
3. 저장소에서 `git config remote.origin.pushurl git@github-<계정>-push:<owner>/<repo>.git`
   (gitch 검사 훅은 push 주소 별칭이 계정 별칭과 같아야 통과하므로, 이 방식을 쓰면 해당 저장소는 `gitch ignore` 하거나 별칭 규칙을 맞춰야 한다 — 필요해지면 gitch 에 기능으로 추가)

## 개발 / 테스트

```bash
tools/gitch/tests/run.sh             # 전체 (실제 ~/.gitconfig, ~/.ssh, ~/.claude 는 건드리지 않음: 임시 HOME + 가짜 ssh/gh/curl/원격)
tools/gitch/tests/run.sh -k guard    # 이름에 guard 가 들어간 테스트만
shellcheck -s bash -S warning tools/gitch/gitch tools/gitch/install.sh
```

GitHub Actions 「macOS」의 gitch 테스트가 `tools/gitch/**` 를 바꾼 PR 마다 macOS 기본 bash 3.2 로, 「Windows」가 Git Bash 로 돈다(Windows 전용은 `tests/test_windows.sh`, 가짜 PowerShell 로 실제 사용자 PATH 는 건드리지 않음).

## 제거

`gitch uninstall` — 자동 규칙, 검사 훅, AI 연동, 터미널 연동을 지운다. 설정 파일, SSH 키, 저장소별 잠금, `user.useConfigOnly` 는 남긴다.
