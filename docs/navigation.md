
## 1. 메인 탐색 (GNB)

```navigation
Home --> SearchResult : 검색어 입력
Home --> CategoryList : 카테고리 선택
Home --> EventPage : 배너·기획전 선택
Home --> Cart : 장바구니 아이콘
CategoryList --> ProductDetail : 상품 선택
SearchResult --> ProductDetail : 상품 선택
EventPage --> ProductDetail : 상품 선택
EventPage --> (/coupons/download) : 쿠폰 받기
(/coupons/download) --> LoginForm : 미로그인
(/coupons/download) --> EventPage : success
```

* 쿠폰 받기 성공과 실패는 같은 화면에 머물며 토스트만 띄웁니다. 그래서 화면이 바뀌는 미로그인만 분기로 남겼습니다.
* 찜하기도 같은 방식이라 별도로 그리지 않았습니다. 미로그인일 때는 `LoginForm`으로 가고, 로그인 상태에서는 화면이 유지됩니다.

## 2. 로그인 (일반 / 소셜)

```navigation
LoginForm --> (validate_form) : 로그인
(validate_form) --> LoginForm : invalid
(validate_form) --> (/login) : success
(/login) --> LoginForm : error
(/login) --> (restore_return_url) : success
LoginForm --> SocialAuthWindow : 카카오·네이버 로그인
SocialAuthWindow --> LoginForm : 동의 취소
SocialAuthWindow --> `oauthCode` : 동의 완료
`oauthCode` --> (/oauth/callback)
(/oauth/callback) --> (restore_return_url) : 기존 회원
(/oauth/callback) --> SocialSignupForm : 신규 회원
SocialSignupForm --> (/signup/social)
(/signup/social) --> SocialSignupForm : error
(/signup/social) --> (restore_return_url) : success
(restore_return_url) --> Home : 복귀 주소 없음
(restore_return_url) --> ReturnPage : 복귀 주소 있음
```

* `ReturnPage`는 "로그인하기 직전 화면"을 뜻하는 자리표시자입니다. 실제로는 장바구니, 주문서, 이벤트 페이지 등이 들어갑니다.

## 3. 회원가입 (휴대폰 본인인증)

```navigation
LoginForm --> TermsAgreement : 회원가입
TermsAgreement --> LoginForm : 가입 취소
TermsAgreement --> IdentityVerificationWindow : 필수 약관 동의
IdentityVerificationWindow --> TermsAgreement : 인증 취소
IdentityVerificationWindow --> `identityResult` : 인증 완료
`identityResult` --> (/members/check_duplicate)
(/members/check_duplicate) --> ExistingAccountNotice : 기존 회원
(/members/check_duplicate) --> SignupForm : 신규
ExistingAccountNotice --> LoginForm : 로그인하기
ExistingAccountNotice --> ForgotPassword : 비밀번호 찾기
SignupForm --> (validate_form)
(validate_form) --> SignupForm : invalid
(validate_form) --> (/signup) : success
(/signup) --> SignupForm : error
(/signup) --> SignupComplete : success
SignupComplete --> Home : 쇼핑 시작
```

* 본인인증 결과(CI)로 중복 가입을 막고, 이미 가입한 사용자에게는 기존 계정을 안내합니다. 국내몰에서 흔한 패턴입니다.
* 비밀번호 찾기 이후 흐름은 가이드의 비밀번호 재설정 시나리오를 그대로 씁니다.

## 4. 상품 상세 → 장바구니 / 바로구매

```navigation
ProductDetail --> (check_option_for_cart) : 장바구니 담기
(check_option_for_cart) --> ProductDetail : 옵션 미선택
(check_option_for_cart) --> (/cart/add) : success
(/cart/add) --> ProductDetail : error
(/cart/add) --> CartAddedModal : success
CartAddedModal --> Cart : 장바구니 이동
CartAddedModal --> ProductDetail : 쇼핑 계속하기
ProductDetail --> (check_option_for_buy) : 바로구매
(check_option_for_buy) --> ProductDetail : 옵션 미선택
(check_option_for_buy) --> (check_auth) : success
Cart --> (check_auth) : 선택 상품 주문
(check_auth) --> LoginForm : 미로그인
(check_auth) --> Checkout : 로그인됨
LoginForm --> (/login)
(/login) --> LoginForm : error
(/login) --> Checkout : success
LoginForm --> GuestCheckoutTerms : 비회원 구매
GuestCheckoutTerms --> Checkout : 개인정보 수집 동의
```

* 장바구니 담기와 바로구매는 옵션 검사 뒤 갈 곳이 다릅니다. 그래서 처리 노드를 둘로 나눴습니다.
* 비회원도 장바구니는 쓸 수 있고, 주문 단계에서만 로그인이나 비회원 구매를 고르게 됩니다.

## 5. 주문서 → 결제

```navigation
Checkout --> AddressSearchModal : 우편번호 찾기
AddressSearchModal --> Checkout : 주소 선택
Checkout --> CouponSelectModal : 쿠폰 적용
CouponSelectModal --> Checkout : 적용 완료
Checkout --> (validate_order) : 결제하기
(validate_order) --> Checkout : invalid
(validate_order) --> (/orders) : success
(/orders) --> Checkout : 재고 부족
(/orders) --> (branch_payment_method) : created
(branch_payment_method) --> PgPaymentWindow : 카드·간편결제
(branch_payment_method) --> (/payment/virtual_account) : 무통장입금
PgPaymentWindow --> Checkout : 결제 취소
PgPaymentWindow --> `paymentAuthResult` : 인증 완료
`paymentAuthResult` --> (/payment/approve)
(/payment/approve) --> Checkout : failed
(/payment/approve) --> OrderComplete : paid
(/payment/virtual_account) --> Checkout : error
(/payment/virtual_account) --> OrderComplete : 가상계좌 발급
```

* `PgPaymentWindow`는 카드사·카카오페이·네이버페이·토스페이 등 결제대행사 창을 하나로 묶은 화면입니다. 결제수단마다 창은 다르지만, 이동 결과는 같습니다.
* 결제 방식은 인증(PG창)과 승인(`/payment/approve`)의 2단계입니다. 승인 판단에 쓰이는 인증 결과는 메시지 노드로 표현했습니다.
* 무통장입금은 PG창 없이 가상계좌를 발급하고 바로 완료 화면으로 갑니다.

## 6. 주문 조회 · 배송 · 반품/교환 · 리뷰

```navigation
OrderComplete --> OrderDetail : 주문 상세 보기
MyPage --> OrderList : 주문·배송 조회
OrderList --> OrderDetail : 주문 선택
OrderDetail --> DeliveryTracking : 배송 조회
OrderDetail --> ReturnRequestForm : 반품 신청
OrderDetail --> ExchangeRequestForm : 교환 신청
ReturnRequestForm --> (/claims/return)
(/claims/return) --> ReturnRequestForm : error
(/claims/return) --> ClaimComplete : success
ExchangeRequestForm --> (/claims/exchange)
(/claims/exchange) --> ExchangeRequestForm : error
(/claims/exchange) --> ClaimComplete : success
ClaimComplete --> OrderDetail : 주문 상세로
OrderDetail --> (/orders/confirm) : 구매확정
(/orders/confirm) --> OrderDetail : error
(/orders/confirm) --> ReviewPromptModal : success
ReviewPromptModal --> ReviewWriteForm : 리뷰 쓰기
ReviewPromptModal --> OrderDetail : 나중에
ReviewWriteForm --> (validate_review)
(validate_review) --> ReviewWriteForm : invalid
(validate_review) --> (/reviews) : success
(/reviews) --> ReviewWriteForm : error
(/reviews) --> MyReviewList : success
```

* 결제완료 단계의 주문 취소는 `OrderDetail`에 머물며 상태만 바뀝니다. 그래서 가이드 원칙에 따라 이동도에서는 뺐습니다.
* 반품과 교환은 사유·수거지 입력 화면이 따로 있어 화면 노드로 넣었습니다.

## 7. 비회원 주문조회

```navigation
LoginForm --> GuestOrderLookup : 비회원 주문조회
GuestOrderLookup --> (/guest/orders/lookup)
(/guest/orders/lookup) --> GuestOrderLookup : not_found
(/guest/orders/lookup) --> OrderDetail : found
```

* 주문번호와 주문 비밀번호(또는 휴대폰 번호)로 조회합니다.

## 8. 직접 진입: 알림톡 배송 안내 링크

카카오 알림톡의 "배송 조회" 버튼으로 주문 상세 주소(`/orders/:orderId`)에 바로 접속하는 시나리오입니다. 진입 지점은 인증 가드인 `(check_auth)`입니다.

```navigation
(check_auth) --> LoginForm : 미로그인
(check_auth) --> (/orders/detail) : 로그인됨
LoginForm --> (/login)
(/login) --> LoginForm : error
(/login) --> (/orders/detail) : success
(/orders/detail) --> OrderDetail : success
(/orders/detail) --> OrderList : 본인 주문 아님
```

## 화면 · API 계약 요약

| 논리 이름 | 실제 계약 예시 |
|---|---|
| `(/cart/add)` | `POST /api/cart/items` |
| `(/orders)` | `POST /api/orders` |
| `(/payment/approve)` | `POST /api/payments/{paymentKey}/approve` |
| `(/payment/virtual_account)` | `POST /api/payments/virtual-accounts` |
| `(/orders/detail)` | `GET /api/orders/{orderId}` |
| `(/claims/return)` | `POST /api/orders/{orderId}/claims/return` |
| `(/oauth/callback)` | `GET /api/oauth/{provider}/callback` |

