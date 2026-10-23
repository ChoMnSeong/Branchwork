#!/usr/bin/env bash
set -euo pipefail

# 맥 업데이트 서명 열쇠(Ed25519) 관리 — 릴리스를 만드는 사람이 한 번만 한다.
#   macos/Tools/updatekey.sh new      새 열쇠: 비밀키는 이 맥의 로그인 키체인에, 공개키는 Resources/Info.plist(BWUpdatePublicKey)에
#   macos/Tools/updatekey.sh export   비밀키 출력 — Actions 비밀 값으로 넣을 때:
#                                     macos/Tools/updatekey.sh export | gh secret set BRANCHWORK_UPDATE_KEY -R ChoMnSeong/Branchwork
# 비밀키를 잃어버리면 이미 깔린 앱은 새 버전을 설치하지 않는다(직접 받아 설치해야 함). 비밀번호 관리자 등에 따로 보관해 둘 것.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$ROOT/Resources/Info.plist"
SERVICE="Branchwork update signing key"
TOOL="$ROOT/.build/updatesign"

build_tool() {
    if [[ ! -x "$TOOL" || "$ROOT/Tools/updatesign.swift" -nt "$TOOL" ]]; then
        mkdir -p "$ROOT/.build"
        swiftc -O "$ROOT/Tools/updatesign.swift" -o "$TOOL"
    fi
}

case "${1:-}" in
new)
    if /usr/libexec/PlistBuddy -c 'Print BWUpdatePublicKey' "$PLIST" >/dev/null 2>&1; then
        echo "이미 공개키가 있습니다(Info.plist BWUpdatePublicKey). 바꾸면 이미 깔린 앱이 새 버전을 설치하지 못합니다." >&2
        exit 1
    fi
    if security find-generic-password -s "$SERVICE" >/dev/null 2>&1; then
        echo "키체인에 이미 '$SERVICE' 가 있습니다. 공개키만 다시 넣으려면 키체인 접근에서 확인하세요." >&2
        exit 1
    fi
    build_tool
    KEYS="$("$TOOL" keygen)"
    SECRET="$(sed -n 1p <<<"$KEYS")"
    PUBLIC="$(sed -n 2p <<<"$KEYS")"
    security add-generic-password -s "$SERVICE" -a "$USER" -w "$SECRET"
    /usr/libexec/PlistBuddy -c "Add :BWUpdatePublicKey string $PUBLIC" "$PLIST"
    echo "✅ 비밀키: 로그인 키체인 '$SERVICE'"
    echo "✅ 공개키: $PLIST (BWUpdatePublicKey) — 커밋하세요"
    echo "   Actions 에 넣기: $0 export | gh secret set BRANCHWORK_UPDATE_KEY -R ChoMnSeong/Branchwork"
    ;;
export)
    security find-generic-password -s "$SERVICE" -w
    ;;
*)
    echo "사용법: $0 new | export" >&2
    exit 1
    ;;
esac
