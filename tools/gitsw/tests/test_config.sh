# shellcheck shell=bash
# 설정 파일 / 계정 해석 / v1 옮기기

test_config_check_and_list() {
  mk_config
  run gitsw config check; assert_ok; assert_out "계정 3개"
  run gitsw list --json; assert_ok; assert_json "$OUT"
  assert_eq "$(printf '%s' "$OUT" | jq -r '.accounts[].id' | tr '\n' ' ')" "alice bob carol "
  assert_eq "$(printf '%s' "$OUT" | jq -r '.accounts[2].hosts')" "gitlab.example.com(포트 2222)"
}

test_config_errors_reported() {
  mkdir -p "$HOME/.config/gitsw"
  cat > "$HOME/.config/gitsw/config" <<'EOF'
[account "alice"]
	host = github.com
[account "bad name"]
	email = x@y
	host = github.com
[account "dave"]
	email = d@x
	host = github.com via nobody
[org "github.com/zzz"]
	account = ghost
[gitsw]
	aiPush = sometimes
EOF
  run gitsw config check; assert_fail
  assert_out "account.alice.email 이 없습니다"
  assert_out "'bad name'"
  assert_out "via nobody"
  assert_out "없는 계정 'ghost'"
  assert_out "aiPush"
  run gitsw status; assert_ok "설정이 틀려도 status 는 동작"
  run gitsw scan; assert_fail; assert_out "설정 파일에 문제가 있습니다"
}

test_config_set_validates_and_rolls_back() {
  mk_config
  run gitsw config set account.alice.aiTrailer bogus --yes; assert_fail; assert_out "되돌렸습니다"
  run gitsw config get account.alice.aiTrailer; assert_eq "$OUT" ""
  run gitsw config set account.alice.aiTrailer strip --yes; assert_ok
  run gitsw config get account.alice.aitrailer; assert_eq "$OUT" "strip"
  run gitsw config set gitsw.aiPush allow; assert_rc 2 "--yes 없으면 확인 필요(2)"
}

test_via_binding_uses_login_alias() {
  mk_config
  git config -f "$HOME/.config/gitsw/config" account.dave.email dave@corp.example
  git config -f "$HOME/.config/gitsw/config" --add account.dave.host "github.com via alice"
  git config -f "$HOME/.config/gitsw/config" org.github.com/daveorg.account dave
  run gitsw config check; assert_ok
  run gitsw list; assert_out "github.com(로그인 alice)"
  mk_remote_seeded github-alice daveorg/app
  run gitsw clone https://github.com/daveorg/app "$T/app"; assert_ok
  assert_eq "$(git -C "$T/app" config user.email)" "dave@corp.example"
  assert_eq "$(git -C "$T/app" config remote.origin.url)" "git@github-alice:daveorg/app.git"
  assert_eq "$(git -C "$T/app" config gitswitch.alias)" "github-alice"
  cd "$T/app" && run gitsw status; assert_out "PUSH_ACCOUNT=dave"; assert_out "PUSH_LOGIN=alice"
}

test_resolve_rules_order() {
  mk_config
  install_quiet
  # 조직 규칙(teamb→bob)이 폴더 기본(alice)보다 우선
  mk_repo "$HOME/Develop/alice/x" "git@github-bob:teamb/x.git"
  cd "$HOME/Develop/alice/x" && run gitsw status --json; assert_json "$OUT"
  assert_eq "$(printf '%s' "$OUT" | jq -r .derivedAccount)" "bob"
  # 소유자 = 내 계정
  mk_repo "$HOME/Develop/bob/y" "https://github.com/alice/y.git"
  cd "$HOME/Develop/bob/y" && run gitsw status --json
  assert_eq "$(printf '%s' "$OUT" | jq -r .derivedAccount)" "alice"
  # 회사 GitLab: 서버에 계정이 하나뿐
  mk_repo "$T/z" "https://gitlab.example.com/grp/sub/z.git"
  cd "$T/z" && run gitsw status --json
  assert_eq "$(printf '%s' "$OUT" | jq -r .derivedAccount)" "carol"
  # 원격 없음 + 폴더
  mk_repo "$HOME/Develop/corp/norem"
  cd "$HOME/Develop/corp/norem" && run gitsw status --json
  assert_eq "$(printf '%s' "$OUT" | jq -r .derivedAccount)" "carol"
}
