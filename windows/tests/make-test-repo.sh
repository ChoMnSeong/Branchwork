#!/usr/bin/env bash
# 자동 점검용 저장소: 브랜치·머지·태그가 있는 작은 기록
set -euo pipefail
R="$1"
rm -rf "$R"
mkdir -p "$R"
cd "$R"
git init -q -b main
git config user.name "Self Test"
git config user.email "selftest@example.com"
git config core.autocrlf false
echo "# demo" > README.md
git add . && git commit -qm "첫 커밋"
for i in 1 2 3; do echo "line $i" >> app.txt; git add . && git commit -qm "기능 $i 추가"; done
git tag v0.1
git switch -q -c feature/old
echo "old" > old.txt; git add . && git commit -qm "예전 기능"
git switch -q main
echo "main" >> app.txt; git add . && git commit -qm "main 작업"
git merge -q --no-ff -m "Merge branch 'feature/old'" feature/old
git switch -q -c feature/login
echo "login" > login.txt; git add . && git commit -qm "로그인 화면 추가 (login)"
echo "check" >> login.txt; git add . && git commit -qm "로그인 검증"
git switch -q main
echo "fix" > fix.txt; git add . && git commit -qm "버그 수정"
echo "ok: $R"
