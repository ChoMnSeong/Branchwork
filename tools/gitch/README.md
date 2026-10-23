# gitch

여러 Git 계정(GitHub 개인 계정들 + 회사 GitLab)을 한 컴퓨터에서 섞이지 않게 쓰기 위한 도구.
사람이 터미널에서 쓰는 것과 AI(Claude Code, Codex 등)가 쓰는 것을 모두 고려했다.
Gitrochi 맥 앱에 함께 들어 있다(`Gitrochi.app/Contents/Resources/gitch`). MIT 라이선스(저장소 [LICENSE](../../LICENSE)) · © 2026 jjunhaa0211.

- 저장소마다 계정을 **잠그고**, 커밋/push 할 때 작성자·push 주소를 검사한다.
- 폴더 / GitHub 조직 / 주소로 **계정을 자동으로 고른다**.
- 비밀값·큰 파일·강제 push·다른 계정 커밋을 **git 훅에서 막는다** (어떤 도구로 git 을 써도 적용).
- AI 에게는 규칙(CLAUDE.md/AGENTS.md), 스킬, Claude Code 명령 검사 훅을 깔아 준다.
- macOS 기본 bash 3.2 + git 만으로 동작한다 (jq 는 Claude 훅/JSON 요약에만 사용).

## 설치

**Gitrochi 에서** — 설정 > CLI
1. 계정이 없으면 **Terminal 에서 계정 추가** → `gitch add` 가 아이디·이메일·서버를 묻고 SSH 키를 만든다.
2. **설치** → 무엇이 바뀌는지 보여 준 뒤 `gitch install` 을 실행한다(`~/bin/gitch` 가 앱 안의 gitch 를 가리키므로 앱을 업데이트하면 gitch 도 같이 바뀐다).
3. 새 터미널을 연다. 저장소 화면의 커밋 칸 위에 이 저장소의 계정(잠금)과 커밋·push 전 점검(`gitch preflight`)이 보이고, 계정 이름을 눌러 이 저장소의 계정을 바꾼다(`gitch use`).

**직접**

```bash
tools/gitch/gitch add          # 계정 추가 (터미널에서 사용자가 직접)
tools/gitch/gitch org add github.com/<조직> <계정>   # (선택) 조직 → 계정 규칙
tools/gitch/gitch install      # ~/bin/gitch 연결, 자동 규칙, 검사 훅, AI 연동, 터미널 연동
source ~/.zshrc
gitch doctor
```

새 컴퓨터: `gitch import <내보낸 설정>` → `gitch install` → `gitch setup` (SSH 키 생성·등록).

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

`gitch help` 에 전체 명령이 있다. `--json` 은 status / ck / preflight / scan / doctor / list / audit / report 에 있다.

종료코드: 0 정상, 1 문제/실패, 2 사용자 확인 필요(`--yes`), 3 커밋할 것 없음, 4 올릴 파일을 고르지 않음(비대화형).

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
| `~/.local/share/gitsw/hook` | git 훅 연결 스크립트 (gitch 가 없으면 아무것도 안 함) |
| `refs/gitsw/backup/*` (저장소 안) | `gitch rescue` 백업 (최근 30개, push 안 됨) |

## (선택) push 를 Touch ID 로 승인하기

AI 의 push 마다 손가락 승인을 받고 싶다면 하드웨어 키(Secretive, 1Password SSH 에이전트)로 push 전용 키를 만들어 `pushurl` 만 그 키를 쓰게 한다. fetch/pull 은 지금 키 그대로라 불편이 적다.

1. Secretive(또는 1Password)에서 "사용할 때마다 확인" 키를 만들고 공개키를 GitHub 계정에 추가
2. `~/.ssh/config` 에 `Host github-<계정>-push` (HostName github.com, IdentityAgent 는 그 앱의 소켓)
3. 저장소에서 `git config remote.origin.pushurl git@github-<계정>-push:<owner>/<repo>.git`
   (gitch 검사 훅은 push 주소 별칭이 계정 별칭과 같아야 통과하므로, 이 방식을 쓰면 해당 저장소는 `gitch ignore` 하거나 별칭 규칙을 맞춰야 한다 — 필요해지면 gitch 에 기능으로 추가)

## 개발 / 테스트

```bash
tools/gitch/tests/run.sh             # 전체 (실제 ~/.gitconfig, ~/.ssh, ~/.claude 는 건드리지 않음: 임시 HOME + 가짜 ssh/gh/원격)
tools/gitch/tests/run.sh -k guard    # 이름에 guard 가 들어간 테스트만
shellcheck -s bash -S warning tools/gitch/gitch
```

GitHub Actions 「macOS」의 gitch 테스트가 `tools/gitch/**` 를 바꾼 PR 마다 macOS 기본 bash 3.2 로 돈다.

## 제거

`gitch uninstall` — 자동 규칙, 검사 훅, AI 연동, 터미널 연동을 지운다. 설정 파일, SSH 키, 저장소별 잠금, `user.useConfigOnly` 는 남긴다.
