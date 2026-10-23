# shellcheck shell=bash disable=SC2088  # 화면에 보이는 ~ 를 그대로 비교
# 앱 없이 쓰는 gitch: tools/gitch/install.sh 와 따로 받은 gitch 의 self-update (가짜 curl 이 GitHub 릴리스를 흉내 낸다)

RELEASES_API="api.github.com/repos/Gitrochi/Gitrochi/releases"

# 가짜 릴리스 하나 — 나중에 만든 것이 목록 맨 앞(가장 새 것)
#   $1 태그  $2 gitch 로 올릴 파일(- 이면 gitch 없이: Windows 만 고친 릴리스처럼)  [$3 prerelease | badsum]
mk_release() {
  local tag="$1" src="$2" opt="${3:-}" dl="$FAKE_WEB/github.com/Gitrochi/Gitrochi/releases/download/$1" f assets="" sep="" n=0
  mkdir -p "$dl" "$FAKE_WEB/rel" "$FAKE_WEB/${RELEASES_API%/*}"
  echo setup > "$dl/Gitrochi_${tag#v}_x64-setup.exe"
  if [ "$src" != - ]; then
    cp "$src" "$dl/gitch"
    (cd "$dl" && shasum -a 256 gitch > gitch.sha256)
    [ "$opt" = badsum ] && printf '%064d  gitch\n' 0 > "$dl/gitch.sha256"
  fi
  for f in "$dl"/*; do
    assets="$assets$sep
      {
        \"name\": \"${f##*/}\",
        \"browser_download_url\": \"https://github.com/Gitrochi/Gitrochi/releases/download/$tag/${f##*/}\"
      }"
    sep=","
  done
  while [ -e "$FAKE_WEB/rel/$n" ]; do n=$((n+1)); done
  cat > "$FAKE_WEB/rel/$n" <<EOF
  {
    "url": "https://api.github.com/repos/Gitrochi/Gitrochi/releases/$n",
    "tag_name": "$tag",
    "name": "Gitrochi ${tag#v}",
    "draft": false,
    "prerelease": $([ "$opt" = prerelease ] && echo true || echo false),
    "assets": [$assets
    ],
    "body": "notes, \"browser_download_url\": \"https://example.com/x/gitch\""
  }
EOF
  sep=""
  {
    echo "["
    while [ $n -ge 0 ]; do printf '%s' "$sep"; cat "$FAKE_WEB/rel/$n"; sep=","; n=$((n-1)); done
    echo "]"
  } > "$FAKE_WEB/$RELEASES_API"
}

gitch_ver() { sed -n 's/^GITSW_VERSION="\([^"]*\)".*/\1/p' "$1" | head -1; }
with_version() { sed "s/^GITSW_VERSION=.*/GITSW_VERSION=\"$1\"/" "$GITSW_SRC" > "$2"; }   # $1 버전 $2 만들 파일
only_gitch_in() { [ "$(ls -A "$1")" = gitch ] || fail "임시 파일이 남음: $(ls -A "$1" | tr '\n' ' ')"; }

standalone_copy() {   # 설치기가 두는 자리에 이 gitch 를 두고 ~/bin/gitch 를 거기로
  mkdir -p "$HOME/.local/share/gitch"
  cp "$GITSW_SRC" "$HOME/.local/share/gitch/gitch"
  ln -sfn "$HOME/.local/share/gitch/gitch" "$HOME/bin/gitch"
}

test_installer_installs_release_gitch_without_running_install() {
  local d="$HOME/.local/share/gitch"
  with_version 9.9.9 "$T/new"
  mk_release v0.3.7 "$T/new"
  run sh -c 'cat "$0" | bash' "$ROOT/install.sh"; assert_ok   # README 처럼 curl … | bash
  cmp -s "$d/gitch" "$T/new" || fail "릴리스의 gitch 가 설치되지 않음"
  [ -x "$d/gitch" ] || fail "실행 권한 없음"
  only_gitch_in "$d"
  assert_out "gitch 9.9.9 (v0.3.7) 를 설치했습니다: ~/.local/share/gitch/gitch"
  assert_out "~/.local/share/gitch/gitch add"
  assert_out "~/.local/share/gitch/gitch install"
  # gitch install 은 사용자가 직접 — 설치기는 ~/.zshrc · ~/.gitconfig · ~/.claude · ~/bin 을 건드리지 않는다
  [ ! -e "$HOME/.zshrc" ] || fail "~/.zshrc 를 바꿈"
  [ -z "$(git config --global --get-regexp '^hook\.gitsw-')" ] || fail "전역 검사 훅을 설치함"
  [ -z "$(ls -A "$HOME/.claude")" ] || fail "~/.claude 를 바꿈"
  [ "$(resolve_path "$HOME/bin/gitch")" = "$(resolve_path "$GITSW_SRC")" ] || fail "~/bin/gitch 를 바꿈"
  # 계정이 있으면 add 는 빼고 안내
  mk_config
  run bash "$ROOT/install.sh"; assert_ok; assert_out "이미 최신입니다: gitch 9.9.9 (v0.3.7)"
  assert_no_out "gitch add"; assert_out "~/.local/share/gitch/gitch install"
  [ ! -e "$HOME/.zshrc" ] && [ -z "$(git config --global --get-regexp '^hook\.gitsw-')" ] || fail "계정이 있다고 gitch install 을 실행함"
  # 이미 ~/bin/gitch 가 이 파일이면 바로 쓰인다
  ln -sfn "$d/gitch" "$HOME/bin/gitch"
  run bash "$ROOT/install.sh"; assert_ok; assert_out "바로 쓰입니다"; assert_no_out "다음은 터미널에서 직접"
}

test_installer_refuses_to_overwrite_other_files() {
  local d="$HOME/.local/share/gitch"
  with_version 9.9.9 "$T/new"
  mk_release v0.3.7 "$T/new"
  mkdir -p "$d"; echo "my notes" > "$d/gitch"
  run bash "$ROOT/install.sh"; assert_fail; assert_out "gitch 가 아닌 파일"
  assert_eq "$(cat "$d/gitch")" "my notes" "gitch 가 아닌 파일을 덮어씀"
  rm "$d/gitch"; ln -s "$GITSW_SRC" "$d/gitch"
  run bash "$ROOT/install.sh"; assert_fail; assert_out "링크"
  [ -L "$d/gitch" ] || fail "링크를 덮어씀"
  rm "$d/gitch"; mkdir "$d/gitch"
  run bash "$ROOT/install.sh"; assert_fail; assert_out "gitch 가 아닌 파일"
  [ -d "$d/gitch" ] || fail "폴더를 덮어씀"
  [ ! -e "$FAKE_WEB/log" ] || fail "덮어쓸 수 없는데 받음: $(cat "$FAKE_WEB/log")"
}

test_installer_checks_sha256_and_replaces_older_gitch() {
  local d="$HOME/.local/share/gitch"
  mkdir -p "$d"; with_version 2.0.0 "$d/gitch"
  with_version 9.9.9 "$T/new"
  mk_release v0.3.7 "$T/new" badsum
  run bash "$ROOT/install.sh"; assert_fail; assert_out "SHA-256"
  assert_eq "$(gitch_ver "$d/gitch")" 2.0.0 "SHA-256 이 틀렸는데 바꿈"
  only_gitch_in "$d"
  mk_release v0.3.8 "$T/new"
  run bash "$ROOT/install.sh"; assert_ok; assert_out "gitch 2.0.0 → 9.9.9 (v0.3.8)"
  cmp -s "$d/gitch" "$T/new" || fail "바뀌지 않음"
  only_gitch_in "$d"
  echo '<html>Not Found</html>' > "$T/html"
  mk_release v0.3.9 "$T/html"
  run bash "$ROOT/install.sh"; assert_fail; assert_out "gitch 가 아닙니다"
  cmp -s "$d/gitch" "$T/new" || fail "gitch 가 아닌 파일로 바꿈"
  only_gitch_in "$d"
}

test_installer_picks_newest_release_with_gitch() {
  run bash "$ROOT/install.sh"; assert_fail; assert_out "릴리스 목록을 받지 못했습니다"
  mk_release v0.3.6 -
  run bash "$ROOT/install.sh"; assert_fail; assert_out "gitch 가 든 릴리스가 아직 없습니다"
  [ ! -e "$HOME/.local/share/gitch/gitch" ] || fail "릴리스가 없는데 설치함"
  with_version 9.9.9 "$T/new"; with_version 9.9.10 "$T/pre"
  mk_release v0.3.7 "$T/new"
  mk_release v0.3.8 -                    # Windows 만 고친 릴리스
  mk_release v0.3.9 "$T/pre" prerelease
  assert_json "$(cat "$FAKE_WEB/$RELEASES_API")" "가짜 릴리스 목록이 JSON 이 아님"
  run bash "$ROOT/install.sh"; assert_ok; assert_out "gitch 9.9.9 (v0.3.7)"
  cmp -s "$HOME/.local/share/gitch/gitch" "$T/new" || fail "gitch 가 든 가장 새 정식 릴리스가 아님"
}

test_self_update_replaces_standalone_copy() {
  local d="$HOME/.local/share/gitch" cur
  cur=$(gitch_ver "$GITSW_SRC")
  standalone_copy
  git init -q "$HOME"   # 홈 폴더를 git 으로 관리해도 gitch 를 올리지 않았으면 따로 받은 것
  with_version 9.9.9 "$T/new"; with_version 9.9.10 "$T/pre"
  mk_release v0.3.7 "$T/new"
  mk_release v0.3.8 -                    # Windows 만 고친 릴리스
  mk_release v0.3.9 "$T/pre" prerelease
  run gitch self-update; assert_ok; assert_out "gitch $cur → 9.9.9 (v0.3.7): ~/.local/share/gitch/gitch"
  cmp -s "$d/gitch" "$T/new" || fail "바뀌지 않음"
  [ -x "$d/gitch" ] || fail "실행 권한 없음"
  [ -L "$HOME/bin/gitch" ] || fail "~/bin/gitch 링크가 사라짐"
  only_gitch_in "$d"
  run gitch version; assert_out "gitch 9.9.9"
  run gitch self-update; assert_ok; assert_out "이미 최신입니다: gitch 9.9.9 (v0.3.7)"
  grep -q '"event":"self-update"' "$HOME/.local/state/gitsw/actions.jsonl" || fail "작업 기록 없음"
}

test_self_update_refuses_bad_or_older_release() {
  local d="$HOME/.local/share/gitch"
  standalone_copy
  with_version 9.9.9 "$T/new"
  mk_release v0.3.7 "$T/new" badsum
  run gitch self-update; assert_fail; assert_out "SHA-256"
  cmp -s "$d/gitch" "$GITSW_SRC" || fail "SHA-256 이 틀렸는데 바꿈"
  only_gitch_in "$d"
  with_version 0.0.1 "$T/old"
  mk_release v0.3.8 "$T/old"
  run gitch self-update; assert_ok; assert_out "그대로 뒀습니다"
  cmp -s "$d/gitch" "$GITSW_SRC" || fail "더 낮은 버전으로 바꿈"
  echo '<html>Not Found</html>' > "$T/html"
  mk_release v0.3.9 "$T/html"
  run gitch self-update; assert_fail; assert_out "gitch 가 아닙니다"
  cmp -s "$d/gitch" "$GITSW_SRC" || fail "gitch 가 아닌 파일로 바꿈"
  only_gitch_in "$d"
}

test_self_update_leaves_app_and_repo_copies() {
  local app="$T/Gitrochi.app/Contents/Resources" repo="$T/checkout"
  with_version 9.9.9 "$T/new"
  mk_release v0.3.7 "$T/new"
  mkdir -p "$app" "$repo/tools/gitch"
  cp "$GITSW_SRC" "$app/gitch"
  run "$app/gitch" self-update; assert_ok; assert_out "앱과 함께 업데이트"
  cmp -s "$app/gitch" "$GITSW_SRC" || fail "앱에 든 gitch 를 바꿈"
  # 저장소에 든 gitch 는 그 저장소로 바뀐다 (진짜 tools/gitch/gitch 대신 임시 저장소로 확인)
  git init -q "$repo"; cp "$GITSW_SRC" "$repo/tools/gitch/gitch"; git -C "$repo" add tools/gitch/gitch
  run "$repo/tools/gitch/gitch" self-update; assert_ok; assert_out "앱과 함께 업데이트"
  cmp -s "$repo/tools/gitch/gitch" "$GITSW_SRC" || fail "저장소의 gitch 를 바꿈"
  [ ! -e "$FAKE_WEB/log" ] || fail "릴리스를 받음: $(cat "$FAKE_WEB/log")"
}
