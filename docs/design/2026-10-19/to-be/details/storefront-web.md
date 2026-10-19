# storefront-web (정적 SPA) — TO-BE 상세

> **대상**: 고객 SPA 전체 — 화면 라우트 32개, 로그인 가드·복귀 주소, 장바구니 병합 호출, 주문서·PG 결제창·승인 복귀, 마이페이지·비회원 조회(`C-01`, `R-01`~`R-17`·`R-23`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드 없는 신규 설계 — 문서 기준점)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md) · **입력 이동도**: [`docs/navigation.md`](../../../../navigation.md)(N1~N8 — 원본이라 이 문서에 복제하지 않는다)
> **표기**: 화면 이동은 `navigation`(`navigation-diagram-guide.md`), 내부 흐름은 `jobflow`(`job-flow-diagram-guide.md`), 화면 상태는 `state`(`state-diagram-guide.md`). 신규 설계라 모든 라우트·컴포넌트·심볼이 제안이다 — `(제안)` 표시는 생략한다. 외부 위젯·창의 동작은 「가정」, 확인하지 못한 것은 「미확인」이다. 기술은 React + TypeScript + Vite로 잠정한다(상위 §9.5)

## 1. 책임 / 비책임

- **책임**: 고객이 보는 화면과 라우트를 그리고, 화면 동작을 mall-api `/api/*` 호출로 바꾼다. 로그인이 필요한 동작 앞에서 `GET /api/members/me`로 확인하고(`check_auth`), 미로그인이면 복귀 주소를 저장해 `LoginForm`으로 보낸다. 로그인 뒤 장바구니 병합을 부르고 복귀 주소로 돌아간다(`R-03`·`R-23`). 옵션 선택·폼 형식 검사(`check_option_*`·`validate_form`·`validate_order`·`validate_review`)로 헛된 요청을 줄인다. 주문서 금액을 서버 견적으로 보이고 그 금액을 `expectedAmount`로 보낸다(`R-09`). PG 결제창을 열고, 복귀 주소 `/checkout/pg-return`에서 승인을 한 번만 요청하며 결과 불명이면 폴링한다(`R-10`·`R-18`). 결제창 실패 복귀면 주문 취소를 부른다(`R-20`). 브라우저가 직접 여는 외부 창 다섯 곳(PG 결제창·소셜 동의·본인인증 창·우편번호 위젯·객체 저장소 업로드)을 연다.
- **비책임**: 금액·할인·배송비 계산과 재고·쿠폰 판단(order·promotion·catalog — 화면은 서버 견적을 보일 뿐이다), 세션 발급과 쿠키 설정(member·mall-api), `cartKey`·비회원 조회 토큰 쿠키 발급(cart·order — httpOnly라 화면이 읽지도 않는다), 본인인증·소셜 코드의 진위 확인(member가 업체에 다시 묻는다), 승인 금액 검증과 결과 불명 회수(order의 대사 타이머), 오류 응답 형식 정의(mall-api — 화면은 그 형식을 읽는다).
- **아무도 하지 않는 것**: 결제창을 연 채 브라우저를 닫은 고객의 주문을 바로 푸는 일(복귀가 없어 화면이 알 수 없다 — 서버 만료 타이머 30분이 거둔다, §8), 같은 주문 생성 요청의 재전송 중복 제거(`POST /api/orders`에 멱등 키가 없다 — §8), 비회원 알림톡 링크를 비회원 조회로 바로 잇는 일(§8).

## 2. 공개 계약

화면 라우트 32개가 이 경계의 공개 진입점이다. 라우터 선언은 `src/app/routes.tsx` 한 곳에 둔다. 상위 §7 화면 표의 주소를 모두 담고, 정의되지 않은 주소를 받는 `*`를 더했다. 「가드」 줄임말 — **공개**: 가드 없음, **회원**: `AuthGuard` 통과(§3 `JF-2`), **회원·비회원 조회**: 비회원 조회 표시가 있으면 가드를 건너뛴다(`JF-8`), **주문서**: 회원이거나 비회원 동의가 주문서 임시 상태에 있다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `/` | 공개 | `Home` — `GET /api/exhibitions?placement=home`, 카테고리별 `GET /api/products?categoryId=` | 섹션별 실패는 그 섹션만 비운다 | `HomePage` |
| `/categories/:categoryId` | path, 쿼리 `sort`·`page`, 공개 | `CategoryList` — `GET /api/categories`, `GET /api/products?categoryId=&sort=&page=` | 404 → `NotFound` | `CategoryListPage` |
| `/search` | 쿼리 `q`·`sort`·`page`, 공개 | `SearchResult` — `GET /api/products/search` | `q` 2글자 미만은 요청 전에 막고 안내(서버 422와 같은 규칙) | `SearchResultPage` |
| `/events/:exhibitionId` | path, 공개 | `EventPage` — `GET /api/exhibitions/{id}` → 상품 ID로 `GET /api/products?ids=`, 「쿠폰 받기」 `POST /api/coupons/{couponId}/download` | 쿠폰 401 → `goLogin`(복귀 = 이 화면), 409·410 토스트, 404 → `NotFound` | `EventPage` |
| `/products/:productId` | path, 공개 | `ProductDetail`·`CartAddedModal` — `GET /api/products/{id}`, `GET /api/products/{id}/reviews`, 담기 `POST /api/cart/items`, 찜 `PUT`·`DELETE /api/wishlist/{id}`, 쿠폰 받기 | 옵션 미선택은 요청 전에 머문다(`check_option_*`), 담기 409 `SOLD_OUT`·`MAX_QUANTITY` 토스트, 찜·쿠폰 401 → `goLogin`, 404 → 「판매 종료」 | `ProductDetailPage`, `OptionSelector`, `CheckoutEntry`(바로구매) |
| `/cart` | 공개(비회원은 `cartKey` 쿠키) | `Cart` — `GET /api/cart`, `PATCH`·`DELETE /api/cart/items/{id}`, 「선택 상품 주문」 | 품절·판매중지 품목은 선택 불가로 표시, 수량 409 토스트 | `CartPage`, `CheckoutEntry` |
| `/login` | 쿼리 `error=social`·`error=social_cancelled`, 공개(로그인 상태면 복귀 주소로) | `LoginForm` — `POST /api/auth/login`, 소셜 버튼은 `/api/oauth/{provider}/authorize`로 전체 이동, 「비회원 구매」·「비회원 주문조회」·「회원가입」·「비밀번호 찾기」 | `validate_form` 실패는 머문다, 401 `INVALID_CREDENTIALS`·423 `LOCKED {until}`·429 `RATE_LIMITED` 문구, `error=social` 「소셜 로그인에 실패했습니다」, `error=social_cancelled` 「소셜 로그인을 취소했습니다」 | `LoginPage`, `LoginReturn` |
| `/login/return` | 공개 — 소셜 기존 회원 콜백이 302로 보낸 주소(상위 §5.3) | 화면 없이 `LoginReturn.restoreReturnUrl` 실행 | 세션이 없으면(`GET /api/members/me` 401) `/login?error=social` | `LoginReturnPage` |
| `/signup/social` | 쿼리 없음, 공개 — 가입 티켓은 서버가 httpOnly 쿠키 `SIGNUP_TICKET`(10분)으로 실어 화면은 읽지 않는다 | `SocialSignupForm` — `POST /api/signup/social` | 410 `TICKET_EXPIRED`(쿠키 없음 포함) → `/login?error=social`, 409 `SOCIAL_ALREADY_LINKED` → 문구, 422 `VALIDATION_FAILED` 필드 오류 | `SocialSignupPage` |
| `/signup/terms` | 공개 | `TermsAgreement` → 본인인증 창 → `POST /api/members/check-duplicate` | 창 취소는 머문다, 422 `VERIFICATION_FAILED`(인증 실패·만료·재사용)·`UNDER_14` 문구, 502 `IDV_UNAVAILABLE` 「잠시 후 다시」(§3 `JF-9`) | `TermsPage`, `IdVerifySdk` |
| `/signup/existing` | 진입 조건: 가입 임시 상태의 `EXISTING` 결과 | `ExistingAccountNotice` — 가린 아이디·소셜 연결 표시 | 임시 상태 없으면 `/signup/terms` | `ExistingAccountPage` |
| `/signup/form` | 진입 조건: 가입 임시 상태의 `verificationId` | `SignupForm` — `POST /api/signup` | `validate_form` 실패 머묾, 409 `LOGIN_ID_TAKEN`·`CI_TAKEN`, 422 `VALIDATION_FAILED` 필드 오류, 410 `VERIFICATION_EXPIRED`(30분 경과·사용됨) → `/signup/terms` | `SignupFormPage` |
| `/signup/complete` | 공개 | `SignupComplete` | — | `SignupCompletePage` |
| `/password/forgot` | 공개 | `ForgotPassword` — 본인인증 창 → `ForgotPassword(NewPasswordForm)` → `POST /api/password/reset` | 404 `MEMBER_NOT_FOUND`·422 `VERIFICATION_FAILED`(인증 실패·만료) → 첫 단계로, 422 `PASSWORD_RULE` → 폼에 머묾, 502 `IDV_UNAVAILABLE` 토스트(§3 `JF-9`) | `ForgotPasswordPage`, `IdVerifySdk` |
| `/checkout/guest-terms` | 공개, 진입 조건: 주문서 임시 상태 | `GuestCheckoutTerms` — 서버 호출 없음, 동의 시각을 주문서 임시 상태에 적는다 | 임시 상태 없으면 `/cart` | `GuestTermsPage` |
| `/checkout` | 주문서 | `Checkout`·`AddressSearchModal`·`CouponSelectModal`·`PgPaymentWindow` — `POST /api/orders/preview`(쿠폰별 평가 포함), `GET /api/members/me/coupons?usable=true`(회원만 — 보유 쿠폰), `POST /api/orders`, `POST /api/payments/virtual-accounts`, PG SDK | 임시 상태 없으면 `/cart`, 409 `PRICE_CHANGED`·`OUT_OF_STOCK`·`COUPON_UNAVAILABLE`는 재견적, 422 `VALIDATION_FAILED` 필드 오류, 502 가상계좌 발급 실패는 다시 시도(§3 `JF-5.1`·`JF-5.2`) | `CheckoutPage`, `PaymentLauncher` |
| `/checkout/pg-return` | 쿼리 `paymentKey`·`orderId`·`amount` 또는 `code`·`message`, 진입 조건: 결제 진행 기록(§4) | `PaymentConfirming` — `POST /api/payments/{paymentKey}/approve`, `GET /api/orders/{id}` 폴링, 실패 복귀면 `POST /api/orders/{id}/cancel` | 402·400 → `/checkout`, 202·409 `INVALID_STATE`·5xx·타임아웃 → 폴링, 1분 넘거나 `MANUAL_REVIEW`면 「주문 내역에서 확인」 | `PaymentConfirmingPage`, `OrderStatusPoller` |
| `/orders/:orderId/complete` | path, 회원·비회원 조회 | `OrderComplete`(가상계좌면 `OrderComplete(VirtualAccountInfo)`) — `GET /api/orders/{id}` | 403·404 → `OrderList` 또는 `GuestOrderLookup` | `OrderCompletePage` |
| `/mypage` | 회원 | `MyPage` 허브 — `GET /api/members/me`, 로그아웃 `POST /api/auth/logout` | 401 → `goLogin` | `MyPage` |
| `/mypage/orders` | 쿼리 `period`·`page`, 회원 | `OrderList` — `GET /api/orders` | 401 → `goLogin` | `OrderListPage` |
| `/orders/:orderId` | path, 회원·비회원 조회 — 알림톡 링크의 직접 진입 주소(N8) | `OrderDetail`·`OrderDetail(CancelDialog)` — `GET /api/orders/{id}`(품목 상태 「상품 준비중」 `PREPARING` 포함), 취소 `POST /api/orders/{id}/cancel {reason, refundAccount?}`(가상계좌로 결제한 `PAID` 주문은 대화상자에 환불 계좌 칸), 구매확정 `POST /api/orders/{id}/lines/{lineId}/confirm` → `ReviewPromptModal` | 미로그인 → `goLogin`(복귀 = 이 주소), 403 `NOT_OWNER` → `OrderList`, 비회원 조회 만료(401) → `GuestOrderLookup`, 취소 202 `CANCELLING` → 「취소 처리 중」 표시 뒤 다시 읽기, 422 `REFUND_ACCOUNT_REQUIRED` → 환불 계좌 칸을 열고 머묾, 409 `NOT_CANCELLABLE`·502 `REFUND_FAILED` 토스트 후 다시 읽기, 구매확정 409 `NOT_CONFIRMABLE`. 품목 하나라도 `PREPARING`·`SHIPPING`이면 취소 버튼 대신 안내(§3 `JF-10`) | `OrderDetailRoute`, `OrderDetailPage` |
| `/orders/:orderId/tracking` | path, 회원·비회원 조회 | `DeliveryTracking` — `GET /api/orders/{id}/tracking` | 송장별 `UNAVAILABLE`은 「조회 실패 — 잠시 후」만 그 송장에 | `DeliveryTrackingPage` |
| `/orders/:orderId/return` | path, 회원·비회원 조회 | `ReturnRequestForm` — `POST /api/orders/{id}/claims/return {lineIds[], reasonCode, reasonText, pickupAddress, refundAccount?}` — 가상계좌로 결제한 주문이면 환불 계좌 칸(은행·계좌번호·예금주)을 보인다 | 409 `NOT_CLAIMABLE {lineId, why}` 품목 표시, 422 `VALIDATION_FAILED` 필드 오류, 422 `REFUND_ACCOUNT_REQUIRED` → 환불 계좌 칸 강조 | `ReturnRequestPage` |
| `/orders/:orderId/exchange` | path, 회원·비회원 조회 | `ExchangeRequestForm` — `GET /api/products/{id}`(교환 옵션), `POST /api/orders/{id}/claims/exchange` | 위와 같음 | `ExchangeRequestPage` |
| `/claims/:claimId/complete` | path, 회원·비회원 조회 | `ClaimComplete` — `GET /api/claims/{id}` | 403·404 → `OrderList` | `ClaimCompletePage` |
| `/reviews/new` | 쿼리 `orderLineId`, 회원 | `ReviewWriteForm` — `POST /api/reviews/upload-urls`, 저장소 `PUT`, `POST /api/reviews` | `validate_review` 실패 머묾, 403 `NOT_CONFIRMED`·409 `ALREADY_REVIEWED` → 주문 상세로 | `ReviewWritePage` |
| `/mypage/reviews` | 회원 | `MyReviewList` — `GET /api/members/me/reviews` | 401 → `goLogin` | `MyReviewListPage` |
| `/guest/orders` | 공개 | `GuestOrderLookup` — `POST /api/guest/orders/lookup {orderNo, password}`(주문 비밀번호 6~20자) | 404 `NOT_FOUND` 문구(어느 쪽이 틀렸는지 말하지 않는다), 429 `LOCKED {until}` 「{until}까지 조회할 수 없습니다」 | `GuestOrderLookupPage` |
| `/mypage/coupons` | 회원 | `MyCouponList` — `GET /api/members/me/coupons` | 401 → `goLogin` | `MyCouponListPage` |
| `/mypage/wishlist` | 회원 | `MyWishList` — `GET /api/wishlist`, 해제 `DELETE /api/wishlist/{id}` | 401 → `goLogin` | `MyWishListPage` |
| `/mypage/withdraw` | 회원 | `WithdrawConfirm` — 비밀번호 회원(`GET /api/members/me`의 `joinType:'PASSWORD'`)은 비밀번호 재확인 칸, `DELETE /api/members/me {password?}` | 401 `INVALID_CREDENTIALS` → 칸 아래 문구, 403 `REAUTH_REQUIRED`(소셜 전용 회원의 로그인이 10분보다 오래됨) → 복귀 주소 = 이 화면으로 `LoginForm`(다시 소셜 로그인), 409 `ACTIVE_ORDERS` → 문구와 `OrderList` 링크 | `WithdrawPage` |
| `*` | 정의되지 않은 주소 | `NotFound` — 홈 링크 | — | `NotFoundPage` |

- **고정 되돌림**: PG 결제창은 `/checkout/pg-return`, 소셜 동의는 서버 콜백 `/api/oauth/{provider}/callback`을 거쳐 `/login/return`이나 `/signup/social`로 돌아온다. 본인인증 창은 주소 이동 없이 SDK 콜백으로 결과를 넘긴다(가정 — 업체 SDK).
- **직접 진입**: 모든 라우트가 새로고침·북마크로 열릴 수 있다. 그래서 화면 사이에 넘기는 값(주문서 품목·결제 진행·가입 단계·비회원 조회 표시)을 메모리가 아니라 sessionStorage에 둔다(§4). 정의되지 않은 주소는 `NotFound`를 보인다(고정 리다이렉트 — 이동도에 그리지 않는다).
- **비회원 화면**: `/checkout`·`/checkout/pg-return`·`/orders/:orderId/*`는 비회원도 쓴다. 비회원 주문의 소유 확인은 서버가 조회 토큰 쿠키로 한다. 화면은 쿠키를 읽을 수 없어서 「이 탭에서 이 주문을 비회원으로 열었다」는 표시를 따로 둔다(§4 `GuestAccessStore`).

### 2.1 화면 이동 — navigation.md에 더한 것

원본 이동도는 [`docs/navigation.md`](../../../../navigation.md)다. 아래는 그 문서에 없던 이동만이다. 노드 이름은 이동도와 같고, 새 화면은 `PaymentConfirming`·`MyCouponList`·`MyWishList`·`WithdrawConfirm`과 오버레이 `Checkout(PriceChangedDialog)`·`Checkout(RetryIssueDialog)`·`ForgotPassword(NewPasswordForm)`·`OrderComplete(VirtualAccountInfo)`·`PaymentConfirming(CheckLaterNotice)`·`OrderDetail(CancelDialog)`다. 새 논리 API 이름의 실제 계약은 각 묶음 아래에 적는다.

**추가 이동 A — 마이페이지 허브**(상위 §7 `MyPage` 신규 허브, `R-12`·`R-26`)

```navigation
Home --> (check_auth) : 마이페이지 아이콘
(check_auth) --> LoginForm : 미로그인
(check_auth) --> MyPage : 로그인됨
MyPage --> OrderList : 주문·배송 조회
MyPage --> MyCouponList : 쿠폰함
MyPage --> MyWishList : 찜 목록
MyPage --> MyReviewList : 내 리뷰
MyPage --> WithdrawConfirm : 회원 탈퇴
MyPage --> (/logout) : 로그아웃
(/logout) --> Home
MyWishList --> ProductDetail : 상품 선택
WithdrawConfirm --> (/members/withdraw) : 탈퇴하기
(/members/withdraw) --> WithdrawConfirm : 비밀번호 틀림·진행 중 주문 있음
(/members/withdraw) --> (save_return_url) : 다시 로그인 필요
(save_return_url) --> LoginForm
(/members/withdraw) --> Home : success
```

- `(/logout)` = `POST /api/auth/logout`, `(/members/withdraw)` = `DELETE /api/members/me {password?}` — 비밀번호 회원은 재확인 비밀번호를 싣고(401 `INVALID_CREDENTIALS` = 틀림, 실패 횟수에 들지 않는다), 소셜 전용 회원은 본문 없이 보낸다. 409 `ACTIVE_ORDERS`는 결제 대기(입금 대기·취소 진행 포함)·출고 전(상품 준비 중 포함)·클레임 중(교환 재발송 대기 포함)·확인 처리 중(`MANUAL_REVIEW`) 주문이 있을 때다 — 배송 중(`SHIPPING`)은 진행 중으로 세지 않는다([order 상세 `JF-1`](order.md#jf-1-클레임리뷰탈퇴-지원--claimsupport) `hasActiveOrders`). 탈퇴·로그아웃 뒤에는 세션 캐시·주문서 임시 상태·결제 진행 기록을 모두 지운다(§4).
- 「다시 로그인 필요」는 403 `REAUTH_REQUIRED`다 — 소셜 전용 회원의 로그인이 10분보다 오래됐다. 복귀 주소 `/mypage/withdraw`를 저장하고 `LoginForm`으로 보내, 소셜 로그인 뒤 탈퇴 화면으로 돌아와 한 번 더 누르게 한다(자동으로 다시 보내지 않는다).
- 쿠폰함의 쿠폰 사용과 찜 해제는 화면에 머문다 — 그리지 않았다.

**추가 이동 B — 로그인 성공 뒤 장바구니 병합과 복귀**(N2 `restore_return_url` 앞, `R-23`)

```navigation
(/login) --> (/cart/merge) : success
(/oauth/callback) --> (/cart/merge) : 기존 회원
(/signup/social) --> (/cart/merge) : success
(/cart/merge) --> (restore_return_url) : 병합 성공·실패 모두
(restore_return_url) --> Home : 복귀 주소 없음·허용 안 됨
(restore_return_url) --> ReturnPage : 복귀 주소 있음
```

- `(/cart/merge)` = `POST /api/cart/merge`. 병합 결과는 이동을 바꾸지 않는다 — 실패해도 복귀를 계속한다. 그래도 노드로 둔 것은 병합이 복귀보다 **먼저** 끝나야 해서다. 복귀 주소가 주문서면 주문서가 병합된 장바구니를 읽어야 한다(§3 `JF-3.1`).
- 「허용 안 됨」은 복귀 주소가 같은 오리진의 경로가 아닐 때다(§4 `ReturnUrlStore`). N4의 `(/login) --> Checkout : success`는 `ReturnPage` = `Checkout`인 경우다.

**추가 이동 C — 상품 상세의 찜·쿠폰 받기 미로그인**(N1 주석 「찜하기도 같은 방식」의 상품 상세 판, `R-02`)

```navigation
ProductDetail --> (/wishlist/toggle) : 찜
(/wishlist/toggle) --> ProductDetail : success
(/wishlist/toggle) --> (save_return_url) : 미로그인
ProductDetail --> (/coupons/download) : 쿠폰 받기
(/coupons/download) --> ProductDetail : success
(/coupons/download) --> (save_return_url) : 미로그인
(save_return_url) --> LoginForm
```

- `(/wishlist/toggle)` = `PUT`·`DELETE /api/wishlist/{productId}`, `(/coupons/download)` = `POST /api/coupons/{couponId}/download`. 상품 상세의 쿠폰 받기는 그 상품에 다운로드 쿠폰이 걸려 있을 때만 보인다(상위 §7 `ProductDetail` 행).
- `(save_return_url)`은 N1의 `EventPage` 미로그인에도 똑같이 끼어든다. 로그인 뒤 상품 상세로 돌아와도 찜·쿠폰 요청을 자동으로 다시 보내지 않는다 — 고객이 한 번 더 누른다(의도하지 않은 상태 변경을 막는다).

**추가 이동 D — 비밀번호 재설정**(N3 「비밀번호 찾기 이후 흐름」, `R-06`)

```navigation
LoginForm --> ForgotPassword : 비밀번호 찾기
ExistingAccountNotice --> ForgotPassword : 비밀번호 찾기
ForgotPassword --> IdentityVerificationWindow : 본인인증
IdentityVerificationWindow --> ForgotPassword : 인증 취소
IdentityVerificationWindow --> `identityResult` : 인증 완료
`identityResult` --> ForgotPassword(NewPasswordForm)
ForgotPassword(NewPasswordForm) --> (validate_form) : 변경하기
(validate_form) --> ForgotPassword(NewPasswordForm) : invalid
(validate_form) --> (/password/reset) : success
(/password/reset) --> ForgotPassword(NewPasswordForm) : error
(/password/reset) --> ForgotPassword : 회원 없음·인증 실패
(/password/reset) --> LoginForm : success
```

- 이동도 가이드의 재설정 시나리오(인증코드 메일)를 국내 관행인 휴대폰 본인인증으로 바꿨다 — 상위 §5.4 「그림 밖」 행과 같다. `(/password/reset)` = `POST /api/password/reset {identityToken, newPassword}` → 204, 404 `MEMBER_NOT_FOUND`, 422 `VERIFICATION_FAILED`(본인인증 결과 실패·만료·재사용 — 첫 단계로), 422 `PASSWORD_RULE`(`error` — 폼에 머문다), 502 `IDV_UNAVAILABLE`(`error`). 안쪽 흐름은 §3 `JF-9`.
- `IdentityVerificationWindow`는 가입(N3)과 같은 창이다. 취소하면 연 화면으로 돌아간다. 성공하면 모든 세션이 폐기되므로 다시 로그인하게 한다.

**추가 이동 E — 주문서 진입·견적·주문 생성 오류**(N5 앞뒤, `R-08`·`R-09`)

```navigation
(check_checkout_access) --> Cart : 주문서 임시 상태 없음
(check_checkout_access) --> LoginForm : 미로그인·비회원 동의 없음
(check_checkout_access) --> (/orders/preview) : 회원 또는 비회원 동의
(/orders/preview) --> Checkout : success
(/orders/preview) --> Cart : 주문할 수 있는 품목 없음
(/orders) --> Checkout(PriceChangedDialog) : 금액 변경
Checkout(PriceChangedDialog) --> (/orders/preview) : 확인
(/orders) --> (/orders/preview) : 재고 부족·쿠폰 사용 불가
```

- 진입 지점은 `/checkout` 라우트 가드 `(check_checkout_access)`다(직접 진입·새로고침 포함). `(/orders/preview)` = `POST /api/orders/preview`. N5의 `(/orders) --> Checkout : 재고 부족`은 이 그림에서 「재견적 뒤 `Checkout`」으로 연다 — 재견적 결과에 품절 품목이 표시된다.
- 우편번호·쿠폰 변경의 재견적은 화면에 머문다 — N5의 `AddressSearchModal`·`CouponSelectModal` 복귀 뒤에 일어나며 그리지 않았다.

**추가 이동 F — PG 결제창 복귀와 승인 확인**(N5 `paymentAuthResult` 뒤, `R-10`·`R-18`·`R-20`)

```navigation
PgPaymentWindow --> `paymentAuthResult` : 인증 완료
`paymentAuthResult` --> PaymentConfirming
PaymentConfirming --> (/payment/approve)
(/payment/approve) --> OrderComplete : paid
(/payment/approve) --> Checkout : failed
(/payment/approve) --> (poll_order_status) : 확인 중·이미 처리됨
(check_pending_payment) --> (poll_order_status) : 승인 요청한 주문 있음
(check_pending_payment) --> OrderList : 진행 중 결제 없음
(poll_order_status) --> OrderComplete : PAID
(poll_order_status) --> Checkout : 결제 실패·만료
(poll_order_status) --> PaymentConfirming(CheckLaterNotice) : 1분 초과
PaymentConfirming(CheckLaterNotice) --> OrderDetail : 주문 내역에서 확인
PgPaymentWindow --> `paymentFailResult` : 결제 취소·실패
`paymentFailResult` --> (/orders/cancel)
(/orders/cancel) --> Checkout : 성공·실패 모두
```

- N5의 `PgPaymentWindow --> Checkout : 결제 취소`와 `` `paymentAuthResult` --> (/payment/approve) ``를 이 그림이 연다. 성공·실패 복귀 모두 같은 주소 `/checkout/pg-return`으로 오고 쿼리로 가른다.
- `(check_pending_payment)`는 같은 주소를 쿼리 없이 다시 연 경우(새로고침·뒤로가기)의 진입 지점이다. 승인을 다시 보내지 않고 주문 상태만 읽는다(§3 `JF-6`).
- `(poll_order_status)` = `GET /api/orders/{orderId}`를 3초마다 최대 1분(상위 §5.7). 「이미 처리됨」은 409 `INVALID_STATE`다 — 상위 §7 동시성 불릿대로 주문을 다시 읽어 실제 상태로 보낸다. `(/orders/cancel)` = `POST /api/orders/{orderId}/cancel`.

**추가 이동 G — 무통장입금 완료와 가상계좌 표시**(N5 `(/payment/virtual_account)` 뒤, `R-11`)

```navigation
(/payment/virtual_account) --> OrderComplete(VirtualAccountInfo) : 가상계좌 발급
(/payment/virtual_account) --> Checkout(RetryIssueDialog) : error
Checkout(RetryIssueDialog) --> (/payment/virtual_account) : 다시 시도
OrderComplete(VirtualAccountInfo) --> OrderDetail : 주문 상세 보기
OrderComplete(VirtualAccountInfo) --> Home : 쇼핑 계속하기
```

- `OrderComplete(VirtualAccountInfo)`는 은행·계좌번호(복사 버튼)·입금액·입금기한을 보인다. 발급 응답 201 `{bank, accountNumber, amount, dueAt}`에도 같은 값이 있지만 화면은 `GET /api/orders/{id}`의 `payment.vbank`에서 읽는다 — 새로고침해도 같다.
- 발급 실패(502·타임아웃)는 같은 주문으로 다시 발급한다. 결과 불명이었으면 서버가 같은 멱등 키 `vbank:<orderId>`로 같은 계좌를 돌려주고(가정 — 업체 멱등 지원), PG 거절로 확정 실패했으면 서버가 새 시도 키 `vbank:<orderId>#<n>`로 다시 발급한다(order 상세). 화면은 두 경우를 가르지 않는다. 새 주문을 만들지 않는다.

**추가 이동 H — 비회원 조회 표시와 만료**(N7·N8 보충, `R-16`·`R-17`)

```navigation
(/guest/orders/lookup) --> (save_guest_access) : found
(save_guest_access) --> OrderDetail
(/orders/detail) --> GuestOrderLookup : 비회원 조회 만료
```

- `(save_guest_access)`는 「이 탭에서 이 주문을 비회원으로 열었다」는 표시를 남긴다(§4 `GuestAccessStore`). 서버의 조회 토큰 하나가 같은 브라우저의 비회원 주문 여러 개(최대 5)를 가리키므로 표시도 주문 ID 목록이다 — 새 조회·비회원 주문이 목록에 더하고 수명을 갱신한다. 이 목록에 그 주문이 있으면 `/orders/:orderId`의 가드가 `GET /api/members/me`를 건너뛰고 바로 `(/orders/detail)`을 부른다. 토큰 쿠키(30분)가 만료되면 서버가 401을 주고 화면은 표시를 지우고 `GuestOrderLookup`으로 보낸다.

**추가 이동 I — 주문 취소 대화상자**(N6 각주 「결제완료 단계의 주문 취소는 `OrderDetail`에 머문다」의 오버레이 판, `R-20`)

```navigation
OrderDetail --> OrderDetail(CancelDialog) : 주문 취소
OrderDetail(CancelDialog) --> OrderDetail : 닫기
OrderDetail(CancelDialog) --> (/orders/cancel) : 취소하기
(/orders/cancel) --> OrderDetail(CancelDialog) : 환불 계좌 필요
(/orders/cancel) --> OrderDetail : 취소 완료·처리 중·취소 불가
```

- 「주문 취소」 버튼은 주문이 결제 대기·입금 대기이거나 모든 품목이 `PAID`일 때만 보인다. 품목 하나라도 `PREPARING`(상품 준비중)·`SHIPPING`이면 버튼 대신 「상품 준비가 시작되어 취소할 수 없습니다 — 고객센터에 문의하거나 배송 뒤 반품해 주세요」를 보인다(잠정 — order 상세).
- `OrderDetail(CancelDialog)`는 취소 사유를 받고, 가상계좌로 결제한 `PAID` 주문이면 환불 계좌(은행·계좌번호·예금주) 칸을 처음부터 보인다. 「환불 계좌 필요」는 422 `REFUND_ACCOUNT_REQUIRED`다 — 대화상자를 연 사이 입금이 반영된 경우 등. 칸을 열고 머문다.
- 「처리 중」은 202 `CANCELLING`(PG 취소 결과 불명)이다 — 상세에 「취소 처리 중」 띠를 보이고 주문을 다시 읽는다. 서버 대사가 닫으면 다음 읽기에 `CANCELLED`가 보인다. 「취소 불가」는 409 `NOT_CANCELLABLE`·502 `REFUND_FAILED` 토스트 뒤 다시 읽기다. 안쪽 흐름은 §3 `JF-10`.

### 2.2 화면 상태

**주문서 제출 상태** — 상태 소유자는 `CheckoutPage`(메모리)다. 진입할 때 `editing`으로 시작하고, 화면을 떠나면 사라진다. 불변조건: `submitting`·`launching` 동안 「결제하기」는 눌리지 않는다(`SubmitLock`, §6).

```state
<s> --> (editing)
(editing) --> (previewing) : 진입·쿠폰·우편번호 변경
(previewing) --> (editing) : 견적 도착
(editing) --> (submitting) : 결제하기 — validate_order 통과
(submitting) --> (previewing) : 409 PRICE_CHANGED·OUT_OF_STOCK·COUPON_UNAVAILABLE
(submitting) --> (editing) : 422·5xx·타임아웃
(submitting) --> (launching) : 201 주문 생성
(launching) --> (editing) : 결제창 사용자 닫기 — 주문 취소 뒤
(launching) --> (retryIssue) : 가상계좌 발급 502
(retryIssue) --> (launching) : 다시 시도
(launching) --> <e> : 결제창으로 이동 또는 완료 화면
```

**기호**: `<s>` 시작점, `(…)` 상태, `<e>` 화면을 떠나 상태가 사라지는 곳, `A --> B : 글` 전이와 그 조건(`state-diagram-guide.md` 「구성 요소」).

- `previewing` 중에도 입력은 받지만 「결제하기」는 견적이 도착할 때까지 막는다 — 보인 금액과 `expectedAmount`가 늘 같은 견적에서 나오게 한다.
- `submitting → editing`의 5xx·타임아웃은 주문이 생겼는지 모른다. 다시 누르면 새 주문이 생길 수 있다(§8 — 멱등 키 없음).

**결제 확인 화면 상태** — 상태 소유자는 `PaymentConfirmingPage`(메모리)이고, 새로고침을 넘는 사실은 결제 진행 기록(§4 `PendingPayment`)이 잇는다. 초기화: `/checkout/pg-return`에 들어올 때마다(새로고침·뒤로가기 포함) 메모리 상태가 비어 `reading`에서 다시 시작한다 — 승인을 이미 보냈는지는 메모리가 아니라 결제 진행 기록의 `approveRequestedAt`이 기억한다. 불변조건: 승인 요청은 결제 진행 기록 하나에 한 번이다.

```state
<s> --> (reading)
(reading) --> (cancelling) : 실패 복귀
(reading) --> (approving) : 성공 복귀·첫 요청
(reading) --> (polling) : 쿼리 없음·이미 요청함
(approving) --> (done) : 200 PAID
(approving) --> (failed) : 402·400
(approving) --> (polling) : 202·409 INVALID_STATE·타임아웃
(polling) --> (done) : PAID
(polling) --> (failed) : PAYMENT_FAILED·EXPIRED·CANCELLED
(polling) --> (checkLater) : 1분 초과·MANUAL_REVIEW
(cancelling) --> (failed) : 취소 성공·실패 모두
(done) --> <e> : OrderComplete로 교체
(failed) --> <e> : Checkout으로 교체
(checkLater) --> <e> : OrderDetail로 이동
```

**기호**: `<s>` 페이지 로드(초기화 지점), `(…)` 상태, `<e>` 주소를 바꿔 상태가 사라지는 곳, `A --> B : 글` 전이와 그 조건(`state-diagram-guide.md` 「구성 요소」).

- `approving`에서 타임아웃(45초, §6)·5xx는 실패가 아니라 결과 불명이다 — 서버가 PG를 30초 기다리므로 화면이 먼저 끊겨도 서버는 승인했을 수 있다(`D-04`). 그래서 `polling`으로 가서 주문 상태로 판정한다.
- `MANUAL_REVIEW`는 서버가 대사로 결론을 못 내 운영자 확인으로 넘긴 주문이다 — 화면은 기다려도 바뀌지 않으므로 바로 `checkLater`로 가서 「결제 확인 중 — 확인되면 알림으로 알려드립니다」를 보인다.
- `done`·`failed`는 주소를 **교체**(`history.replace`)해 뒤로가기로 이 화면에 다시 오지 않게 한다.

### 2.3 공통 화면 규칙

- **모바일 우선**: 기준 폭 360px부터 그린다. 768px·1024px에서 2단·3단으로 넓힌다. 주문서·상품 상세의 「결제하기」·「장바구니 담기」는 모바일에서 화면 아래 고정 막대에 둔다.
- **접근성**: 폼 필드마다 `<label>`, 서버 422 `VALIDATION_FAILED`의 `details.fields[].field`를 그 필드의 `aria-describedby` 오류 문구로 잇는다. 토스트는 `role="status"`, 모달은 초점 가둠과 `Esc` 닫기. 결제 확인 중 화면은 `aria-live="polite"`로 진행을 알린다. 색만으로 품절·오류를 나타내지 않는다.
- **로딩**: 목록은 뼈대 화면, 버튼 동작은 버튼 안 표시. 0.3초 안에 끝나면 표시하지 않는다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 이 경계에는 전역 조율자가 없다. 라우트마다 페이지 컴포넌트가 자기 흐름을 조율하고, 여러 화면이 쓰는 흐름은 공용 객체(`AuthGuard`·`LoginReturn`·`CheckoutEntry`·`PaymentLauncher`·`OrderStatusPoller`)가 맡는다. 서버로 나가는 길은 `ApiClient` 하나이고, 화면은 그 위의 모듈별 API 클라이언트(`MemberApi`·`AuthApi`·`CartApi`·`OrderApi`·`PaymentApi`·`PromotionApi`·`ReviewApi`)만 부른다. 외부 창은 `PgSdk`·`IdVerifySdk`·`PostcodeWidget`·`StorageUploader`가 감싼다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Browser.call`(5.1 묶음 — 화면이 보내는 요청 전부) | [`JF-1` 공통 API 호출](#jf-1-공통-api-호출--apiclientrequest) | — |
| `Browser.openHome`·`Browser.search`·`Browser.openEvent`·`Browser.openProduct`(5.2) | [`JF-1`](#jf-1-공통-api-호출--apiclientrequest)의 진입으로 묶는다 — 페이지가 `CatalogApi`·`PromotionApi`를 부르고 그리기만 한다(§2 표). `openEvent`는 기획전을 읽은 뒤 상품 ID로 목록을 한 번 더 부른다(상위 §5.2) | — |
| `Browser.downloadCoupon`·`Browser.toggleWish`·`Browser.goLogin`(5.2·5.5·5.14) | [`JF-2` 로그인 가드와 복귀 주소 저장](#jf-2-로그인-가드와-복귀-주소-저장--authguardensurelogin) — `goLogin` = `AuthGuard.goLogin`. 쿠폰·찜의 401은 `JF-1`의 `ApiError.normalize.unauthorized`가 여기로 넘긴다 | — |
| `Browser.submitLogin`·`Browser.socialLogin`·`Browser.openConsent`·`Browser.followCallback`·`Browser.openSocialSignup`·`Browser.restoreReturnUrl`(5.3) | [`JF-3` 로그인 세 갈래](#jf-3-로그인-세-갈래--loginpagesubmit) — `submitLogin` = `LoginPage.submit`, `socialLogin`·`openConsent` = `LoginPage.startSocial` → `AuthApi.openOAuthAuthorize`(전체 페이지 이동 한 번이 두 노드다), `followCallback`은 브라우저가 IdP·서버의 302를 따르는 것이라 SPA 코드가 없다, `openSocialSignup` = `SocialSignupPage.submit` | `restoreReturnUrl` → [`JF-3.1` 병합과 복귀](#jf-31-장바구니-병합과-복귀--loginreturnrestorereturnurl) |
| `Browser.agreeTerms`·`Browser.checkDuplicate`·`Browser.showExistingAccount`·`Browser.openSignupForm`(5.4)과 그림 밖 비밀번호 재설정 | [`JF-9` 가입과 비밀번호 재설정](#jf-9-가입과-비밀번호-재설정--termspageagreeterms) — `agreeTerms` = `TermsPage.agreeTerms`, `checkDuplicate` = `MemberApi.checkDuplicate`, `showExistingAccount`·`openSignupForm` = `SignupDraft.save` 뒤 `Router.replace`, 재설정 = `ForgotPasswordPage.verify`·`submitNewPassword` | — |
| `Browser.addToCart`·`Browser.showCartAdded`·`Browser.openCart`·`Browser.startCheckout`(5.5) | [`JF-4` 담기와 주문 진입](#jf-4-담기와-주문-진입--productdetailpageaddtocart) — `startCheckout` = `CheckoutEntry.start`, `openCart` = `CartPage`(`GET /api/cart` 하나 — `JF-1`의 진입으로 묶는다) | `startCheckout` → [`JF-4.1` 주문 진입](#jf-41-주문-진입--checkoutentrystart) |
| `Browser.openCheckout`·`Browser.searchAddress`·`Browser.openCouponModal`·`Browser.applyCoupon`·`Browser.placeOrder`·`Browser.openPgWindow`(5.5·5.6) | [`JF-5` 주문서 견적](#jf-5-주문서-견적--checkoutpageopen) — `openCheckout` = `CheckoutPage.open`, `applyCoupon` = `CouponModal.open.applied` | `placeOrder` → [`JF-5.1` 주문 생성](#jf-51-주문-생성--checkoutpageplaceorder), `openPgWindow` → [`JF-5.2` 결제 시작](#jf-52-결제-시작--paymentlauncherlaunch) |
| `Browser.returnFromPg`·`Browser.showOrderResult`(5.7) | [`JF-6` PG 복귀와 승인](#jf-6-pg-복귀와-승인--paymentconfirmingpagehandlereturn) — `returnFromPg` = `PaymentConfirmingPage.handleReturn`, `showOrderResult` = `PaymentApi.approve`의 값 분기 뒤 `Router.replace`·`OrderStatusPoller.start` | 202 폴링 → [`JF-6.1` 주문 상태 폴링](#jf-61-주문-상태-폴링--orderstatuspollerstart) |
| `Browser.chooseVirtualAccount`(5.9) | [`JF-5.2` 결제 시작](#jf-52-결제-시작--paymentlauncherlaunch)의 가상계좌 갈래 | — |
| `Browser.cancelOrder`(5.10) | [`JF-10` 주문 취소](#jf-10-주문-취소--orderdetailpagecancelorder) — `cancelOrder` = `OrderDetailPage.cancelOrder`. 결제창 실패 복귀의 취소는 [`JF-6`](#jf-6-pg-복귀와-승인--paymentconfirmingpagehandlereturn), 사용자 닫기의 취소는 [`JF-5.2`](#jf-52-결제-시작--paymentlauncherlaunch) | — |
| `Browser.openTracking`(5.11) | [`JF-1`](#jf-1-공통-api-호출--apiclientrequest)의 진입으로 묶는다 — `DeliveryTrackingPage`가 `OrderApi.getTracking` 한 번 | — |
| `Browser.requestReturn`(5.12) | [`JF-1`](#jf-1-공통-api-호출--apiclientrequest)의 진입으로 묶는다 — `ReturnRequestPage`가 `validate_form`(가상계좌 결제 주문은 환불 계좌 필수) 뒤 `ClaimApi.requestReturn`, 201이면 `ClaimComplete`, 422 `REFUND_ACCOUNT_REQUIRED`면 환불 계좌 칸 강조 | — |
| `Browser.confirmPurchase`·`Browser.showReviewPrompt`(5.13) | [`JF-1`](#jf-1-공통-api-호출--apiclientrequest)의 진입으로 묶는다 — `OrderDetailPage`가 `OrderApi.confirmLine` 200 뒤 `ReviewPromptModal`을 연다 | — |
| `Browser.attachPhoto`·`Browser.submitReview`(5.13) | [`JF-7` 리뷰 사진과 작성](#jf-7-리뷰-사진과-작성--reviewwritepageattachphoto) | — |
| `Browser.openDeepLink`·`Browser.lookupGuestOrder`·`Browser.openOrderDetail`·`Browser.openOrderList`(5.14) | [`JF-8` 주문 상세 진입](#jf-8-주문-상세-진입--orderdetailrouteenter) — `openDeepLink`·`openOrderDetail` = `OrderDetailRoute.enter`(직접 진입과 앱 안 이동이 같은 라우트 가드를 지난다), `lookupGuestOrder` = `GuestOrderLookupPage.submit`, `openOrderList` = `Router.replace('/mypage/orders')` | — |

상위 바깥 노드 ↔ 이 경계의 클라이언트: `Member.*` = `MemberApi`·`AuthApi`, `Cart.*` = `CartApi`, `Order.*` = `OrderApi`·`PaymentApi`(`/api/payments/*`는 order가 받지만 화면 쪽 이름은 주소를 따른다), `Promotion.*` = `PromotionApi`, `Catalog.*` = `CatalogApi`, `Claim.*` = `ClaimApi`, `Review.*` = `ReviewApi`, `PG.authorize` = `PgSdk.requestPayment`, `SocialIdP.authorize` = 전체 페이지 이동, `IdVerify.verifyWindow` = `IdVerifySdk.open`, `Postcode.search` = `PostcodeWidget.open`, `Storage.putObject` = `StorageUploader.put`.

**표기** 노드는 제안 컴포넌트·훅·클라이언트 심볼이다. 페이지 컴포넌트의 동작은 `XxxPage.동작`, 훅·저장소 객체는 이름 그대로 쓴다. 전역 조율자가 없어 여러 화면이 같은 공용 객체로 모이는 그림(`JF-3`·`JF-4`·`JF-8`·`JF-9`)은 `scope:`이고, 한 객체가 흐름을 조율하는 그림은 `orchestrator:`다. 모듈별 API 클라이언트는 모두 `JF-1`의 `ApiClient.request`를 지난다 — 각 그림에서는 다시 그리지 않는다. 렌더 확인 범위: 이 절의 jobflow 15개를 설계 문서 검사 도구의 렌더러로 SVG를 만들고 PNG로 바꿔 눈으로 봤다(§7). 열지 않은 것: `OptionSelector`의 옵션 조합 계산(순수 함수), `FormValidator`·`OrderValidator`·`ReviewValidator`(순수 검사 — 규칙은 각 표 비고), `PostcodeWidget`(외부 스크립트 감싸기).

### JF-1 공통 API 호출 — ApiClient.request

```jobflow
orchestrator: ApiClient
Object: ApiClient, CsrfToken, HttpTransport, ApiError, AuthGuard, Toast

ApiClient.request --> CsrfToken.read
ApiClient.request --> HttpTransport.send
HttpTransport.send.failed --> ApiError.normalize
ApiError.normalize.unauthorized --> AuthGuard.goLogin
ApiError.normalize.unavailable --> Toast.show
ApiError.normalize.rejected
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ApiClient.request` | `C-01`·`C-21` | 모든 `/api/*` 호출의 한 입구. 같은 오리진이라 쿠키(`SID`·`cartKey`·비회원 조회 토큰)는 브라우저가 붙인다. 입력 `{method, path, body?, requiresAuth?, timeoutMs?, dedupKey?}` |
| `CsrfToken.read` | `C-21`, 상위 §4.3 | `GET`이 아닌 요청만. 서버가 내려준 읽을 수 있는 쿠키 `XSRF-TOKEN`을 읽어 헤더 `X-CSRF-Token`에 넣는다([mall-api 상세 §2](mall-api.md#2-공개-계약)의 `CsrfFilter`와 같은 이름) |
| `HttpTransport.send` | `C-01` | `fetch` + `AbortController` 타임아웃(§6). 2xx면 본문을 그대로 호출 화면에 돌려준다(그리지 않음). `GET`만 연결 실패 때 1회 다시 보낸다 |
| `.failed` → `ApiError.normalize` | `C-21` | 4xx·5xx·타임아웃·연결 실패를 `{status, code, message, details}` 한 모양으로 만든다. 422 `VALIDATION_FAILED`의 `details.fields[{field, reason}]`는 필드별 오류 지도로 펼친다. 본문이 JSON이 아니면 `code:'UNKNOWN'`, 타임아웃은 `code:'TIMEOUT'` |
| `.unauthorized` → `AuthGuard.goLogin` | `R-02`·`R-03` | 401이고 `requiresAuth`인 호출만. 로그인 화면 자체의 401(`INVALID_CREDENTIALS`)이나 비회원 조회 만료는 `requiresAuth`가 아니라 `.rejected`로 간다 |
| `.unavailable` → `Toast.show` | `C-01` | 5xx·`TIMEOUT`·연결 실패의 공통 문구 「잠시 후 다시 시도해 주세요」. 결제 승인처럼 화면이 직접 다뤄야 하는 호출은 `silent`로 이 줄을 건너뛴다 |
| `.rejected` | `C-01` | 무시 분기 — 오류 객체를 호출 화면에 그대로 넘긴다. 403·404·409·410·422·423·429(`RATE_LIMITED`·`LOCKED {until}`)는 화면이 코드별로 처리한다(§6 표) |

- **트리거** 모든 화면의 서버 호출(상위 `Browser.call`). **완료 사실** 응답 본문, 또는 정규화된 오류 하나. 401·5xx의 공통 처리 뒤에도 오류는 호출 화면에 넘어간다 — 화면이 로딩 표시를 끄게 한다.
- `dedupKey`가 같은 요청이 진행 중이면 새로 보내지 않고 진행 중인 약속을 돌려준다 — 중복 클릭 방지의 마지막 방어다(§6).

### JF-2 로그인 가드와 복귀 주소 저장 — AuthGuard.ensureLogin

```jobflow
orchestrator: AuthGuard
Object: AuthGuard, MemberApi, SessionCache, ReturnUrlStore, Router

AuthGuard.ensureLogin --> MemberApi.getMe
MemberApi.getMe.result --> SessionCache.write
MemberApi.getMe.unauthorized --> AuthGuard.goLogin
AuthGuard.goLogin --> SessionCache.clear
AuthGuard.goLogin --> ReturnUrlStore.save
AuthGuard.goLogin --> Router.navigate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `AuthGuard.ensureLogin` | `R-08`·`R-17`, N4·N8 `(check_auth)` | 로그인이 필요한 라우트 진입과 「바로구매」·「선택 상품 주문」 앞에서 부른다. 결과 `true`·`false`. 캐시가 있어도 **매번** 서버에 묻는다 — 세션은 서버에서 언제든 폐기될 수 있다(`D-05`) |
| `MemberApi.getMe` | 상위 §5.5·§5.14 `Member.getMe` | `GET /api/members/me` → 200 회원 요약, 401. `requiresAuth:false`로 불러 `JF-1`의 공통 401 처리를 타지 않는다 |
| `.result` → `SessionCache.write` | `C-01` | 머리 막대의 이름·장바구니 수 표시용. 판단에는 쓰지 않는다 |
| `.unauthorized` → `AuthGuard.goLogin` | `R-02`·`R-03`, 상위 `Browser.goLogin` | 미로그인. `ensureLogin`은 `false`를 돌려주고 이동은 `goLogin`이 맡는다 |
| `ReturnUrlStore.save` | `R-03`, 상위 §7 `ReturnPage` 불릿 | 인자 없이 부르면 지금 주소(`pathname + search`), 주문 진입은 `/checkout`. 같은 오리진의 `/`로 시작하는 경로만 받는다(§4) |
| `Router.navigate` | N2·N4·N8 | `/login`으로 이동. 기록을 남겨 뒤로가기로 원래 화면에 돌아갈 수 있다 |

- **트리거** 셋 — 라우트 가드(`/mypage/*`·`/reviews/new`·`/orders/:orderId/*`), 주문 진입(`JF-4.1`), `JF-1`의 401 공통 처리(쿠폰 받기·찜). **완료 사실** `true`, 또는 복귀 주소 저장 + `LoginForm`.
- `goLogin`으로 들어오는 화살표는 이 그림의 `getMe` 401과, `JF-1`의 `ApiError.normalize.unauthorized` 둘이다 — 서로 다른 트리거의 **합류**다. 한 동작에 한 번만 일어난다. 이미 `/login`에 있으면 `goLogin`은 복귀 주소를 덮어쓰지 않는다(로그인 화면 자체가 복귀 주소가 되는 것을 막는다).
- `MemberApi.getMe.unauthorized --> AuthGuard.goLogin`은 조율자의 다른 메서드로 책임을 넘기는 줄이다. 재호출이 아니다.

### JF-3 로그인 세 갈래 — LoginPage.submit

```jobflow
scope: 로그인 세 갈래 — 일반·소셜 기존·소셜 신규
Object: LoginPage, LoginReturnPage, SocialSignupPage, FormValidator, AuthApi, MemberApi, LoginReturn

LoginPage.submit --> FormValidator.validateLogin
FormValidator.validateLogin.invalid
FormValidator.validateLogin.valid --> AuthApi.login
AuthApi.login.failed
AuthApi.login.result --> LoginReturn.restoreReturnUrl
LoginPage.startSocial --> AuthApi.openOAuthAuthorize
LoginReturnPage.mount --> LoginReturn.restoreReturnUrl
SocialSignupPage.submit --> MemberApi.signupSocial
MemberApi.signupSocial.failed
MemberApi.signupSocial.result --> LoginReturn.restoreReturnUrl
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `LoginPage.submit` → `FormValidator.validateLogin` | `R-03`, N2 `(validate_form)` | 아이디·비밀번호가 비었는지만 본다. `.invalid`는 무시 분기 — 필드 아래 문구, 서버 호출 없음 |
| `AuthApi.login` | 상위 §5.3 `Member.login` | `POST /api/auth/login {loginId, password, keepSignedIn}` → 200 + `Set-Cookie: SID`. `.failed`는 무시 분기 — 401 「아이디 또는 비밀번호가 맞지 않습니다」, 423 `LOCKED {until}` 「n분 뒤 다시」, 429 `RATE_LIMITED` 「잠시 후 다시」. `LoginForm`에 머문다 |
| `LoginPage.startSocial` → `AuthApi.openOAuthAuthorize` | 상위 §5.3 `Browser.socialLogin`·`openConsent` | `window.location.assign('/api/oauth/{provider}/authorize')` — 전체 페이지 이동이라 SPA 메모리가 사라진다. 복귀 주소가 sessionStorage에 있어야 하는 이유다. 동의 취소(IdP `error=access_denied`)는 서버 콜백이 `/login?error=social_cancelled`로, `state` 불일치·코드 교환 실패는 `/login?error=social`로 보낸다(member 상세). 신규 회원은 302 `/signup/social`(쿼리 없음 — 티켓은 httpOnly 쿠키 `SIGNUP_TICKET`) |
| `LoginReturnPage.mount` | 상위 §5.3 `Member.oauthCallback.existing` | 서버가 세션을 발급하고 302로 보낸 `/login/return`. 화면 없이 `restoreReturnUrl`을 부른다 |
| `SocialSignupPage.submit` → `MemberApi.signupSocial` | 상위 §5.3 `Browser.openSocialSignup`·`Member.signupSocial` | `POST /api/signup/social {termsAgreements[], phone?}` → 201 + 세션. 티켓은 본문이 아니라 브라우저가 붙이는 쿠키 `SIGNUP_TICKET`이다 — 화면은 주소 쿼리를 읽지 않는다. `.failed` — 410 `TICKET_EXPIRED`는 `/login?error=social`, 409 `SOCIAL_ALREADY_LINKED`는 문구 |
| `LoginReturn.restoreReturnUrl` | 상위 `Browser.restoreReturnUrl` | 안쪽은 `JF-3.1` |

- **트리거** 셋 — 「로그인」, 소셜 기존 회원 복귀(`/login/return`), 소셜 가입 제출. **완료 사실** 세션 쿠키가 생기고 `restoreReturnUrl`이 한 번 실행된다.
- `restoreReturnUrl`로 들어오는 화살표 셋은 택일 경로의 **합류**다 — 상위 §5.3과 같다. 한 로그인에 한 번 실행된다. 같은 탭에서 두 번 실행되면(두 번 제출 등) 두 번째는 복귀 주소가 이미 지워져 `Home`으로 간다 — 병합은 멱등이라 결과가 같다(`R-23`).
- 「비회원 구매」(N4)는 서버 호출 없이 `/checkout/guest-terms`로 간다. 동의하면 주문서 임시 상태에 `guestConsent.agreedAt`을 적고 `/checkout`으로 간다.

### JF-3.1 장바구니 병합과 복귀 — LoginReturn.restoreReturnUrl

```jobflow
orchestrator: LoginReturn
Object: LoginReturn, SessionCache, CartApi, ReturnUrlStore, Router

LoginReturn.restoreReturnUrl --> SessionCache.clear
LoginReturn.restoreReturnUrl --> CartApi.mergeGuestCart
CartApi.mergeGuestCart.failed
CartApi.mergeGuestCart.result --> CartApi.getCart
LoginReturn.restoreReturnUrl --> ReturnUrlStore.take
ReturnUrlStore.take.result --> Router.replace
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SessionCache.clear` | `C-01` | 비회원 때의 머리 막대 값을 버린다. 다음 화면이 다시 읽는다 |
| `CartApi.mergeGuestCart` | 상위 §5.3 `Cart.mergeGuestCart`, `R-23` | `POST /api/cart/merge` → 200 요약 `{itemCount, mergedSkuCount, clampedSkuIds[], droppedItemCount}`(장바구니 내용은 싣지 않는다), 204 `cartKey` 없음·이미 병합됨. 타임아웃 3초. **기다린 뒤** 복귀한다 — 복귀 주소가 `/checkout`이면 주문서가 병합된 장바구니를 읽어야 하기 때문이다 |
| `.result` → `CartApi.getCart` | `R-23`, [cart 상세 §2](cart.md#2-공개-계약) | 200이면 `GET /api/cart`로 병합된 장바구니를 다시 읽어 머리 막대 수를 갱신하고 서버 응답 캐시를 바꾼다. `clampedSkuIds`가 있으면 「일부 상품 수량이 최대 수량으로 조정되었습니다」, `droppedItemCount > 0`이면 「판매가 끝난 상품 n개를 뺐습니다」 토스트. 이 읽기의 실패도 복귀를 막지 않는다 |
| `.failed` | `R-23`, 상위 §5.3 실패 분기 | 무시 분기 — 실패·타임아웃이어도 복귀를 계속한다. 다음 장바구니 열기 때 `CartPage`가 병합을 한 번 더 부른다(멱등) |
| `ReturnUrlStore.take` | `R-03`, N2 `restore_return_url` | 저장한 경로를 꺼내며 지운다. 없거나, 30분이 지났거나, 허용하지 않는 경로면 `/`(§4) |
| `.result` → `Router.replace` | N2 `ReturnPage`·`Home` | 주소를 **교체**해 뒤로가기로 `LoginForm`에 돌아오지 않게 한다 |

- **완료 사실** 병합을 한 번 시도하고 복귀 주소(없으면 `Home`)로 교체 이동.
- **드러난 사실** 병합할 때 회원 장바구니에 같은 SKU가 이미 있으면 비회원 행이 지워지고 회원 행으로 합쳐진다([cart 상세 `JF-2.1`](cart.md#jf-21-비회원-장바구니-병합--cartservicemergeguestcart) — 새 SKU는 ID가 그대로다). 그 품목은 로그인 전에 저장한 주문서 임시 상태의 `cartItemId`가 없는 ID가 된다 — 결제 뒤 장바구니에서 지워지지 않는다. 그래서 주문서는 진입할 때 장바구니를 다시 읽어 `skuId`로 현재 `cartItemId`를 찾는다(`JF-5`, §8).

### JF-4 담기와 주문 진입 — ProductDetailPage.addToCart

```jobflow
scope: 상품 상세·장바구니에서 담기와 주문 진입
Object: ProductDetailPage, CartPage, OptionSelector, CartApi, CheckoutEntry

ProductDetailPage.addToCart --> OptionSelector.checkForCart
OptionSelector.checkForCart.incomplete
OptionSelector.checkForCart.result --> CartApi.addItem
CartApi.addItem.failed
CartApi.addItem.result --> ProductDetailPage.showCartAdded
ProductDetailPage.buyNow --> OptionSelector.checkForBuy
OptionSelector.checkForBuy.incomplete
OptionSelector.checkForBuy.result --> CheckoutEntry.start
CartPage.orderSelected --> CheckoutEntry.start
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OptionSelector.checkForCart`·`checkForBuy` | `R-07`, N4 `(check_option_for_cart)`·`(check_option_for_buy)` | 모든 옵션 축을 골랐는지, 고른 조합의 SKU가 품절이 아닌지 본다. `.incomplete`는 무시 분기 — 빠진 옵션에 초점과 문구, `ProductDetail`에 머문다. 결과는 `[{skuId, quantity}]` |
| `CartApi.addItem` | 상위 §5.5 `Cart.addItem` | `POST /api/cart/items {skuId, quantity}` → 201. 비회원이면 서버가 `cartKey` 쿠키를 새로 단다. `.failed` — 409 `SOLD_OUT`·`MAX_QUANTITY` 토스트, 404 「판매 종료」 |
| `.result` → `ProductDetailPage.showCartAdded` | 상위 `Browser.showCartAdded`, N4 `CartAddedModal` | 모달 열기, 머리 막대 장바구니 수 갱신 |
| `CartPage.orderSelected` → `CheckoutEntry.start` | 상위 `Browser.startCheckout`, N4 `Cart --> (check_auth)` | 고른 품목 `[{skuId, quantity, cartItemId}]`. 품절·판매중지 품목은 고를 수 없다 |
| `CheckoutEntry.start` | 상위 `Browser.startCheckout` | 안쪽은 `JF-4.1` |

- **트리거** 「장바구니 담기」, 「바로구매」, 「선택 상품 주문」. **완료 사실** 장바구니 품목 + 확인 모달, 또는 주문 진입.
- `CheckoutEntry.start`로 들어오는 화살표 둘은 서로 다른 화면 동작의 **합류**다. 한 동작에 한 번이다. 바로구매는 장바구니를 거치지 않는다(상위 §5.5) — 주문서 임시 상태의 `source`가 `direct`라 결제 뒤 장바구니에서 지울 품목이 없다.

### JF-4.1 주문 진입 — CheckoutEntry.start

```jobflow
orchestrator: CheckoutEntry
Object: CheckoutEntry, CheckoutDraft, AuthGuard, Router

CheckoutEntry.start --> CheckoutDraft.save
CheckoutEntry.start --> AuthGuard.ensureLogin
AuthGuard.ensureLogin.true --> Router.navigate
AuthGuard.ensureLogin.false
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CheckoutDraft.save` | `R-08`, `C-01` | 주문서 임시 상태를 **로그인 확인보다 먼저** 저장한다 — 로그인·소셜 이동(전체 페이지 이동)을 지나도 품목이 남아야 한다(§4) |
| `AuthGuard.ensureLogin` | N4 `(check_auth)` | `JF-2` |
| `.true` → `Router.navigate` | N4 `(check_auth) --> Checkout : 로그인됨` | `/checkout` |
| `.false` | N4 `(check_auth) --> LoginForm : 미로그인` | 무시 분기 — `AuthGuard.goLogin`이 이미 복귀 주소 `/checkout`을 저장하고 `LoginForm`으로 보냈다 |

- `LoginForm`에서 「비회원 구매」를 고르면 `GuestCheckoutTerms`를 거쳐 같은 주문서 임시 상태로 `/checkout`에 온다(N4).

### JF-5 주문서 견적 — CheckoutPage.open

```jobflow
orchestrator: CheckoutPage
Object: CheckoutPage, CheckoutDraft, CartApi, PostcodeWidget, CouponModal, PromotionApi, OrderApi

CheckoutPage.open --> CheckoutDraft.load
CheckoutDraft.load.empty
CheckoutDraft.load.fromCart --> CartApi.getCart
CheckoutPage.open --> OrderApi.previewCheckout
CheckoutPage.searchAddress --> PostcodeWidget.open
PostcodeWidget.open.result --> OrderApi.previewCheckout
CheckoutPage.openCouponModal --> CouponModal.open
CouponModal.open --> PromotionApi.listMyCoupons
CouponModal.open.applied --> OrderApi.previewCheckout
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CheckoutPage.open` → `CheckoutDraft.load` | 상위 `Browser.openCheckout`, 추가 이동 E `(check_checkout_access)` | 라우트 가드가 회원이거나 `guestConsent`가 있는지 먼저 본다(그리지 않음). `.empty`는 무시 분기 — 임시 상태가 없으면 `/cart`로 교체 |
| `.fromCart` → `CartApi.getCart` | `R-23`, `JF-3.1` 드러난 사실 | `source:'cart'`면 `GET /api/cart`로 `skuId` → 현재 `cartItemId`를 다시 맞춘다. 장바구니에서 사라진 품목은 주문서에서 뺀다 |
| `OrderApi.previewCheckout` | 상위 §5.5·§5.6 `Order.previewCheckout`, `R-09` | `POST /api/orders/preview {lines[{skuId, quantity, cartItemId?}], couponIds[], zipcode?}` → 200 `{itemsAmount, discountAmount, shippingFee, payAmount, shippingFeeEstimated, lines[], coupons[{couponId, discount, unavailableReason?}]}`. `payAmount`가 화면 금액이고, 그대로 `expectedAmount`가 된다. 409 `SOLD_OUT {skuIds}`는 그 품목을 품절로 표시, 422 `VALIDATION_FAILED`는 폼 위 문구 |
| `CheckoutPage.searchAddress` → `PostcodeWidget.open` | 상위 `Browser.searchAddress`·`Postcode.search`, N5 `AddressSearchModal` | 우편번호 위젯(가정 — 카카오 우편번호 서비스형 스크립트). 결과 도로명·지번·우편번호. `.result` 뒤 재견적 — 도서산간 배송비가 우편번호로 바뀐다 |
| `CheckoutPage.openCouponModal` → `CouponModal.open` → `PromotionApi.listMyCoupons` | 상위 `Browser.openCouponModal`·`Promotion.listMyCoupons`, N5 `CouponSelectModal` | `GET /api/members/me/coupons?usable=true` → 지금 쓸 수 있는 보유 쿠폰 목록(이름·할인 유형·값·최소 주문 금액·대상). 이 주문에 적용되는지와 할인액은 이 응답에 없다 — 화면은 판정하지 않고 쿠폰 조건만 보인다. 비회원에게는 버튼을 숨긴다 |
| `CouponModal.open.applied` → `OrderApi.previewCheckout` | 상위 `Browser.applyCoupon` | 고른 쿠폰으로 재견적. 견적 응답의 `coupons[]`가 쿠폰별 평가다 — `discount`를 그 쿠폰 옆에 보이고, `unavailableReason`이 있는 쿠폰은 「이 주문에 쓸 수 없음 — 사유」로 표시하고 `couponIds`에서 뺀다. 할인액은 이 서버 견적만 보인다 |

- **완료 사실** 서버 견적 금액이 화면에 보이고 주문서 임시 상태에 쿠폰·배송지가 저장된다.
- `previewCheckout`으로 들어오는 화살표 셋은 서로 다른 트리거(진입·우편번호·쿠폰)가 같은 계약을 부르는 **실제 재호출**이다. 견적이 겹치면 마지막 요청의 응답만 쓴다(앞 요청은 `AbortController`로 끊는다). 견적이 도착하기 전에는 「결제하기」를 막는다(§2.2).
- **역할 분담** 화면은 형식만 보고(필수 입력·휴대폰 `010`·우편번호 5자리), 금액·재고·쿠폰 조건은 서버 견적과 주문 생성이 판단한다.

### JF-5.1 주문 생성 — CheckoutPage.placeOrder

```jobflow
orchestrator: CheckoutPage
Object: CheckoutPage, SubmitLock, OrderValidator, OrderApi, PaymentLauncher

CheckoutPage.placeOrder --> SubmitLock.acquire
SubmitLock.acquire.busy
SubmitLock.acquire.result --> OrderValidator.validateOrder
OrderValidator.validateOrder.invalid
OrderValidator.validateOrder.result --> OrderApi.placeOrder
OrderApi.placeOrder.invalid
OrderApi.placeOrder.result --> PaymentLauncher.launch
OrderApi.placeOrder.conflict --> OrderApi.previewCheckout
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SubmitLock.acquire` | `C-01`, §6 중복 클릭 | 버튼 잠금 + 진행 중 표시. `.busy`는 무시 분기 — 진행 중이면 아무것도 하지 않는다. 잠금은 `PaymentLauncher.launch`가 끝나거나 오류로 돌아올 때 푼다 |
| `OrderValidator.validateOrder` | N5 `(validate_order)` | 배송지·주문자·결제수단·약관(비회원은 주문 비밀번호 6~20자와 동의 시각). `.invalid`는 무시 분기 — 첫 오류 필드로 초점 |
| `OrderApi.placeOrder` | 상위 §5.6 `Order.placeOrder`, `R-09` | `POST /api/orders {lines, couponIds, shippingAddress, orderer, paymentMethod, expectedAmount, guest?{password, privacyAgreedAt}}` → 201 `{orderId, orderNo, amount, orderName}`. 비회원이면 서버가 조회 토큰 쿠키 `GOT`에 이 주문을 더하고, 화면은 `GuestAccessStore.save`로 표시 목록에 주문 ID를 더한다(`JF-8`). 타임아웃 15초 |
| `.conflict` → `OrderApi.previewCheckout` | 상위 `Order.placeOrder.rejected`, N5 `(/orders) --> Checkout : 재고 부족` | 409 셋 — `PRICE_CHANGED {amount}`: `Checkout(PriceChangedDialog)`에 바뀐 금액을 보이고 확인하면 재견적, `OUT_OF_STOCK {skuIds}`: 그 품목 표시 + 재견적, `COUPON_UNAVAILABLE`: 쿠폰을 빼고 재견적. 서버가 롤백해 주문이 남지 않으므로 재견적 뒤 다시 누르면 된다 |
| `.invalid` | 상위 `Order.placeOrder.rejected` | 무시 분기 — 422 `VALIDATION_FAILED`의 `details.fields[{field, reason}]`를 필드 오류로, `GUEST_CONSENT_REQUIRED`는 `/checkout/guest-terms`로 |
| `.result` → `PaymentLauncher.launch` | 상위 `Browser.openPgWindow`·`chooseVirtualAccount` | `JF-5.2` |

- **실패 분기** 5xx·타임아웃은 `JF-1`의 공통 토스트 뒤 `editing`으로 돌아간다. 이때 서버가 주문을 만들었는지 모른다 — 그 주문은 결제 없이 30분 뒤 만료된다(`R-20`). 다시 누르면 새 주문이 생긴다(§8).
- `OrderApi.placeOrder.conflict --> OrderApi.previewCheckout`은 같은 객체 안 화살표처럼 보이지만, `CheckoutPage`가 409를 받고 견적을 **다시 부르는** 실제 재호출이다.

### JF-5.2 결제 시작 — PaymentLauncher.launch

```jobflow
orchestrator: PaymentLauncher
Object: PaymentLauncher, PendingPayment, PgSdk, OrderApi, PaymentApi, Router

PaymentLauncher.launch --> PendingPayment.save
PaymentLauncher.launch --> PgSdk.requestPayment
PgSdk.requestPayment.userCancel --> OrderApi.cancelOrder
PaymentLauncher.launch --> PaymentApi.issueVirtualAccount
PaymentApi.issueVirtualAccount.failed
PaymentApi.issueVirtualAccount.result --> Router.replace
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PendingPayment.save` | `R-10`·`R-18` | 결제 진행 기록 `{orderId, orderNo, amount, method, guest, approveRequestedAt:null}`을 sessionStorage에 쓴다. 결제창은 다른 주소로 이동하므로 복귀 화면이 이것으로 주문을 안다(§4) |
| `PgSdk.requestPayment` | 상위 §5.6 `PG.authorize`, N5 `PgPaymentWindow` | 카드·간편결제만. `{method, orderId: orderNo, amount, orderName, customerName, successUrl: origin + '/checkout/pg-return', failUrl: 같은 주소}`(가정 — 토스페이먼츠형 SDK). 모바일은 전체 페이지 이동, PC는 창이 뜨고 끝나면 같은 복귀 주소로 이동한다(가정) |
| `.userCancel` → `OrderApi.cancelOrder` | `R-20`, 상위 §5.10 트리거 | PC 창을 고객이 닫아 SDK 약속이 거절된 경우(가정 — 일부 SDK만 복귀 주소 대신 약속 거절로 알린다). `POST /api/orders/{orderId}/cancel {reason:'PG_USER_CANCEL'}` 뒤 결과와 상관없이 결제 진행 기록을 지우고 `Checkout`에 머문다. 취소가 실패하면 서버 만료 타이머(30분)가 푼다 |
| `PaymentApi.issueVirtualAccount` | 상위 §5.9 `Browser.chooseVirtualAccount`·`Order.issueVirtualAccount` | 무통장입금만. `POST /api/payments/virtual-accounts {orderId, bankCode, depositorName, cashReceipt?}` → 201 `{bank, accountNumber, amount, dueAt}`(order 상세 §2). 타임아웃 40초(서버가 PG를 30초 기다린다) |
| `.failed` | N5 `(/payment/virtual_account) --> Checkout : error` | 무시 분기 — 502 `PG_ERROR`·타임아웃이면 `Checkout(RetryIssueDialog)`. 「다시 시도」는 **같은 주문**으로 다시 부른다(같은 계좌를 받을지 새 시도로 발급할지는 서버가 멱등 키로 정한다 — 추가 이동 G). 주문을 취소하지 않는다 — PG가 계좌를 발급했는지 모를 수 있어서다(§8) |
| `.result` → `Router.replace` | N5 `OrderComplete : 가상계좌 발급`, 추가 이동 G | 주문서 임시 상태·결제 진행 기록을 지우고 `/orders/{orderId}/complete`로 교체 |

- 카드·간편결제와 무통장입금은 결제수단에 따른 **택일**이다 — 한 번의 `launch`에서 `requestPayment`와 `issueVirtualAccount` 중 하나만 부른다(N5 `(branch_payment_method)`).
- 결제창이 복귀 주소로 돌아오는 것은 SDK 밖의 브라우저 이동이다 — 그 뒤는 `JF-6`이 새 페이지 로드로 받는다.

### JF-6 PG 복귀와 승인 — PaymentConfirmingPage.handleReturn

```jobflow
orchestrator: PaymentConfirmingPage
Object: PaymentConfirmingPage, PgReturnParams, PendingPayment, OrderApi, PaymentApi, OrderStatusPoller, Router

PaymentConfirmingPage.handleReturn --> PgReturnParams.take
PgReturnParams.take.failure --> OrderApi.cancelOrder
PgReturnParams.take.success --> PendingPayment.markRequested
PendingPayment.markRequested.first --> PaymentApi.approve
PaymentApi.approve.paid --> Router.replace
PaymentApi.approve.failed --> Router.replace
PaymentApi.approve.pending --> OrderStatusPoller.start
PendingPayment.markRequested.again --> OrderStatusPoller.start
PgReturnParams.take.none --> OrderStatusPoller.start
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PgReturnParams.take` | 상위 §5.7 `Browser.returnFromPg` | 쿼리를 읽고 곧바로 `history.replaceState`로 주소에서 지운다 — 새로고침이 같은 쿼리로 승인을 다시 보내지 않게 한다. 결과 셋: `success {paymentKey, orderId, amount}`, `failure {code, message}`, `none`(쿼리 없음 — 새로고침·뒤로가기) |
| `.failure` → `OrderApi.cancelOrder` | `R-20`, 상위 §5.10 트리거, 추가 이동 F | 주문 ID는 실패 쿼리가 아니라 결제 진행 기록에서 읽는다(업체마다 실패 쿼리에 주문 ID가 없을 수 있다 — 가정). `POST /api/orders/{orderId}/cancel {reason:'PG_FAILED'}` → 결과와 상관없이 기록을 지우고 `/checkout`으로 교체, `message`를 문구로. 기록이 없으면 취소 없이 `/checkout` |
| `.success` → `PendingPayment.markRequested` | `R-18`, `D-04` | 기록의 `approveRequestedAt`이 비었으면 지금 시각을 쓰고 `.first`, 이미 있으면 `.again`. 쿼리의 `orderId`가 기록과 다르면 기록을 믿지 않고 `.again`처럼 주문을 읽는다 |
| `.first` → `PaymentApi.approve` | 상위 §5.7 `Order.approvePayment` | `POST /api/payments/{paymentKey}/approve {orderId, amount}`, 타임아웃 45초, `silent`(공통 토스트 없음). 화면은 금액을 따로 판정하지 않는다 — 서버가 저장 금액과 대조한다(400 `AMOUNT_MISMATCH`) |
| `.paid` → `Router.replace` | 200 `{status:'PAID'}`, N5 `OrderComplete : paid` | 주문서 임시 상태·결제 진행 기록을 지우고 `/orders/{orderId}/complete`로 교체 |
| `.failed` → `Router.replace` | 402 `PAYMENT_DECLINED`·400 `AMOUNT_MISMATCH`, N5 `Checkout : failed` | 기록을 지우고 `/checkout`으로 교체, `message` 문구. 주문서 임시 상태는 남겨 다시 결제할 수 있다. 서버가 이미 가예약·쿠폰을 풀었다(상위 `.declined`) |
| `.pending` → `OrderStatusPoller.start` | 202 `{status:'APPROVING'}`, 409 `INVALID_STATE`, 5xx(`ORDER_COMMIT_FAILED` 포함)·`TIMEOUT`·연결 실패 | 결과를 모르는 것을 한데 모은다. 409는 다른 탭이나 앞선 요청이 이미 처리했다는 뜻이다 — 상위 §7 동시성 불릿대로 주문을 다시 읽는다. 5xx는 승인 뒤 확정이 실패해 서버가 망취소했거나(→ 폴링이 `PAYMENT_FAILED`를 본다) 일시 오류로 대사에 맡긴 경우다 — 화면은 둘을 가르지 않고 주문 상태로 판정한다 |
| `.again`·`.none` → `OrderStatusPoller.start` | 추가 이동 F `(check_pending_payment)` | 승인을 다시 보내지 않는다. 결제 진행 기록이 없으면(`none`이고 기록도 없음) 폴링 대신 `/mypage/orders`로 교체(회원) 또는 `/guest/orders`(비회원) |

- **트리거** PG 결제창의 성공·실패 복귀, 같은 주소 새로고침·뒤로가기. **완료 사실** `OrderComplete`나 `Checkout`으로 교체 이동, 또는 폴링 시작.
- `Router.replace`로 들어오는 화살표 둘(`.paid`·`.failed`)은 택일 결과의 **합류**다 — 행선지는 결과마다 다르고 한 번만 일어난다. `OrderStatusPoller.start`로 들어오는 화살표 셋은 서로 다른 진입(승인 결과 불명·두 번째 진입·쿼리 없음)의 **합류**다. 한 페이지 로드에 한 번만 시작한다(`PaymentConfirmingPage`가 시작 여부를 기억한다).
- **새로고침·뒤로가기 중복 방지는 세 겹이다** — ① 쿼리를 주소에서 지운다, ② 결제 진행 기록의 `approveRequestedAt`, ③ 서버의 조건부 전이 `PENDING_PAYMENT → APPROVING`(두 번째 요청은 409). ①②는 같은 탭만 막고, 다른 탭·다른 기기는 ③이 막는다.
- **실패 복귀의 순서** 취소를 기다린 뒤 이동한다. 결제창을 닫은 고객이 곧바로 「결제하기」를 다시 눌러도 앞 주문의 가예약이 풀려 있게 하려는 것이다(`R-20`).

### JF-6.1 주문 상태 폴링 — OrderStatusPoller.start

```jobflow
orchestrator: OrderStatusPoller
Object: OrderStatusPoller, OrderApi, Router

OrderStatusPoller.start --> OrderApi.getOrder
OrderApi.getOrder.approving
OrderApi.getOrder.paid --> Router.replace
OrderApi.getOrder.failed --> Router.replace
OrderStatusPoller.start.timedOut
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderApi.getOrder` | 상위 §5.7 `Browser.showOrderResult`, §5.14 `Order.getOrder` | `GET /api/orders/{orderId}`. 바로 한 번, 그 뒤 3초마다 — 최대 1분(20회 안팎). 앞 요청이 끝나기 전에 다음을 보내지 않는다 |
| `.approving` | 상위 §5.8 — 대사 조회가 `unknown`이면 `Order.settle`에 들어가지 않고 다음 틱에 다시 묻는다([order 상세 `JF-10A`](order.md#jf-10a-승인-결과-불명)) | 무시 분기 — `APPROVING`·`PENDING_PAYMENT`·`NET_CANCELLING`이면 다음 틱에 다시 묻는다. 「결제 확인 중」 문구를 유지한다 |
| `.paid` → `Router.replace` | 상위 §5.8 종결 입구 `Order.settle.paid` | `PAID`(또는 그 뒤 상태). 기록을 지우고 `/orders/{orderId}/complete`로 교체 |
| `.failed` → `Router.replace` | 상위 §5.8 종결 입구 `Order.settle.released`(order `JF-10A`의 `.notPaid`) | `PAYMENT_FAILED`·`EXPIRED`·`CANCELLED`. 기록을 지우고 `/checkout`으로 교체 |
| `.timedOut` | 상위 §5.8 셋째 불릿 | 무시 분기 — 1분이 지나거나 주문이 `MANUAL_REVIEW`(운영자 확인 대기)면 폴링을 멈추고 `PaymentConfirming(CheckLaterNotice)` 「결제 확인 중 — 주문 내역에서 확인하세요」. 기록은 남긴다(새로고침하면 다시 폴링) |

- `OrderApi.getOrder` 화살표 하나가 3초 간격의 **실제 재호출**이다. 404·403은 `.failed`처럼 다루지 않고 `.timedOut`과 같은 안내를 보인다 — 비회원 조회 토큰이 없는 등 화면 쪽 사정일 수 있어서다.
- 화면을 떠나면(언마운트) 타이머를 멈춘다. 서버의 대사 타이머가 결과를 닫으므로 화면이 끝까지 지켜볼 필요는 없다(상위 §5.8).

### JF-7 리뷰 사진과 작성 — ReviewWritePage.attachPhoto

```jobflow
orchestrator: ReviewWritePage
Object: ReviewWritePage, PhotoPicker, ReviewApi, StorageUploader, ReviewValidator, Router

ReviewWritePage.attachPhoto --> PhotoPicker.pick
PhotoPicker.pick.rejected
PhotoPicker.pick.result --> ReviewApi.issueUploadUrl
ReviewApi.issueUploadUrl.result --> StorageUploader.put
StorageUploader.put.failed
ReviewWritePage.submitReview --> ReviewValidator.validateReview
ReviewValidator.validateReview.invalid
ReviewValidator.validateReview.result --> ReviewApi.createReview
ReviewApi.createReview.failed
ReviewApi.createReview.result --> Router.replace
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PhotoPicker.pick` | `R-15`, `C-17` | 파일 고르기. 이미지 형식(`jpeg`·`png`·`webp`)·장당 10MB·최대 5장을 화면에서 먼저 본다. `.rejected`는 무시 분기 — 문구만 |
| `ReviewApi.issueUploadUrl` | 상위 §5.13 `Review.issueUploadUrl` | `POST /api/reviews/upload-urls {count, contentTypes[]}` → 서명 URL과 키(10분) |
| `StorageUploader.put` | 상위 §5.13 `Storage.putObject` | 서명 URL로 `PUT`(브라우저 → 객체 저장소 직접, 장당 60초). 성공한 키만 화면 상태에 모은다. `.failed`는 무시 분기 — 그 사진에 「다시 올리기」 |
| `ReviewValidator.validateReview` | N6 `(validate_review)` | 별점 1~5, 본문 10~2000자, 올리는 중인 사진이 없을 것. `.invalid`는 무시 분기 |
| `ReviewApi.createReview` | 상위 §5.13 `Review.createReview` | `POST /api/reviews {orderLineId, rating, content, imageKeys[]}` → 201. `.failed` — 403 `NOT_CONFIRMED`·409 `ALREADY_REVIEWED`는 문구 뒤 주문 상세로, 422는 필드 오류 |
| `.result` → `Router.replace` | N6 `(/reviews) --> MyReviewList : success` | `/mypage/reviews`로 교체 |

- **역할 분담** 구매확정 여부와 1품목 1리뷰는 서버가 order에 묻는다(상위 §5.13). 화면 검사는 글자 수·별점·파일 형식뿐이다.
- 사진을 올린 뒤 리뷰를 내지 않고 떠나면 저장소에 주인 없는 파일이 남는다 — 정리는 review 모듈의 보존 파기(`purgeExpired`)가 한다(review 상세).

### JF-8 주문 상세 진입 — OrderDetailRoute.enter

```jobflow
scope: 주문 상세 진입 — 회원·비회원·알림톡 링크
Object: GuestOrderLookupPage, OrderDetailRoute, GuestAccessStore, AuthGuard, OrderApi, Router

GuestOrderLookupPage.submit --> OrderApi.lookupGuestOrder
OrderApi.lookupGuestOrder.failed
OrderApi.lookupGuestOrder.result --> GuestAccessStore.save
OrderApi.lookupGuestOrder.result --> Router.navigate
OrderDetailRoute.enter --> GuestAccessStore.check
GuestAccessStore.check.member --> AuthGuard.ensureLogin
AuthGuard.ensureLogin.true --> OrderApi.getOrder
GuestAccessStore.check.guest --> OrderApi.getOrder
OrderApi.getOrder.notOwner --> Router.replace
OrderApi.getOrder.guestExpired --> Router.replace
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `GuestOrderLookupPage.submit` → `OrderApi.lookupGuestOrder` | 상위 §5.14 `Browser.lookupGuestOrder`·`Order.lookupGuestOrder`, N7 | `POST /api/guest/orders/lookup {orderNo, password}` → 200 `{orderId}` + 조회 토큰 쿠키 `GOT`(서버가 설정, 30분 — 이미 유효한 토큰이 있으면 그 토큰에 이 주문을 더하고 수명을 갱신한다). 화면 검사: 주문 비밀번호 6~20자. `.failed` — 404 `NOT_FOUND` 「주문번호 또는 비밀번호를 확인해 주세요」, 429 `LOCKED {until}` 「{until}까지 조회할 수 없습니다」 |
| `.result` → `GuestAccessStore.save`·`Router.navigate` | `D-07`, 추가 이동 H | 표시 목록 `{orderIds[], expiresAt}`에 이 주문을 더하고(최대 5 — 넘치면 가장 오래된 것을 뺀다) `expiresAt`을 지금+30분으로 갱신한 뒤 `/orders/{orderId}`로 이동. 토큰 자체는 httpOnly 쿠키라 화면이 갖지 않는다 |
| `OrderDetailRoute.enter` | 상위 `Browser.openDeepLink`·`openOrderDetail`, N8 진입 | `/orders/:orderId`와 그 하위 라우트의 가드. 알림톡 링크 직접 진입, 주문 목록 선택, 완료 화면의 「주문 상세 보기」가 모두 여기를 지난다 |
| `GuestAccessStore.check` | `R-16`·`R-17` | 표시가 만료 전이고 그 주문 ID가 `orderIds`에 있으면 `.guest`, 아니면 `.member` — 서버도 「요청 주문 ∈ 토큰의 주문 목록」으로 판단한다(order 상세) |
| `.member` → `AuthGuard.ensureLogin` | N8 `(check_auth)`, 상위 `Member.getMe` | `JF-2`. 미로그인이면 복귀 주소 = 이 주문 주소로 `LoginForm`(N8) |
| `OrderApi.getOrder` | 상위 `Order.getOrder`, N8 `(/orders/detail)` | `GET /api/orders/{orderId}` → 200 상세를 `OrderDetailPage`가 그린다 |
| `.notOwner` → `Router.replace` | 403 `NOT_OWNER`, N8 `OrderList : 본인 주문 아님` | `/mypage/orders`로 교체, 「본인 주문이 아닙니다」 토스트. 404도 같다 |
| `.guestExpired` → `Router.replace` | 401(비회원 표시로 들어왔는데 토큰 만료), 추가 이동 H | 표시 목록 전체를 지우고(토큰 하나가 모든 주문을 가리키므로 함께 만료됐다) `/guest/orders`로 교체 |

- **트리거** 셋 — 비회원 주문조회 제출, 알림톡 링크 직접 진입(N8), 앱 안의 주문 상세 이동. **완료 사실** 본인 주문의 상세가 보이거나, `LoginForm`·`OrderList`·`GuestOrderLookup`으로 간다.
- `OrderApi.getOrder`로 들어오는 화살표 둘은 택일 경로(회원·비회원)의 **합류**다 — 한 진입에 한 번이다. `Router.replace`로 들어오는 둘도 택일 결과의 합류다.
- **드러난 사실** 비회원 조회 토큰은 httpOnly 쿠키라 화면이 볼 수 없다. 그래서 가드가 `GET /api/members/me`를 건너뛸지 판단하려면 이 탭의 표시(`GuestAccessStore`)가 따로 있어야 한다. 표시 없이 가드를 돌리면 비회원이 조회 직후 `LoginForm`으로 끌려간다. 비회원 **주문 직후**(결제 복귀·완료 화면)도 같은 표시가 필요하다 — 주문 생성 201이 조회 토큰 쿠키 `GOT`에 그 주문을 더한다([order 상세 §2](order.md#2-공개-계약)). 화면은 그 201을 받을 때 같은 표시 목록에 주문 ID를 더한다(`JF-5.1`).
- 취소(`JF-10`)·구매확정·반품 진입은 `OrderDetailPage`가 그린 상세 위의 동작이다. 비회원 표시로 연 주문도 같은 동작을 쓴다(상위 §5.14 완료 사실).

### JF-9 가입과 비밀번호 재설정 — TermsPage.agreeTerms

```jobflow
scope: 가입과 비밀번호 재설정 — 본인인증 창과 가입 임시 상태
Object: TermsPage, ForgotPasswordPage, SignupFormPage, IdVerifySdk, MemberApi, SignupDraft, Router

TermsPage.agreeTerms --> IdVerifySdk.open
IdVerifySdk.open.cancelled
IdVerifySdk.open.result --> MemberApi.checkDuplicate
MemberApi.checkDuplicate.failed
MemberApi.checkDuplicate.result --> SignupDraft.save
SignupDraft.save --> Router.replace
SignupFormPage.submit --> SignupDraft.load
SignupDraft.load.result --> MemberApi.signup
MemberApi.signup.result --> Router.replace
ForgotPasswordPage.verify --> IdVerifySdk.open
ForgotPasswordPage.submitNewPassword --> MemberApi.resetPassword
MemberApi.resetPassword.result --> Router.replace
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `TermsPage.agreeTerms` → `IdVerifySdk.open` | 상위 §5.4 `Browser.agreeTerms`·`IdVerify.verifyWindow`, N3 | 필수 약관을 모두 골랐는지 본 뒤 본인인증 창을 연다(주소 이동 없음 — SDK 창, 가정). 고른 약관은 이 단계에서는 페이지 메모리에만 둔다 |
| `.cancelled` | N3 `IdentityVerificationWindow --> TermsAgreement : 인증 취소` | 무시 분기 — 창을 닫으면 연 화면에 머문다 |
| `.result` → `MemberApi.checkDuplicate` | 상위 `Browser.checkDuplicate`·`Member.checkDuplicate` | SDK가 준 `identityToken`(업체 거래 ID)을 `POST /api/members/check-duplicate {identityToken}`에 싣는다. 화면은 토큰을 해석하지 않는다 — 서버가 업체에 다시 묻는다 |
| `MemberApi.checkDuplicate.failed` | member 상세 §2 | 무시 분기 — 422 `VERIFICATION_FAILED`(실패·만료·재사용) 「본인인증을 다시 해 주세요」, 422 `UNDER_14` 「만 14세 미만은 가입할 수 없습니다」, 502 `IDV_UNAVAILABLE` 「잠시 후 다시」. `TermsAgreement`에 머문다 |
| `.result` → `SignupDraft.save` | 상위 `Member.checkDuplicate.existing`·`.new` | 가입 임시 상태(§4 `om.signupDraft`)에 약관과 결과를 한 번에 쓴다 — `NEW`면 `verificationId`, `EXISTING`이면 `maskedLoginId`·`socialProviders[]` |
| `SignupDraft.save` → `Router.replace` | 상위 `Browser.showExistingAccount`·`Browser.openSignupForm` | `EXISTING` → `/signup/existing`, `NEW` → `/signup/form`. 교체 이동이라 뒤로가기로 본인인증 단계에 돌아오지 않는다 |
| `SignupFormPage.submit` → `SignupDraft.load` | 상위 `Browser.openSignupForm`, N3 `(validate_form)` | 형식 검사(아이디·비밀번호 규칙·이메일) 뒤 임시 상태에서 `verificationId`와 약관을 꺼낸다. 임시 상태가 없으면 `/signup/terms`로 교체(그리지 않음) |
| `.result` → `MemberApi.signup` | 상위 `Member.signup` | `POST /api/signup {verificationId, loginId, password, email, termsAgreements[]}` → 201 + 세션. 409 `LOGIN_ID_TAKEN`은 칸 문구, `CI_TAKEN`은 `/signup/existing` 안내, 410 `VERIFICATION_EXPIRED`는 임시 상태를 지우고 `/signup/terms`, 422 `VALIDATION_FAILED`는 필드 오류(그리지 않음 — §2 표) |
| `MemberApi.signup.result` → `Router.replace` | N3 `SignupComplete` | 임시 상태를 지우고 `/signup/complete`로 교체. 가입 직후 자동 로그인이라 복귀 주소가 있으면 완료 화면의 「계속하기」가 그리로 간다 |
| `ForgotPasswordPage.verify` → `IdVerifySdk.open` | 상위 §5.4 그림 밖 비밀번호 재설정, 추가 이동 D | 가입과 같은 본인인증 창. 받은 `identityToken`은 sessionStorage에 두지 않고 페이지 메모리에만 둔다 — 새로고침하면 본인인증부터 다시 한다 |
| `ForgotPasswordPage.submitNewPassword` → `MemberApi.resetPassword` | 추가 이동 D `(/password/reset)` | `POST /api/password/reset {identityToken, newPassword}`. 404 `MEMBER_NOT_FOUND`·422 `VERIFICATION_FAILED` → 첫 단계(`ForgotPassword`)로, 422 `PASSWORD_RULE` → `ForgotPassword(NewPasswordForm)`에 머묾, 502 토스트(그리지 않음) |
| `MemberApi.resetPassword.result` → `Router.replace` | `R-06`, 추가 이동 D `LoginForm : success` | 204 — 서버가 그 회원의 세션을 모두 폐기했다. 세션 캐시를 지우고 `/login`으로 교체해 새 비밀번호로 로그인하게 한다 |

- **트리거** 셋 — 「동의하고 본인인증」, 가입 폼 제출, 비밀번호 찾기의 본인인증·변경. **완료 사실** 가입 임시 상태와 다음 화면, 또는 회원 1명과 세션, 또는 바뀐 비밀번호와 `LoginForm`.
- `IdVerifySdk.open`으로 들어오는 화살표 둘은 서로 다른 화면(가입·재설정)이 같은 창을 여는 **실제 재호출**이다 — 화면마다 창을 한 번 연다. 재설정 쪽 창의 결과는 `ForgotPasswordPage`가 메모리로 받는다(그림은 가입 쪽 `.result`만 잇는다). `Router.replace`로 들어오는 셋은 서로 다른 흐름 끝의 **합류**다.
- **임시 상태** 본인인증 결과(`verificationId`)는 서버에 30분 남고, 화면의 가입 임시 상태도 30분이 지나면 무시한다(§4). 가입 폼을 새로고침해도 임시 상태가 남아 본인인증을 다시 하지 않는다. 비밀번호 재설정의 `identityToken`은 업체 거래 ID라 일회성이고 서버가 10분이 지나면 실패로 보므로 메모리에만 둔다.

### JF-10 주문 취소 — OrderDetailPage.cancelOrder

```jobflow
orchestrator: OrderDetailPage
Object: OrderDetailPage, CancelDialog, OrderApi

OrderDetailPage.cancelOrder --> CancelDialog.open
CancelDialog.open.dismissed
CancelDialog.open.confirmed --> OrderApi.cancelOrder
OrderApi.cancelOrder.refundAccountRequired
OrderApi.cancelOrder.settled --> OrderApi.getOrder
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderDetailPage.cancelOrder` | 상위 §5.10 `Browser.cancelOrder`, 추가 이동 I | 「주문 취소」. 버튼은 주문이 `PENDING_PAYMENT`·`WAITING_DEPOSIT`이거나 모든 품목이 `PAID`일 때만 그린다. 품목 하나라도 `PREPARING`·`SHIPPING`이면 버튼 대신 안내 문구(잠정 — order 상세의 고객 취소 규칙과 같다) |
| `CancelDialog.open` | 추가 이동 I `OrderDetail(CancelDialog)` | 취소 사유를 고른다. `payment.method`가 `VIRTUAL_ACCOUNT`이고 주문이 `PAID`면 환불 계좌 칸(은행 코드·계좌번호·예금주)을 함께 보이고 형식(계좌번호 숫자 10~16자리, 예금주 필수)을 본다. `.dismissed`는 무시 분기 — 닫으면 상세에 머문다 |
| `.confirmed` → `OrderApi.cancelOrder` | 상위 `Order.cancelOrder`, `R-20` | `POST /api/orders/{orderId}/cancel {reason, refundAccount?}`, `SubmitLock`으로 버튼 잠금, 자동 재전송 없음. 환불 계좌는 이 요청 본문에만 싣고 화면 어디에도 저장하지 않는다 |
| `.refundAccountRequired` | 422 `REFUND_ACCOUNT_REQUIRED` | 무시 분기 — 대화상자를 연 사이 입금이 반영된 경우 등. 환불 계좌 칸을 열고 대화상자에 머문다. 서버는 이 오류를 주문을 `CANCELLING`으로 바꾸기 **전에** 돌려주므로 다시 보내도 안전하다 |
| `.settled` → `OrderApi.getOrder` | 200 `{status:'CANCELLED', refund?}`, 202 `{status:'CANCELLING'}`, 409 `NOT_CANCELLABLE {status}`, 502 `REFUND_FAILED` | 환불 계좌 요구 밖의 모든 결과를 한데 모은다 — 대화상자를 닫고 주문을 다시 읽는다. 202면 다시 읽기 전까지 「취소 처리 중 — 환불 결과는 곧 반영됩니다」 띠를 보인다(서버 대사가 같은 멱등 키로 취소를 닫는다 — 상위 §5.10). 409·502는 토스트(「이미 상품 준비가 시작되었습니다」·「환불에 실패했습니다 — 잠시 후 다시」) 뒤 다시 읽어 실제 상태를 보인다 |

- **트리거** `OrderDetail`의 「주문 취소」(회원·비회원 표시 모두). **완료 사실** 다시 읽은 주문 상세 — `CANCELLED`, 「취소 처리 중」(`CANCELLING`), 또는 원래 상태와 토스트.
- 결과에 상관없이 다시 읽기는 취소 한 번에 한 번이다. `CANCELLING`인 동안 화면은 폴링하지 않는다 — 고객이 새로고침하거나 다시 들어오면 그때 읽는다.
- 결제창 실패 복귀·사용자 닫기의 취소(`JF-6`·`JF-5.2`)는 `PENDING_PAYMENT` 주문이라 환불 계좌·`CANCELLING`이 생기지 않는다.

## 4. 소유 상태·데이터

**결론**: 이 경계가 쓰는 영속 데이터는 브라우저 sessionStorage의 다섯 기록뿐이다. 모두 「화면 사이에 넘길 값」이고 권위 데이터가 아니다 — 서버 응답과 다르면 서버를 믿는다. 세션·`cartKey`·비회원 조회 토큰은 서버가 httpOnly 쿠키로 소유하고 화면은 읽지 않는다.

| 데이터 | 경로 | 쓰기 주체 | 생명주기·보존 | 원자성 |
|---|---|---|---|---|
| 복귀 주소 | `sessionStorage['om.returnUrl']` = `{path, savedAt}` | `ReturnUrlStore.save`(`AuthGuard.goLogin`) | `take`가 꺼내며 지운다. 30분이 지나면 무시. 탭을 닫으면 사라진다 | 한 키 한 번 쓰기 |
| 주문서 임시 상태 | `sessionStorage['om.checkoutDraft']` = `{lines[{skuId, quantity, cartItemId?}], source:'cart'·'direct', couponIds[], shippingAddress?, guestConsent?{agreedAt}, savedAt}` | `CheckoutDraft.save`(`CheckoutEntry`), `GuestTermsPage`(동의), `CheckoutPage`(쿠폰·배송지) | 결제 완료·가상계좌 발급·로그아웃·탈퇴 때 지운다. 결제 실패 때는 남긴다. 24시간 지나면 무시 | 객체 전체를 한 번에 덮어쓴다 |
| 결제 진행 기록 | `sessionStorage['om.pendingPayment']` = `{orderId, orderNo, amount, method, guest, approveRequestedAt}` | `PendingPayment.save`(`PaymentLauncher`), `markRequested`(`PaymentConfirmingPage`) | 결제창을 열기 직전에 쓰고, 결과가 정해지면(`PAID`·실패·취소·발급 완료) 지운다. 1분 초과 안내 뒤에는 남긴다 | 객체 전체 덮어쓰기. 다른 탭과 공유하지 않는다 — 다른 탭의 중복은 서버가 막는다 |
| 비회원 조회 표시 | `sessionStorage['om.guestAccess']` = `{orderIds[], expiresAt}` | `GuestAccessStore.save`(조회 성공, 비회원 주문 생성) | 서버 토큰과 같은 수명 — 주문을 더할 때마다 30분으로 갱신, 401을 받으면 목록 전체를 지운다 | 객체 전체 덮어쓰기. 주문 최대 5개 — 서버 토큰 하나가 가리키는 주문 수와 같다 |
| 가입 임시 상태 | `sessionStorage['om.signupDraft']` = `{termsAgreements[], status, verificationId?, maskedLoginId?, socialProviders[]?, savedAt}` | `SignupDraft.save`(`TermsPage`, `JF-9`), `ExistingAccountPage`·`SignupFormPage`가 읽는다 | 가입 완료 때 지운다. 30분(서버 인증 결과 수명) | 객체 전체 덮어쓰기 |
| 세션 상태 캐시 | 메모리(React 문맥) | `SessionCache.write`·`clear` | 페이지를 새로 불러오면 사라진다. 로그인·로그아웃·401 때 지운다 | 해당 없음 — 표시용 |
| 서버 응답 캐시 | 메모리(질의 캐시 — TanStack Query 잠정) | 각 페이지의 조회 | 상품·카테고리 60초, 주문·장바구니 0초(항상 다시 읽기) | 해당 없음 — 권위 아님 |
| CSRF 토큰 | 쿠키 `XSRF-TOKEN`(서버 소유, 화면은 읽기만) | mall-api | 서버 정책 | 해당 없음 |

- **복귀 주소 허용 규칙**(열린 리디렉션 방지): `path`는 `/`로 시작하고 `//`·`/\`로 시작하지 않아야 한다. `new URL(path, location.origin).origin === location.origin`을 확인한다. `/login`·`/signup/*`·`/password/*`·`/checkout/pg-return`은 복귀 주소로 받지 않는다(로그인 화면이나 일회성 복귀 화면으로 돌아가지 않게). 쿼리 `?next=`처럼 바깥에서 주는 복귀 주소는 받지 않는다 — 복귀 주소는 이 탭의 가드만 쓴다.
- **sessionStorage를 고른 이유**: 소셜 동의·PG 결제창이 전체 페이지 이동이라 메모리가 사라진다. localStorage는 탭을 넘어 공유되어 두 탭의 주문서가 섞이고 공용 기기에 남는다. sessionStorage는 같은 탭의 이동·새로고침에는 남고 탭을 닫으면 사라진다.
- 개인정보: 주문서 임시 상태의 배송지·주문자 연락처는 결제 완료 때 지운다. 비회원 주문 비밀번호, 탈퇴 재확인 비밀번호, 환불 계좌(취소 대화상자·반품 폼), 비밀번호 재설정의 `identityToken`은 어디에도 저장하지 않는다 — 제출 때 메모리에서만 쓴다.
- 화면 상태 기계(주문서 제출·결제 확인)는 §2.2에 있다.

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| mall-api — member | `POST /api/auth/login`·`/logout`, `GET /api/oauth/{provider}/authorize`(전체 이동), `POST /api/signup/social`, `POST /api/members/check-duplicate`, `POST /api/signup`, `POST /api/password/reset`, `GET`·`DELETE /api/members/me` — [member 상세 §2](member.md#2-공개-계약) | `MemberApi`·`AuthApi`, 같은 오리진 `/api` | 10s | 오류 코드(`INVALID_CREDENTIALS`·`LOCKED`·`LOGIN_ID_TAKEN`·`CI_TAKEN`·`VERIFICATION_FAILED`·`REAUTH_REQUIRED`·`ACTIVE_ORDERS`)를 문구에 매핑한다. 소셜 콜백의 고정 복귀 주소(`/login/return`·`/signup/social`·`/login?error=social`·`/login?error=social_cancelled`)에 라우트가 묶여 있다 |
| mall-api — catalog | `GET /api/categories`, `GET /api/products*`, `GET /api/products/search` — [catalog 상세 §2](catalog.md#2-공개-계약) | `CatalogApi` | 10s | 응답 모양만 안다 |
| mall-api — promotion | `GET /api/exhibitions*`, `POST /api/coupons/{couponId}/download`, `GET /api/members/me/coupons?usable=true` — [promotion 상세 §2](promotion.md#2-공개-계약) | `PromotionApi` | 10s | 409 `ALREADY_DOWNLOADED`·410 `EXHAUSTED`·`EXPIRED` 문구. 주문서의 쿠폰 적용 판정은 promotion 목록이 아니라 order 견적의 `coupons[]`에 의존한다 |
| mall-api — cart | `GET /api/cart`, `POST /api/cart/items`, `PATCH`·`DELETE /api/cart/items/{itemId}`, `POST /api/cart/merge`, `PUT`·`DELETE /api/wishlist/{productId}`, `GET /api/wishlist` — [cart 상세 §2](cart.md#2-공개-계약) | `CartApi` | 10s, 병합 3s | 병합 200은 요약뿐이라 뒤이어 장바구니를 다시 읽는다. 병합에서 같은 SKU 품목은 `cartItemId`가 바뀐다는 사실에 의존한다(`JF-3.1`) |
| mall-api — order | `POST /api/orders/preview`, `POST /api/orders`, `POST /api/payments/{paymentKey}/approve`, `POST /api/payments/virtual-accounts`, `GET /api/orders*`, `GET /api/orders/{id}/tracking`, `POST /api/orders/{id}/cancel`, `POST /api/orders/{id}/lines/{lineId}/confirm`, `POST /api/guest/orders/lookup` — [order 상세 §2](order.md#2-공개-계약) | `OrderApi`·`PaymentApi` | 10s, 주문 생성 15s, 승인 45s, 가상계좌 40s | 승인 응답(200·202·400·402·409·5xx)과 취소 응답(200·202 `CANCELLING`·409·422 `REFUND_ACCOUNT_REQUIRED`·502)의 뜻, 품목 상태 값(`PAID`·`PREPARING`·`SHIPPING`·…)과 주문 상태 값(`NET_CANCELLING`·`MANUAL_REVIEW` 포함)에 화면 분기가 묶여 있다 |
| mall-api — claim | `POST /api/orders/{id}/claims/return`·`exchange`, `GET /api/claims/{id}` — [claim 상세 §2](claim.md#2-공개-계약) | `ClaimApi` | 10s | `NOT_CLAIMABLE {lineId, why}`로 품목을 표시한다. 가상계좌 결제 주문의 반품은 `refundAccount`가 필수다(422 `REFUND_ACCOUNT_REQUIRED`) |
| mall-api — review | `POST /api/reviews/upload-urls`, `POST /api/reviews`, `GET /api/products/{id}/reviews`, `GET /api/members/me/reviews` — [review 상세 §2](review.md#2-공개-계약) | `ReviewApi` | 10s | — |
| mall-api — 공통 | 오류 형식 `{code, message, details}`(검증 실패 422 `VALIDATION_FAILED` `details.fields[{field, reason}]`, 429 `RATE_LIMITED`), CSRF 쿠키·헤더 — [mall-api 상세 §2](mall-api.md#2-공개-계약) | `ApiClient` | — | 이름 `XSRF-TOKEN`·`X-CSRF-Token`은 mall-api `CsrfFilter`와 같다 |
| PG 결제창 SDK | `requestPayment({method, orderId: orderNo, amount, orderName, customerName, successUrl, failUrl})`(가정 — 토스페이먼츠형) | `PgSdk`, 스크립트 `VITE_PG_SDK_URL`, 클라이언트 키 `VITE_PG_CLIENT_KEY` | 결제창 안은 PG 몫 | 업체를 바꾸면 `PgSdk`와 `PgReturnParams`의 쿼리 이름만 바뀐다 |
| 소셜 동의(카카오·네이버) | 서버 authorize 주소로 전체 이동 — 화면은 IdP를 직접 부르지 않는다 | `AuthApi.openOAuthAuthorize` | — | 결합 없음(서버가 `state`·PKCE·코드 교환, 가입 티켓 쿠키) |
| 본인인증 SDK | 창 열기 → 성공 콜백 `identityToken`, 취소 콜백(가정 — 통합 인증형) | `IdVerifySdk`, `VITE_IDV_SDK_URL` | 창 안은 업체 몫 | 화면은 토큰을 서버에 넘길 뿐 결과를 해석하지 않는다 |
| 우편번호 위젯 | 위젯 열기 → `{zonecode, roadAddress, jibunAddress}`(가정 — 카카오 우편번호 서비스형) | `PostcodeWidget`, 스크립트 `VITE_POSTCODE_SDK_URL` | 스크립트 로드 10s | 실패하면 우편번호·주소 직접 입력 칸을 연다 |
| 객체 저장소 | 서명 URL `PUT`(리뷰 사진) | `StorageUploader` | 장당 60s | 서명 URL의 출처를 CSP `connect-src`에 넣어야 한다 |

- 화면이 직접 여는 외부 창 넷(PG·소셜·본인인증·우편번호)의 결과는 모두 서버가 다시 확인한다 — 화면은 전달자다(상위 §3.1).
- 외부 스크립트는 그 기능 화면에 들어갈 때만 불러온다(주문서·가입·비밀번호 찾기). 첫 화면 무게를 줄인다.

## 6. 실패 경계

**결론**: 오류는 `ApiClient`가 한 모양으로 만들고, 401·5xx만 공통으로 처리하며, 나머지는 화면이 코드별로 다룬다. 돈이 오가는 호출(주문 생성·승인·가상계좌·취소)은 자동으로 다시 보내지 않는다.

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| API 기본 타임아웃 | 10s | `VITE_API_TIMEOUT_MS` | `HttpTransport.send` |
| 주문 생성 타임아웃 | 15s | `VITE_ORDER_TIMEOUT_MS` | `OrderApi.placeOrder` |
| 결제 승인 타임아웃 | 45s — 서버의 PG 승인 30s보다 길게 | `VITE_APPROVE_TIMEOUT_MS` | `PaymentApi.approve` |
| 가상계좌 발급 타임아웃 | 40s | `VITE_VBANK_TIMEOUT_MS` | `PaymentApi.issueVirtualAccount` |
| 장바구니 병합 타임아웃 | 3s — 넘으면 무시하고 복귀 | `VITE_MERGE_TIMEOUT_MS` | `CartApi.mergeGuestCart` |
| 승인 결과 폴링 | 3s 간격, 최대 60s | `VITE_POLL_INTERVAL_MS`, `VITE_POLL_MAX_MS` | `OrderStatusPoller` |
| 자동 재시도 | `GET`만 연결 실패 때 1회(500ms 뒤). `POST`·`PUT`·`PATCH`·`DELETE`는 없음 | — | `HttpTransport.send` |
| 사진 업로드 | 장당 60s, 동시 2장 | `VITE_UPLOAD_TIMEOUT_MS` | `StorageUploader.put` |
| 복귀 주소 수명 | 30분 | — | `ReturnUrlStore` |

**상태 코드별 처리**

| 응답 | 공통 처리(`ApiClient`) | 화면 처리 |
|---|---|---|
| 401 | `requiresAuth` 호출이면 `AuthGuard.goLogin` | 로그인 화면: 문구. 비회원 표시로 연 주문: `GuestOrderLookup` |
| 403 | 없음 | 주문: `OrderList`(`NOT_OWNER`). 리뷰: 주문 상세. `REAUTH_REQUIRED`(탈퇴): 복귀 주소를 남기고 `LoginForm`. `CSRF_INVALID`: 아래 불릿 |
| 404 | 없음 | 상품·기획전: `NotFound`·「판매 종료」. 비회원 조회: 문구 |
| 409 | 없음 | `PRICE_CHANGED`·`OUT_OF_STOCK`·`COUPON_UNAVAILABLE`: 재견적. `INVALID_STATE`(승인): 주문 다시 읽기. `NOT_CANCELLABLE`(상품 준비중 이후 포함)·`NOT_CONFIRMABLE`·`NOT_CLAIMABLE`: 토스트 뒤 주문 다시 읽기. `ALREADY_DOWNLOADED`·`SOLD_OUT`: 토스트. `ACTIVE_ORDERS`(탈퇴): 문구와 주문 목록 링크 |
| 410 | 없음 | 쿠폰 소진·만료: 토스트. 가입 인증 결과 만료(`VERIFICATION_EXPIRED`)·소셜 티켓 만료(`TICKET_EXPIRED`): 첫 단계로 |
| 422 | 없음 | `VALIDATION_FAILED`: `details.fields[{field, reason}]`을 필드 오류로, 필드가 없으면 폼 위 문구. `VERIFICATION_FAILED`(본인인증 실패·만료): 본인인증 단계로. `REFUND_ACCOUNT_REQUIRED`: 환불 계좌 칸을 열고 머묾. `PASSWORD_RULE`·`UNDER_14`: 문구 |
| 423·429 | 없음 | `LOCKED {until}`(로그인 5회·비회원 조회 10회 잠금): 「{until}까지」 문구. `RATE_LIMITED`(미들웨어 요청 한도): 「잠시 후 다시」 |
| 402 | 없음 | 결제 거절 — `Checkout`에 PG 문구 |
| 5xx·타임아웃·연결 실패 | 토스트 「잠시 후 다시」(`silent` 호출 제외) | 승인: 결과 불명으로 폴링. 주문 생성: 결과 모름 — 다시 누를 수 있다(§8) |

- **오류 형식**: 모든 오류 본문은 `{code, message, details}`다(상위 §4.3). 검증 실패는 422 `VALIDATION_FAILED` 하나이고 필드별 사유는 `details.fields[{field, reason}]`에 온다. `message`는 사용자에게 보여도 되는 한국어 문장으로 서버가 준다. 화면은 `code`로 분기하고, 모르는 `code`면 `message`를 그대로 보인다. 본문이 형식에 맞지 않으면(프록시 오류 페이지 등) `UNKNOWN`으로 다룬다.
- **CSRF**: 상태를 바꾸는 요청마다 쿠키 `XSRF-TOKEN` 값을 헤더 `X-CSRF-Token`에 넣는다(이중 제출 쿠키 방식, admin-web과 같은 이름 — 잠정). 로그인하면 서버가 토큰을 바꾸므로 값을 기억하지 않고 요청마다 쿠키에서 읽는다. 쿠키가 없으면 `GET /api/members/me`를 한 번 불러 서버가 쿠키를 내려주게 한 뒤 보낸다. 403 `CSRF_INVALID`를 받으면 같은 방법으로 토큰을 새로 받고 **한 번만** 다시 보낸다 — 돈이 오가는 요청도 이 경우는 서버가 처리 전에 거절했으므로 안전하다(mall-api `CsrfFilter`는 업무 처리 전 단계다).
- **중복 클릭 방지**: 상태를 바꾸는 버튼은 `SubmitLock`으로 누른 순간 잠그고 응답 뒤 푼다. `ApiClient`의 `dedupKey`가 같은 요청의 동시 진행을 한 번으로 줄인다. 이것은 같은 탭 안의 방어이고, 다른 탭·재전송의 중복은 서버 계약(조건부 전이·멱등 키)이 막는다 — 주문 생성만 서버 방어가 없다(§8).
- **열린 리디렉션**: 복귀 주소는 §4의 허용 규칙을 지난 같은 오리진 경로만 쓴다. 바깥이 준 주소로 이동하는 코드는 PG·소셜·본인인증 SDK가 정한 고정 주소뿐이다.
- **외부 스크립트 실패**: PG SDK를 못 불러오면 「결제하기」를 막고 「결제 모듈을 불러오지 못했습니다」를 보인다 — 주문을 만들기 **전에** 확인한다. 우편번호 위젯 실패는 직접 입력으로 대신한다.

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 복귀 주소 허용 규칙 | `ReturnUrlStore` — 열린 리디렉션 | 단위 시험: `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:…`, `/login`, `/checkout/pg-return`, 31분 지난 값 → 모두 `/`. `/events/3?tab=coupon` → 그대로 | 고객 화면 1차(상위 §9.1 순서 3) |
| 로그인 가드와 복귀 | `JF-2`·`JF-3`·`JF-3.1`, N2·N4·N8 | 컴포넌트 시험(Vitest + Testing Library + MSW): 미로그인 바로구매 → `/login` → 로그인 → `/checkout` 교체 이동, 병합 500·3초 지연 → 복귀 계속, 소셜 `/login/return` → 복귀, 알림톡 주소 → 로그인 → 같은 주문 | 고객 화면 1차 |
| 주문서 견적과 금액 대조 | `JF-5`·`JF-5.1`, `R-09` | MSW로 409 `PRICE_CHANGED`·`OUT_OF_STOCK`·`COUPON_UNAVAILABLE`, 422를 돌려준다 → 대화상자·품목 표시·재견적, `expectedAmount` = 마지막 견적 결제금액, 견적 진행 중 「결제하기」 잠김 | 고객 화면 1차 |
| 병합 뒤 주문서 | `JF-3.1` 드러난 사실 | 비회원 장바구니 2품목 → 선택 주문 → 로그인(병합으로 `cartItemId` 바뀜) → 주문서가 새 `cartItemId`로 견적·주문 | 고객 화면 1차 |
| PG 복귀 중복 방지 | `JF-6`, `R-18` | E2E(Playwright + 가짜 PG 페이지): 복귀 직후 새로고침 → 승인 요청 1회, 완료 화면에서 뒤로가기 → 복귀 화면을 다시 거치지 않음, 같은 주문 두 탭 복귀 → 한쪽 409 → 주문 다시 읽어 완료 화면 | 고객 화면 1차, 상위 §9.2 「결제 끝단」과 함께 |
| 결과 불명 폴링 | `JF-6.1`, `D-04` | 가짜 시계: 202 → `APPROVING` 5회 → `PAID` → 완료 화면. 60초 내내 `APPROVING` → 안내 문구, 기록 유지, 새로고침 → 다시 폴링. 승인 45초 타임아웃 → 폴링 | 고객 화면 1차 |
| 결제창 실패·닫기 | `JF-5.2`·`JF-6`, `R-20` | 실패 복귀 쿼리 → 취소 요청 1회 → `/checkout` 문구, 주문서 유지. 취소 500이어도 이동. PC 창 닫기(SDK 거절) → 취소 1회 | 고객 화면 1차 |
| 가상계좌 | `JF-5.2`, 추가 이동 G | 502 → 다시 시도 대화상자 → 같은 `orderId`로 두 번째 요청, 201 → 완료 화면 가상계좌 표시, 새로고침해도 계좌 표시 | 고객 화면 2차(순서 4) |
| 비회원 조회와 주문 | `JF-8`, `R-16`·`R-17` | 조회 성공 → 상세(가드가 `/api/members/me`를 부르지 않음), 새로고침 → 상세 유지, 31분 뒤 401 → `GuestOrderLookup`·표시 목록 비움. 비회원 주문 → 결제 → 완료 화면 열림. 두 주문을 차례로 조회 → 두 주문 상세 모두 가드 통과(표시 목록 2개), 여섯째 주문 → 가장 오래된 것 빠짐. 주문 비밀번호 5자 → 요청 전 막힘 | 고객 화면 2차 |
| 주문 취소 | `JF-10`, 추가 이동 I | MSW: 200 → 상세 다시 읽기, 202 `CANCELLING` → 「취소 처리 중」 띠 뒤 다시 읽기, 422 `REFUND_ACCOUNT_REQUIRED` → 환불 계좌 칸 열림·대화상자 유지, 409 → 토스트·다시 읽기. 가상계좌 `PAID` 주문 → 대화상자에 환불 계좌 칸, 카드 주문 → 칸 없음. 품목 하나가 `PREPARING` → 취소 버튼 없음·안내 문구 | 고객 화면 2차 |
| 가입·재설정·탈퇴 | `JF-9`, 추가 이동 A·D | 가짜 본인인증 SDK: 취소 → `TermsAgreement` 유지, `EXISTING` → `/signup/existing`, `NEW` → 새로고침해도 `/signup/form` 유지, 410 → `/signup/terms`. 재설정 422 `VERIFICATION_FAILED` → 첫 단계, 204 → `/login`. 탈퇴 401 → 칸 문구, 403 `REAUTH_REQUIRED` → `/login` 뒤 `/mypage/withdraw`로 복귀, 409 → 주문 목록 링크. `/signup/social`이 쿼리 없이 열림 | 고객 화면 1차 |
| CSRF·오류 형식 | `JF-1`, §6 | `POST`마다 `X-CSRF-Token` 헤더, 403 `CSRF_INVALID` → 토큰 갱신 뒤 1회 재전송, 비JSON 502 → `UNKNOWN` 토스트, 422 `VALIDATION_FAILED` `details.fields` → 필드별 문구·`aria-describedby`, 429 `RATE_LIMITED` → 문구 | 고객 화면 1차 |
| 중복 클릭 | `SubmitLock`·`dedupKey` | 「결제하기」 두 번 빠르게 → `POST /api/orders` 1회. 「쿠폰 받기」 연타 → 1회 | 고객 화면 1차 |
| 리뷰 사진 | `JF-7`, `R-15` | 11MB·6장째 거절, 업로드 1장 실패 → 다시 올리기, 올리는 중 제출 막힘, 성공 키만 `imageKeys` | 고객 화면 3차(순서 5) |
| 접근성·반응형 | §2.3 | `@axe-core/playwright`로 주요 화면 위반 0, 360·768·1280px 화면 캡처 비교, 키보드만으로 주문서 완료 | 각 차수 끝 |

설계 문서에 대해 실제로 돌린 것은 정적 검사와 jobflow 렌더 확인이다 — 결과는 근거 브리프 §5에 통합 때 옮긴다.

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-09`·`R-09` | 위험 | `POST /api/orders`에 멱등 키가 없다. 응답이 끊긴 뒤 다시 누르면 주문이 둘 생긴다 | `JF-5.1` 실패 분기 | 앞 주문은 결제 없이 30분 뒤 만료되어 돈 문제는 없지만, 그동안 재고를 잡는다. 대응 후보: 주문서 진입 때 화면이 만든 `Idempotency-Key`를 주문 생성에 실어 같은 키는 같은 주문을 돌려주게 한다 — order 계약 변경이라 보고한다 |
| `C-13`·`D-07` | 위험 | 비회원 조회 토큰은 30분이라 가상계좌 입금기한(72시간) 동안 비회원은 완료 화면·주문 상세를 다시 열 때 비회원 조회를 거친다. 표시는 탭마다(sessionStorage) 따로라 같은 브라우저의 다른 탭은 토큰이 유효해도 표시가 없어 가드가 `LoginForm`으로 보낸다 | `JF-8` 드러난 사실 | 다른 탭은 비회원 조회 한 번으로 표시를 되살린다(서버는 같은 토큰에 주문을 더한다). 불편이 크면 표시를 localStorage로 옮기는 안을 검토한다(공용 기기 노출과 맞바꿈) |
| `C-08`·`R-23` | 위험 | 병합에서 회원 장바구니와 겹친 SKU는 비회원 행이 지워져, 로그인 전 주문서 임시 상태의 그 `cartItemId`가 없는 ID가 된다 | `JF-3.1` | 화면은 진입 때 장바구니를 다시 읽어 `skuId`로 맞춘다. 서버가 `removeItems`를 `skuId`로도 받으면 이 맞추기가 필요 없다 — cart·order에 보고 |
| `C-11`·`R-20` | 위험 | 가상계좌 발급이 502·타임아웃이면 PG가 계좌를 발급했는지 모른다. 이때 주문을 취소하면 고객이 닫힌 주문의 계좌로 입금할 수 있다 | `JF-5.2` | 화면은 취소하지 않고 같은 주문으로 다시 발급한다(멱등 키). 고객이 그냥 떠나면 `PENDING_PAYMENT` 만료가 가상계좌를 닫는지는 order 상세 몫이다(상위 §5.9 만료 타이머는 `WAITING_DEPOSIT`만 `Payment.cancel`을 부른다) |
| `R-20` | 위험 | 결제창을 연 채 브라우저를 닫거나 앱으로 전환한 뒤 돌아오지 않으면 복귀가 없어 화면이 취소를 부를 수 없다 | `JF-5.2` | 서버 만료 타이머(30분)가 가예약·쿠폰을 푼다. 화면이 줄일 수 없는 지연이다 |
| `C-01` | 미확정 | PG SDK 형태 — 모바일 전체 이동·PC 창, 창 닫기를 약속 거절로 알리는지, 실패 복귀 쿼리에 주문 ID가 있는지 | 상위 §9.5 PG 업체 | 업체를 정하면 `PgSdk`·`PgReturnParams`만 고친다. 주문 ID는 결제 진행 기록에서 읽으므로 쿼리에 없어도 된다 |
| `R-17` | 미확정 | 비회원 주문의 알림톡 링크 — 비회원은 로그인할 수 없어 `/orders/:orderId` 직접 진입이 `LoginForm`에서 멈춘다 | N8, `JF-8` | 잠정: `LoginForm`의 「비회원 주문조회」로 가게 한다. 비회원 알림톡에는 `/guest/orders?orderNo=`(번호 미리 채움)를 링크하는 안을 notification 템플릿에 제안 |
| `D-04` | 위험 | 결제 확인 1분 초과 뒤 고객이 결과를 모른 채 떠날 수 있다 | `JF-6.1` | 대사(상위 §5.8)가 닫고 알림톡이 결과를 보낸다(결제 완료만). 실패로 닫힌 경우의 알림이 없다 — notification 범위 |
| `C-14`·`R-20` | 미확정 | 고객 취소는 모든 품목이 `PAID`일 때만 받는다 — 상품 준비중(`PREPARING`) 이후의 고객은 고객센터 문의나 배송 뒤 반품뿐이다 | 추가 이동 I, `JF-10` | 잠정(order 상세). 고객센터 경로가 정해지면 안내 문구에 연락 수단을 넣는다 |
| `C-12`·`C-14` | 미확정 | 환불 계좌의 실명 확인 — 화면은 형식만 보고 은행·계좌·예금주가 맞는지 확인하지 않는다 | 추가 이동 I, `JF-10`, 반품 폼 | 상위 §9.5 미확정. 확인 계약이 생기면 대화상자·반품 폼에 「계좌 확인」 단계가 하나 는다 |

## 9. 미확인·한계

1. 코드가 없는 신규 설계다 — 라우트·컴포넌트·저장 키·타임아웃은 모두 설계값이고 실행으로 확인한 것이 없다.
2. PG·본인인증·우편번호 SDK의 실제 함수 이름·콜백·창 동작은 확인하지 않았다 — 국내 보편 형태(토스페이먼츠형 결제창, 통합 본인인증 창, 카카오 우편번호 서비스형 위젯)를 가정했다.
3. 계약은 member·cart·promotion·order·claim·mall-api 상세 §2와 대조해 맞췄다. 그 상세들이 같은 시기에 고쳐지고 있어, 오류 코드 이름이나 응답 필드가 상세에서 바뀌면 §2·§6 표를 다시 맞춰야 한다.
4. 브라우저별 sessionStorage 동작(사파리 사생활 보호 모드·앱 내 브라우저의 탭 처리)과 결제 앱 전환 뒤 복귀 탭이 같은 탭인지는 확인하지 않았다 — 다른 탭으로 돌아오면 결제 진행 기록이 없어 `JF-6`이 주문 ID를 쿼리에서만 얻는다.
5. 렌더 확인은 설계 문서 검사 도구의 렌더러로 만든 SVG를 PNG로 본 것이다 — 실제 문서 뷰어 안의 표시는 확인하지 않았다.
