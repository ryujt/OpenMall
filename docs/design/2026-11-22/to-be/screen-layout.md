# 화면 배치와 장면

## 전체 페이지·장면 목록

경로와 권한은 목표 설계다. HTML은 아래 경로의 독립 시안이며 장면은 같은 파일 안에서 전환한다. 결제창은 외부 PG가 소유하므로 주문서에서 연결 지점만 보여 준다. 상품명·가격·수량·배송비는 흐름 확인용 예시다.

| 화면 ID | 페이지 | 목표 경로·접근 조건 | 주요 과업 | 배치와 기본 화면 |
| --- | --- | --- | --- | --- |
| `catalog` | 상품 찾기 | `/` · 공개 | 상품 검색과 카테고리 탐색 | [배치](#catalog) · [열기](details/screens/catalog.html) |
| `product` | 상품 상세 | `/products/{id}` · 공개 | 옵션과 구매 조건 확인 | [배치](#product) · [열기](details/screens/product.html) |
| `cart` | 장바구니 | `/cart` · 회원·비회원 | 선택 상품과 수량 점검 | [배치](#cart) · [열기](details/screens/cart.html) |
| `access` | 계정과 비회원 조회 | `/access` · 공개 | 가입·인증·계정 복구·비회원 조회 | [배치](#access) · [열기](details/screens/access.html) |
| `account` | 회원 정보 | `/my/account` · 로그인 회원 | 배송지·계정 관리 | [배치](#account) · [열기](details/screens/account.html) |
| `checkout` | 주문서 | `/checkout` · 장바구니 또는 바로 구매 | 배송지·쿠폰·결제 | [배치](#checkout) · [열기](details/screens/checkout.html) |
| `orders` | 내 주문 | `/my/orders` · 로그인 회원 | 주문 목록 조회 | [배치](#orders) · [열기](details/screens/orders.html) |
| `order` | 주문 상세 | `/orders/{orderId}` · 소유 회원 또는 해당 주문 조회 인증 | 결제 명세·배송 추적·사후 처리 | [배치](#order) · [열기](details/screens/order.html) |
| `claim` | 취소·반품·교환 | `/orders/{orderId}/claim` · 해당 주문 조회 권한 | 품목별 신청·진행 확인 | [배치](#claim) · [열기](details/screens/claim.html) |
| `admin-catalog` | 상품·재고 관리 | `/admin/catalog` · 상품·재고 권한 | 상품 등록·가격 변경·수량 조정 | [배치](#admin-catalog) · [열기](details/screens/admin-catalog.html) |
| `admin-shipping` | 출고 관리 | `/admin/shipments` · 배송 담당자 | 출고 대상 검수·송장 등록 | [배치](#admin-shipping) · [열기](details/screens/admin-shipping.html) |
| `admin-cases` | 고객상담·환불 | `/admin/claims` · CS·환불 권한 | 회수·검수·환불·교환 처리 | [배치](#admin-cases) · [열기](details/screens/admin-cases.html) |

고객 화면은 상품 찾기·장바구니·내 주문·계정을 상단 메뉴로 제공한다. 운영 화면은 상품·재고, 출고, 고객상담 메뉴를 사용한다. 700px 이하에서는 두 열을 한 열로 쌓고 제목에서 입력과 결과 순으로 읽는다. 폼 입력이 누락되면 해당 필드에 브라우저 검증 문구를 표시한다. 비동기 작업 중에는 제출을 잠그고 결과가 불확실한 결제·환불에는 기존 거래 재조회를 제공한다. 상단의 ‘설계 미리보기’ 선택기는 검토용이다. 각 장면은 독립된 예시이며 입력을 저장하거나 외부 시스템에 전송하지 않는다.

<a id="catalog"></a>

## 상품 찾기

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 검색 조건, 검색 결과
```

검색어와 카테고리로 상품 범위를 좁힌다. 검색 결과에는 옵션 선택 전의 기준 가격과 판매 상태를 표시한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 상품 목록 | 홈 진입 또는 검색 성공 | 상품을 선택해 상세로 이동한다. | [열기](details/screens/catalog.html) |
| 검색 결과 없음 | 일치하는 상품이 없음 | 검색어를 수정하거나 필터를 초기화한다. | [열기](details/screens/catalog.html#empty) |

<a id="product"></a>

## 상품 상세

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 상품 정보, 구매 조건
```

품목별 상품 정보와 배송·반품 조건을 확인한 뒤 옵션을 선택한다. 품절 상태에서는 재고 문의나 목록 복귀를 제공한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 구매 가능 | 상품 선택 | 장바구니에 담거나 주문서로 이동한다. | [열기](details/screens/product.html) |
| 품절 | 마지막 재고가 소진됨 | 품절을 확인하고 목록으로 돌아간다. | [열기](details/screens/product.html#sold) |

<a id="cart"></a>

## 장바구니

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 담은 상품, 주문 예상액
```

옵션과 수량을 보여 주고 주문 직전 가격·재고를 재검사한다. 삭제한 마지막 항목은 빈 장바구니로 이어진다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 담은 상품 | 담기 성공 또는 장바구니 열기 | 주문서 진입 전에 선택 내역을 확인한다. | [열기](details/screens/cart.html) |
| 빈 장바구니 | 마지막 상품 삭제 | 쇼핑을 계속한다. | [열기](details/screens/cart.html#empty) |
| 상품 조건 변경 | 주문 직전 재고 검증 실패 | 구매할 수 없는 상품을 제거하거나 상세로 돌아간다. | [열기](details/screens/cart.html#change) |
| 장바구니 수량 변경 | 품목 수량 수정 | 재고 한도 내 수량을 적용해 예상 금액을 다시 계산한다. | [열기](details/screens/cart.html#quantity) |

<a id="access"></a>

## 계정과 비회원 조회

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 인증 입력, 계정 선택
```

로그인과 가입은 이메일을 사용한다. 비회원 주문의 접근권은 주문번호와 주문 연락처에 보낸 일회용 코드로 한 건에 한정한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 로그인 | 로그인 선택 또는 회원 영역 직접 진입 | 인증이 끝나면 저장된 내부 경로로 복귀한다. | [열기](details/screens/access.html) |
| 회원가입 | 가입 선택 | 필수 약관과 이메일 확인 후 로그인한다. | [열기](details/screens/access.html#signup) |
| 가입 인증 | 가입 이메일 발송 | 일회용 코드를 확인하면 로그인할 수 있다. | [열기](details/screens/access.html#verify) |
| 비밀번호 재설정 | 계정 복구 선택 | 입력한 이메일에 재설정 안내를 보낸다. | [열기](details/screens/access.html#reset) |
| 재설정 안내 | 이메일 재설정 요청 | 계정 존재 여부를 같은 문구로 안내한다. | [열기](details/screens/access.html#sent) |
| 새 비밀번호 | 재설정 링크 확인 | 비밀번호를 바꾸고 새로 로그인한다. | [열기](details/screens/access.html#new-password) |
| 비회원 주문 인증 | 비회원 주문 조회 선택 | 기존 주문의 연락처로 코드를 요청한다. | [열기](details/screens/access.html#guest) |
| 조회 인증번호 | 조회 인증 요청 접수 | 주문 한 건의 상세로 이동한다. | [열기](details/screens/access.html#code) |
| 인증 실패 | 인증정보 불일치 또는 코드 만료 | 정보나 코드를 다시 입력한다. | [열기](details/screens/access.html#denied) |

<a id="account"></a>

## 회원 정보

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 계정 정보, 기본 배송지
```

회원 정보와 기본 배송지를 관리한다. 저장한 주소 변경은 이후 주문서에 적용되고 기존 주문은 주문 시점의 배송지를 사용한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 회원 정보 | 로그인 성공 또는 내 정보 진입 | 배송지를 관리하거나 주문을 조회한다. | [열기](details/screens/account.html) |
| 배송지 편집 | 기본 배송지 편집 선택 | 저장 결과를 확인하고 내 정보로 복귀한다. | [열기](details/screens/account.html#address) |
| 배송지 저장 | 입력 검증 및 저장 성공 | 다음 주문서에서 기본 배송지를 불러올 수 있다. | [열기](details/screens/account.html#saved) |
| 탈퇴 확인 | 탈퇴 선택 | 본인 재인증 후 계정 세션을 종료한다. | [열기](details/screens/account.html#withdraw) |

<a id="checkout"></a>

## 주문서

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 배송 정보, 결제 명세
```

주소와 배송비를 반영한 총액을 결제 요청 전에 표시한다. 회원 쿠폰은 한 장까지 적용한다. 카드·간편결제 인증창은 PG가 제공한다. 모바일에서는 결제 명세를 배송 입력·제출 버튼 위에 놓는다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 주문 방법 선택 | 주문서 진입 | 회원 로그인 또는 비회원 주문을 선택한다. | [열기](details/screens/checkout.html) |
| 비회원 주문서 | 비회원 주문 선택 | 배송정보와 금액 확인 후 카드·간편결제를 요청한다. | [열기](details/screens/checkout.html#guest) |
| 회원 주문서 | 회원 세션 확인 | 배송지와 정액 쿠폰 한 장을 선택하고 금액을 확인한다. | [열기](details/screens/checkout.html#member) |
| 주문 배송지 입력 | 이번 주문의 배송지 변경 | 주소에 따른 배송비 재계산 후 확인한다. | [열기](details/screens/checkout.html#shipping) |
| 쿠폰 적용 | 회원 정액 쿠폰 선택 | 할인액과 최종 결제 금액을 확인한다. | [열기](details/screens/checkout.html#coupon) |
| 결제 인증 | 주문 생성과 결제 세션 발급 성공 | 외부 PG 인증 결과를 서버가 확인한다. | [열기](details/screens/checkout.html#pg) |
| 결제 확인 중 | 승인 응답 지연 또는 브라우저 복귀 | 같은 주문 결과를 재조회한다. | [열기](details/screens/checkout.html#pending) |
| 결제 실패 | 서버가 최종 승인 실패를 확인 | 주문서로 돌아가 재고와 금액을 확인한 후 다시 시도한다. | [열기](details/screens/checkout.html#failed) |
| 금액 변경 | 서버 재산정 결과가 주문서와 다름 | 새 배송비와 합계를 표시하고 사용자 확인을 다시 받는다. | [열기](details/screens/checkout.html#changed) |
| 비회원 주문 연락처 확인 | 비회원 구매를 선택하고 연락처 인증을 시작 | 인증된 주문 연락처로 주문서를 연다. | [열기](details/screens/checkout.html#guest-code) |
| 배송 불가 주소 | 입력 배송지가 배송 권역 밖 | 구매 제한 사유와 수정 입력을 확인한다. | [열기](details/screens/checkout.html#undeliverable) |

<a id="orders"></a>

## 내 주문

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 주문 목록, 조회 안내
```

주문일과 상태를 기준으로 본인 주문을 조회한다. 비회원은 주문 인증 후 개별 상세로 이동한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 주문 목록 | 내 주문 선택 | 조회할 주문을 선택한다. | [열기](details/screens/orders.html) |
| 주문 없음 | 조회 가능한 주문이 없음 | 상품을 탐색한다. | [열기](details/screens/orders.html#empty) |

<a id="order"></a>

## 주문 상세

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 주문 명세, 처리 상태
```

주문 시점의 품목·할인·배송비와 최신 결제·배송·클레임 상태를 구분한다. 출고 전 취소와 수령 후 반품·교환은 품목 수량 단위로 신청한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 배송완료 | 배송 결과 수신 또는 주문 조회 예시 | 추적 이력 확인이나 품목별 반품·교환을 신청한다. | [열기](details/screens/order.html) |
| 결제완료 | 서버 승인과 재고 할당 확인 | 주문, 영수증과 출고 전 취소 가능 수량을 확인한다. | [열기](details/screens/order.html#paid) |
| 결제 영수증 | 승인된 주문에서 영수증 선택 | 승인 시점의 금액과 수단을 확인한다. | [열기](details/screens/order.html#receipt) |
| 배송 이력 | 배송 조회 선택 | 집화·이동·배송완료 시각을 확인한다. | [열기](details/screens/order.html#tracking) |
| 신청 처리 내역 | 클레임 접수 후 상세 복귀 | 접수 시각과 처리 단계, 다음 확인 방법을 확인한다. | [열기](details/screens/order.html#case) |
| 주문 접근 제한 | 조회 자격 없음 | 인증을 다시 시작하고 타인 주문 정보는 표시하지 않는다. | [열기](details/screens/order.html#denied) |
| 배송 중 | 택배사 인계가 확인됨 | 송장과 배송 진행을 보고 철회 의사를 접수한다. | [열기](details/screens/order.html#transit) |
| 배송·처리 문의 | 미수령 또는 비용 이의 제기 | 주문번호가 연결된 문의를 접수한다. | [열기](details/screens/order.html#support) |
| 상담 접수 | 상담 요청 저장 | 접수 번호로 후속 답변을 확인한다. | [열기](details/screens/order.html#support-sent) |

<a id="claim"></a>

## 취소·반품·교환

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 신청 품목, 신청 내역
```

잔여 신청 가능 수량과 사유를 서버에서 판정한다. 반품 배송비 부담과 예상 환불액을 최종 제출 전에 안내하고, 교환은 동일 SKU의 대체 출고와 연결한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 출고 전 취소 | 미출고 수량이 있음 | 품목·수량·사유와 비용을 확인하고 접수한다. | [열기](details/screens/claim.html) |
| 취소 신청 확인 | 서버가 신청 가능 수량·비용 반환 | 안내된 조건에 따라 신청하거나 입력을 수정한다. | [열기](details/screens/claim.html#estimate-base) |
| 반품 신청 | 수령 후 반품 선택 | 품목·수량·사유와 비용을 확인하고 접수한다. | [열기](details/screens/claim.html#return) |
| 반품 신청 확인 | 서버가 신청 가능 수량·비용 반환 | 안내된 조건에 따라 신청하거나 입력을 수정한다. | [열기](details/screens/claim.html#estimate-return) |
| 동일 옵션 교환 | 수령 후 교환 선택 | 품목·수량·사유와 비용을 확인하고 접수한다. | [열기](details/screens/claim.html#exchange) |
| 교환 신청 확인 | 서버가 신청 가능 수량·비용 반환 | 안내된 조건에 따라 신청하거나 입력을 수정한다. | [열기](details/screens/claim.html#estimate-exchange) |
| 신청 조건 변경 | 출고 경합·수량 소진·교환 재고 소진 | 변경된 주문 상태에서 가능한 다음 행동을 확인한다. | [열기](details/screens/claim.html#blocked) |
| 처리 내역 | 접수 건 조회 | 품목과 처리 진행도를 확인한다. | [열기](details/screens/claim.html#status) |
| 환불 완료 | PG가 취소 완료를 확인 | 환불 금액과 처리일을 확인한다. | [열기](details/screens/claim.html#refunded) |
| 교환품 발송 | 연결된 교환 출고 송장 등록 | 기존 주문에 연결된 교환품 송장을 확인한다. | [열기](details/screens/claim.html#replaced) |
| 배송 중 철회 | 택배사 인계 후 철회 의사 표시 | 접수 시각을 기록하고 회수 경로로 안내한다. | [열기](details/screens/claim.html#transit) |

<a id="admin-catalog"></a>

## 상품·재고 관리

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 옵션 목록, 변경 작업
```

상품 담당자는 상품과 가격을 관리하고, 재고 권한자는 조정 사유를 기록한다. 충돌 시 최신 값을 읽고 다시 판단한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 옵션 목록 | 운영자 로그인·권한 확인 | 옵션별 판매가와 가용 수량을 확인한다. | [열기](details/screens/admin-catalog.html) |
| 상품 등록 | 상품 담당자가 작업 선택 | 필수 상품정보 확인 후 공개한다. | [열기](details/screens/admin-catalog.html#new) |
| 상품 수정 | 상품 담당자가 작업 선택 | 필수 상품정보 확인 후 공개한다. | [열기](details/screens/admin-catalog.html#edit) |
| 재고 조정 | 재고 권한자가 조정 선택 | 조정 수량과 이유를 기록한다. | [열기](details/screens/admin-catalog.html#inventory) |
| 변경 저장 | 운영 변경 커밋 성공 | 처리 결과를 확인하고 최신 값을 조회한다. | [열기](details/screens/admin-catalog.html#saved) |
| 수량 충돌 | 동시 조정 또는 검증 실패 | 최신 수량을 다시 조회한다. | [열기](details/screens/admin-catalog.html#conflict) |
| 운영 권한 없음 | 운영 권한 검사 실패 | 보호된 목록을 숨긴다. | [열기](details/screens/admin-catalog.html#denied) |

<a id="admin-shipping"></a>

## 출고 관리

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 대기 주문, 송장 입력
```

확정된 주문의 미취소 수량을 한 번에 출고한다. 취소와 출고가 경합하면 최신 잔여 수량을 다시 점검한다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 출고 대기 | 배송 담당자 진입 | 결제와 가능 수량을 확인한 다음 송장을 등록한다. | [열기](details/screens/admin-shipping.html) |
| 출고 등록 | 송장 등록 성공 | 주문별 송장과 포장 수량을 확인한다. | [열기](details/screens/admin-shipping.html#sent) |
| 출고 보류 | 승인 확인 중 또는 선행 취소 | 누락·중복 출고를 막고 대상 수량을 재조회한다. | [열기](details/screens/admin-shipping.html#hold) |
| 교환품 출고 | 교환 재고 확보와 검수 완료 | 기존 출고와 별개로 교환 출고 송장을 연결한다. | [열기](details/screens/admin-shipping.html#replacement) |
| 택배사 인계 | 운송장 등록 후 실물 인계 확인 | 운송사 인계 시각을 기록해 출고 수량을 확정한다. | [열기](details/screens/admin-shipping.html#handoff) |
| 인계 완료 | 택배사 집화 확인 | 인계 확정 수량과 시각을 주문에 반영한다. | [열기](details/screens/admin-shipping.html#handed) |

<a id="admin-cases"></a>

## 고객상담·환불

```layout
화면 V 상단 메뉴, 본문, 판매자 정보
본문 V 화면 제목, 작업 영역
작업 영역 > 신청 내역, 처리 작업
```

주문에서 접수한 품목 단위 신청을 처리한다. 반품 검수, 환불 대사, 교환품 출고를 각각 확인하고 처리 이력을 남긴다.

| 장면 | 진입 조건 | 보이는 결과와 다음 동작 | 직접 확인 |
| --- | --- | --- | --- |
| 처리 대기 | CS 권한으로 진입 | 신청 유형과 기한을 확인해 작업을 선택한다. | [열기](details/screens/admin-cases.html) |
| 회수·검수 | 회수 품목 도착 | 회수 시각과 검수 결과를 기록한다. | [열기](details/screens/admin-cases.html#receive) |
| 환불 요청 | 환불 가능 금액과 권한 확인 | 승인 취소를 요청하고 결과를 대사한다. | [열기](details/screens/admin-cases.html#refund) |
| 환불 결과 확인 중 | PG 응답 지연 | 기존 환불 건의 결과를 재조회한다. | [열기](details/screens/admin-cases.html#pending) |
| 교환품 처리 | 동일 SKU 교환 승인 | 원 신청과 연결된 대체 출고를 만든다. | [열기](details/screens/admin-cases.html#replace) |
| 처리 기록 | 검수 저장 또는 환불 대사 완료 | 처리 이력을 조회한다. | [열기](details/screens/admin-cases.html#done) |
| 운영 예외 목록 | 업무 권한으로 지연·기한 임박·대사 차이 조회 | 담당자가 원거래를 확인하거나 재처리를 의뢰한다. | [열기](details/screens/admin-cases.html#exceptions) |


## 시안 확인 결과

Chrome에서 12개 화면의 74개 장면을 390px과 1280px 너비로 각각 열어 선택한 장면이 표시되고 가로 스크롤이 생기지 않는지 확인했다. 주문서는 두 너비의 화면을 캡처해 금액 명세와 결제 버튼의 배치도 확인했다. 검색 결과가 없는 경로와 2,000원 쿠폰을 적용해 25,000원으로 결제 완료 장면에 도달하는 경로를 점검했다. 문서와 HTML의 로컬 참조 431건이 해당 파일·장면을 가리킨다. 실제 주문 저장과 PG·택배사 응답은 구현 단계 인수 시험에 포함한다.
