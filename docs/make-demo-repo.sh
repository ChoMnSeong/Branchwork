#!/usr/bin/env bash
# README 스크린샷용 데모 저장소: 가상의 쇼핑몰 웹 프로젝트(작성자·내용 모두 지어낸 것)
#   docs/make-demo-repo.sh <폴더>  →  <폴더>/shop-web (작업 저장소), <폴더>/origin.git (원격)
# 맥 bash 3.2 · Git Bash(Windows) 모두에서 돈다.
set -euo pipefail
ROOT="$1"
rm -rf "$ROOT"; mkdir -p "$ROOT"
git init -q --bare "$ROOT/origin.git"
R="$ROOT/shop-web"
git init -q -b main "$R"; cd "$R"
git config core.autocrlf false
# 이 저장소에서 만드는 모든 커밋(머지 포함)은 지어낸 작성자로
git config user.name "김하늘"; git config user.email "haneul@example.com"
git remote add origin "$ROOT/origin.git"
T=$(( $(date +%s) - 21 * 86400 ))
as() { # as "이름" email "메시지" — 작성 시각을 조금씩 뒤로
  T=$((T + 3600 * (3 + RANDOM % 9)))
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
  GIT_AUTHOR_DATE="@$T +0900" GIT_COMMITTER_DATE="@$T +0900" git commit -qm "$3"
}
HA="김하늘"; HAE="haneul@example.com"
DY="이도윤"; DYE="doyun@example.com"
SY="박서연"; SYE="seoyeon@example.com"
MJ="최민준"; MJE="minjun@example.com"
mg() { # mg "이름" email 브랜치 — 머지 커밋도 지어낸 작성자·시각으로
  T=$((T + 3600 * 2))
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2"   GIT_AUTHOR_DATE="@$T +0900" GIT_COMMITTER_DATE="@$T +0900" git merge -q --no-ff "$3" -m "Merge branch '$3'"
}
w() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" >> "$1"; git add "$1"; }

w README.md "# shop-web"; w package.json '{ "name": "shop-web", "version": "1.0.0" }'; as "$HA" $HAE "Chore: 프로젝트 시작"
w src/app.tsx "export function App() {}"; as "$HA" $HAE "Feat: 기본 레이아웃과 라우팅"
w src/pages/products.tsx "export function Products() {}"; as "$DY" $DYE "Feat: 상품 목록 화면"
w src/pages/product.tsx "export function Product() {}"; as "$DY" $DYE "Feat: 상품 상세 화면"
w src/api/client.ts "export const api = {}"; as "$SY" $SYE "Feat: API 클라이언트와 오류 처리"
mkdir -p src/cart; cat > src/cart/store.ts <<'TS'
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export const cart: CartItem[] = [];

export function add(item: CartItem) {
  const found = cart.find((c) => c.productId === item.productId);
  if (found) found.quantity += item.quantity;
  else cart.push(item);
}

export function total() {
  return cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
}
TS
git add src/cart/store.ts; as "$HA" $HAE "Feat: 장바구니 담기·수량 변경"
git tag -a v1.0.0 -m "1.0.0"
git push -q origin main --tags

git switch -q -c feature/checkout
w src/checkout/page.tsx "export function Checkout() {}"; as "$SY" $SYE "Feat: 주문서 화면"
mkdir -p src/checkout; cat > src/checkout/payment.ts <<'TS'
import { api } from "../api/client";

export interface PaymentRequest {
  orderId: string;
  amount: number;
  cardToken: string;
}

/** 카드 결제 */
export async function pay(req: PaymentRequest) {
  return api.post("/payments", req);
}
TS
git add src/checkout/payment.ts; as "$SY" $SYE "Feat: 카드 결제 연동"
w src/checkout/coupon.ts "export function coupon() {}"; as "$SY" $SYE "Feat: 쿠폰 적용"

git switch -q main
git switch -q -c fix/login-timeout
w src/auth/session.ts "export const TIMEOUT = 30"; as "$MJ" $MJE "Fix: 로그인 세션이 5분 만에 끊기던 문제"
git switch -q main
w src/pages/products.tsx "// 정렬"; as "$DY" $DYE "Feat: 상품 정렬(가격·인기순)"
mg "$MJ" $MJE fix/login-timeout
w src/pages/products.tsx "// 필터"; as "$DY" $DYE "Feat: 카테고리 필터"
git switch -q feature/checkout
cat > src/checkout/payment.ts <<'TS'
import { api } from "../api/client";

export interface PaymentRequest {
  orderId: string;
  amount: number;
  cardToken: string;
}

const MAX_RETRY = 3;

/** 카드 결제. 일시적인 오류(네트워크·타임아웃)는 잠깐 쉬었다가 다시 시도한다 */
export async function pay(req: PaymentRequest) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api.post("/payments", req);
    } catch (e) {
      if (!isTransient(e) || attempt >= MAX_RETRY) throw e;
      await sleep(400 * attempt);
    }
  }
}

const isTransient = (e: unknown) => e instanceof Error && /timeout|network/i.test(e.message);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
TS
git add src/checkout/payment.ts; as "$SY" $SYE "Fix: 결제 실패 시 재시도"
git switch -q main
mg "$SY" $SYE feature/checkout
w CHANGELOG.md "## 1.1.0 주문·결제"; as "$HA" $HAE "Docs: 1.1.0 변경 사항"
git tag -a v1.1.0 -m "1.1.0"
git push -q origin main feature/checkout --tags

git switch -q -c feature/search
w src/search/index.ts "export function search() {}"; as "$DY" $DYE "Feat: 상품 검색"
w src/search/suggest.ts "export function suggest() {}"; as "$DY" $DYE "Feat: 검색어 자동 완성"
git push -q -u origin feature/search
w src/search/index.ts "// 오타 보정"; as "$DY" $DYE "Feat: 검색 오타 보정"

git switch -q main
git switch -q -c feature/reviews
w src/reviews/list.tsx "export function Reviews() {}"; as "$MJ" $MJE "Feat: 상품 리뷰 목록"
w src/reviews/form.tsx "export function ReviewForm() {}"; as "$MJ" $MJE "Feat: 리뷰 작성·사진 첨부"
git push -q -u origin feature/reviews

git switch -q main
w src/api/client.ts "// 캐시"; as "$SY" $SYE "Perf: 상품 목록 응답 캐시"
w src/app.tsx "// 다크 모드"; as "$HA" $HAE "Feat: 다크 모드"
git push -q origin main
w src/cart/guest.ts "export const GUEST_CART_KEY = 'guest-cart'"; as "$HA" $HAE "Feat: 비회원 장바구니 유지"

# 작업 중인 변경(그래프 맨 위 '작업 중인 변경' 행)
cat > src/cart/store.ts <<'TS'
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export const cart: CartItem[] = [];

export function add(item: CartItem) {
  const found = cart.find((c) => c.productId === item.productId);
  if (found) found.quantity += item.quantity;
  else cart.push(item);
}

/** 5만 원 이상이면 무료 배송 */
export const FREE_SHIPPING = 50_000;
export const SHIPPING_FEE = 3_000;

export function subtotal() {
  return cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
}

export function total() {
  const sum = subtotal();
  return sum >= FREE_SHIPPING ? sum : sum + SHIPPING_FEE;
}
TS
cat > src/cart/shipping.ts <<'TS'
import { FREE_SHIPPING, subtotal } from "./store";

/** 무료 배송까지 남은 금액(배너에 표시) */
export function remainingForFreeShipping() {
  return Math.max(0, FREE_SHIPPING - subtotal());
}
TS
echo "ok $R"
