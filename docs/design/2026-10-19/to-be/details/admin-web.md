# admin-web (정적 SPA) — TO-BE 상세

> **대상**: 운영자 SPA 전체 — 화면 라우트 17개, 화면별 서버 계약, 운영자 화면 이동, 운영자 세션 만료 처리, 상품 이미지 업로드(`C-19`, `R-21`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드가 없는 신규 설계의 문서 기준점)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 라우트·계약·심볼이 제안이다 — `(제안)` 표시는 생략한다. 이 설계가 정하지 못하는 외부 동작은 「가정」, 확인하지 못한 것은 「미확인」이다. 화면 이동은 `navigation`(`navigation-diagram-guide.md`), 경계 안 흐름은 `jobflow`(`job-flow-diagram-guide.md`)로 그린다. 스택은 상위 §9.5의 잠정안(React + TypeScript + Vite)을 따른다
> **범위 한정**: 상품 대량 등록(엑셀 업로드)과 운영 통계 화면은 범위 밖이다 — 상위 `R-21`에 없다

## 1. 책임 / 비책임

- **책임**: 운영자가 상품·SKU·재고·카테고리·기획전·쿠폰을 등록하고, 주문을 찾아 송장을 넣고, 반품·교환을 회수 확인·검수 완료·거절하는 화면을 준다(`R-21`). 화면마다 해당 `/api/admin/*` 계약을 부르고 오류를 화면 메시지로 바꾼다. 운영자 세션이 없으면 로그인 화면으로 보내고, 쓰는 중에 세션이 끝나면 재로그인 창을 띄운 뒤 막힌 요청을 한 번 다시 보낸다. 상품 이미지는 서명 URL로 객체 저장소에 직접 올리고 키만 서버에 보낸다. 상태를 바꾸는 요청에 CSRF 헤더를 붙인다.
- **비책임**: 업무 규칙과 최종 검사(catalog·promotion·order·claim — 화면 검사는 편의일 뿐이다), 운영자 계정·세션·역할의 저장과 판정(member), `/api/admin/*`의 운영자 확인(mall-api 인증·권한 미들웨어), 택배사 코드 목록의 원본(order), 이미지 객체의 보존·삭제(catalog·객체 저장소), 알림톡 발송(notification — 송장 등록이 적재한다).
- **아무도 하지 않는 것**: 운영자 작업 이력 화면(누가 언제 송장·환불을 처리했는지 — 기록 위치 미확정, §8), 운영자 계정 관리 화면(계정 생성은 DB·운영 스크립트로 한다고 가정, §8), 상품 대량 등록.

## 2. 공개 계약

이 경계의 공개 진입점은 브라우저 주소인 화면 라우트 17개다(표 15행 — 기획전·쿠폰의 새 폼과 수정 폼은 한 화면 컴포넌트라 한 행에 둘씩 적었다). 모두 mall-api가 `/admin` 아래에서 같은 `index.html`로 내려주고(히스토리 폴백 — [mall-api 상세 §2](mall-api.md#2-공개-계약)), 화면 전환은 이 SPA의 라우터가 한다. 표의 `메서드·경로`는 브라우저 주소, `입력`은 경로 변수·쿼리, `출력`은 화면과 그 화면이 처음 부르는 서버 계약, `구현`은 제안 화면 컴포넌트다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `GET /admin/login` | 쿼리 `expired?`(세션 만료로 왔을 때 1) | `AdminLogin` — 아이디·비밀번호 폼 | 401 `INVALID_CREDENTIALS`·423 `LOCKED {until}`은 폼에 머문다 | `LoginPage` → `AuthApi.login` |
| `GET /admin` | — | `/admin/orders`로 고정 리다이렉트 | — | `AdminRouter` |
| `GET /admin/orders` | 쿼리 `status`(`MANUAL_REVIEW` 포함)·`q`(주문번호·주문자 이름·휴대폰 뒤 4자리)·`from`·`to`·`page` | `AdminOrderList` — 주문 표, 「확인 필요」 탭(`status=MANUAL_REVIEW`)에 건수 표시 | 목록 실패는 「다시 시도」 띠 | `OrderListPage` → `OrderApi.searchOrders` |
| `GET /admin/orders/:orderId` | 경로 `orderId` | `AdminOrderDetail` — 품목(「상품 준비중」 `PREPARING` 표시)·결제·배송지·송장·클레임·상태 이력, `PAID` 품목의 「발주 확인」, 품목별 송장 입력, `MANUAL_REVIEW` 주문의 「확인 처리」 | 404 → 「없는 주문」 | `OrderDetailPage` → `OrderApi.getOrder` |
| `GET /admin/claims` | 쿼리 `status`·`type`(`RETURN`·`EXCHANGE`)·`page` | `AdminClaimList` | 목록 실패는 「다시 시도」 띠 | `ClaimListPage` → `ClaimApi.searchClaims` |
| `GET /admin/claims/:claimId` | 경로 `claimId` | `AdminClaimDetail` — 품목·사유·회수지·상태 이력, 회수 확인·검수 완료·거절·재발송 송장 | 404 | `ClaimDetailPage` → `ClaimApi.getClaim` |
| `GET /admin/products` | 쿼리 `q`·`categoryId`·`status`(`DRAFT`·`ON_SALE`·`STOPPED`)·`stock`(`OUT` — 가용 수량 0인 SKU가 있는 상품, 품절)·`page` | `AdminProductList` — 임시저장·판매중지 포함 | 목록 실패는 「다시 시도」 띠 | `ProductListPage` → `CatalogApi.listProducts` |
| `GET /admin/products/new` | — | `AdminProductForm` 빈 폼 — 카테고리 트리를 먼저 읽는다 | — | `ProductFormPage` → `CatalogApi.listCategories` |
| `GET /admin/products/:productId` | 경로 `productId` | `AdminProductForm` 수정 폼 | 404 | `ProductFormPage` → `CatalogApi.getProduct` |
| `GET /admin/products/:productId/stock` | 경로 `productId` | `AdminStockAdjust` — SKU별 실재고·가예약·가용 수량과 조정 폼 | 404 | `StockAdjustPage` → `CatalogApi.getProduct` |
| `GET /admin/categories` | — | `AdminCategoryTree` — 트리 편집(이름·순서·노출) | 저장 오류는 행에 표시 | `CategoryTreePage` → `CatalogApi.listCategories` |
| `GET /admin/exhibitions` | 쿼리 `status`(`DRAFT`·`PUBLISHED`·`HIDDEN`)·`period`(`UPCOMING`·`ONGOING`·`ENDED` — 기간 기준)·`page` | `AdminExhibitionList` | 목록 실패는 「다시 시도」 띠 | `ExhibitionListPage` → `PromotionApi.listExhibitions` |
| `GET /admin/exhibitions/new`·`/admin/exhibitions/:exhibitionId` | 경로 `exhibitionId?` | `AdminExhibitionForm` — 배너·노출 위치·기간·상품·쿠폰 | 404 | `ExhibitionFormPage` → `PromotionApi.getExhibition` |
| `GET /admin/coupons` | 쿼리 `status`·`page` | `AdminCouponList` — 발급 수·사용 수 | 목록 실패는 「다시 시도」 띠 | `CouponListPage` → `PromotionApi.listCoupons` |
| `GET /admin/coupons/new`·`/admin/coupons/:couponId` | 경로 `couponId?` | `AdminCouponForm` — 새 쿠폰은 입력 폼, 기존 쿠폰은 발급 현황과 바꿀 수 있는 칸(이름·발급 수량·받기 마감·발급 중지). 1매라도 발급됐으면 할인 조건·대상·유효기간 칸을 잠근다 | 404 | `CouponFormPage` → `PromotionApi.getCoupon` |

- **공통 진입 가드**: `/admin/login`을 뺀 모든 라우트는 들어올 때 `SessionGuard.check`가 운영자 세션을 확인한다(`JF-2`). 없으면 주소를 복귀 주소로 남기고 `/admin/login`으로 보낸다. 정의되지 않은 `/admin/*`는 `AdminNotFound`를 보인다(고정 — 그리지 않는다).
- **공통 오류 처리**: 모든 서버 호출은 `adminHttp.request` 하나를 지난다(`JF-1`). 401은 재로그인, 403은 「권한 없음」 알림, 409·410은 각 화면이 응답 `code`로 메시지를 고른다. 422는 `VALIDATION_FAILED`의 `details.fields[{field, reason}]`를 해당 칸에 표시하고, 필드가 없는 422는 폼 위 알림이다. 423·429 `LOCKED {until}`은 「{until}까지 잠김」, 429 `RATE_LIMITED`는 「잠시 뒤 다시」, 5xx·502·연결 실패는 「잠시 뒤 다시」 알림이다. 오류 본문은 mall-api의 `{code, message, details}` 한 형식이다([mall-api 상세 §2](mall-api.md#2-공개-계약)).
- **두 번 누름**: 상태를 바꾸는 버튼은 요청이 끝날 때까지 잠근다. 서버 쪽 방어(조건부 전이·멱등 키)가 따로 있으므로 화면 잠금은 편의다.

### 2.1 화면 이동

운영자 화면 이동의 원본이 이 소절이다(고객 화면은 `docs/navigation.md`와 [storefront-web 상세](storefront-web.md)). 모든 화면의 왼쪽 메뉴는 목록 화면 여섯(`AdminOrderList`·`AdminClaimList`·`AdminProductList`·`AdminCategoryTree`·`AdminExhibitionList`·`AdminCouponList`)으로 가는 고정 링크라 그리지 않는다. 논리 API 이름의 실제 주소는 [2.2](#22-화면별-서버-계약)에 있다.

**진입과 로그인** — 운영자가 `/admin/*` 주소를 직접 열거나 북마크로 들어오면 가드 `(check_admin_session)`에서 시작한다. 로그인됐으면 요청한 화면을 그대로 연다(화면이 여럿이라 `AdminOrderList` 하나로 대표했다).

```navigation
(check_admin_session) --> AdminOrderList : 로그인됨
(check_admin_session) --> (save_admin_return_path) : 미로그인
(save_admin_return_path) --> AdminLogin
AdminLogin --> (validate_form)
(validate_form) --> AdminLogin : invalid
(validate_form) --> (/admin/auth/login) : success
(/admin/auth/login) --> AdminLogin : error
(/admin/auth/login) --> (restore_admin_return_path) : success
(restore_admin_return_path) --> AdminOrderList : 복귀 주소 없음
```

- 복귀 주소가 있으면 그 화면으로 간다. 복귀 주소는 `/admin/`으로 시작하는 경로만 받는다(열린 리디렉션 방지).
- 로그아웃은 메뉴의 「로그아웃」 → `(/admin/auth/logout)` → `AdminLogin`이다.

**쓰는 중 세션 만료** — 어느 화면이든 서버가 401을 주면 같은 모양이다. 상품 폼으로 대표했다.

```navigation
AdminProductForm --> (/admin/products/save) : 저장
(/admin/products/save) --> AdminProductForm(ReLoginModal) : 세션 만료
AdminProductForm(ReLoginModal) --> (/admin/auth/login)
(/admin/auth/login) --> AdminProductForm(ReLoginModal) : error
(/admin/auth/login) --> (retry_request) : success
(retry_request) --> AdminProductForm : 다시 보낸 결과
AdminProductForm(ReLoginModal) --> (save_admin_return_path) : 취소
(save_admin_return_path) --> AdminLogin
```

- 재로그인 창은 화면 위의 오버레이라 폼에 입력한 값이 남는다. 막힌 요청은 로그인 성공 뒤 한 번만 다시 보낸다(`JF-1`).

**상품·재고**

```navigation
AdminProductList --> AdminProductForm : 상품 등록 또는 상품 선택
AdminProductForm --> (validate_product)
(validate_product) --> AdminProductForm : invalid
(validate_product) --> (/admin/products/save) : success
(/admin/products/save) --> AdminProductForm : error
(/admin/products/save) --> AdminProductList : success
AdminProductList --> AdminStockAdjust : 재고 조정
AdminProductForm --> AdminStockAdjust : 재고 조정
AdminStockAdjust --> (/admin/skus/stock)
(/admin/skus/stock) --> AdminStockAdjust : below_reserved
(/admin/skus/stock) --> AdminStockAdjust : success
```

- 이미지 올리기와 카테고리 편집은 화면에 머물러 이동이 없다 — 그리지 않는다(이미지는 `JF-6.1`).

**기획전·쿠폰**

```navigation
AdminExhibitionList --> AdminExhibitionForm : 기획전 등록 또는 선택
AdminExhibitionForm --> AdminExhibitionForm(ProductPickerModal) : 상품 추가
AdminExhibitionForm(ProductPickerModal) --> AdminExhibitionForm : 선택 완료
AdminExhibitionForm --> (/admin/exhibitions/save)
(/admin/exhibitions/save) --> AdminExhibitionForm : error
(/admin/exhibitions/save) --> AdminExhibitionList : success
AdminCouponList --> AdminCouponForm : 쿠폰 등록 또는 선택
AdminCouponForm --> (validate_coupon)
(validate_coupon) --> AdminCouponForm : invalid
(validate_coupon) --> (/admin/coupons/save) : success
(/admin/coupons/save) --> AdminCouponForm : error
(/admin/coupons/save) --> AdminCouponList : success
```

**주문·송장·클레임**

```navigation
AdminOrderList --> AdminOrderDetail : 주문 선택
AdminOrderDetail --> (/admin/orders/prepare) : 발주 확인
(/admin/orders/prepare) --> AdminOrderDetail : 성공·상태 바뀜 모두
AdminOrderDetail --> AdminOrderDetail(ResolveModal) : 확인 처리
AdminOrderDetail(ResolveModal) --> (/admin/orders/resolve) : 결제 확정 또는 해제
(/admin/orders/resolve) --> AdminOrderDetail(ResolveModal) : error
(/admin/orders/resolve) --> AdminOrderDetail : success
AdminOrderDetail --> (validate_shipment) : 송장 등록
(validate_shipment) --> AdminOrderDetail : invalid
(validate_shipment) --> (/admin/orders/shipments) : success
(/admin/orders/shipments) --> AdminOrderDetail : error
(/admin/orders/shipments) --> AdminOrderDetail : success
AdminOrderDetail --> AdminClaimDetail : 클레임 표시 선택
AdminClaimList --> AdminClaimDetail : 클레임 선택
AdminClaimDetail --> (/admin/claims/collect) : 회수 확인
(/admin/claims/collect) --> AdminClaimDetail
AdminClaimDetail --> AdminClaimDetail(InspectionModal) : 검수 완료
AdminClaimDetail(InspectionModal) --> (/admin/claims/complete)
(/admin/claims/complete) --> AdminClaimDetail(InspectionModal) : error
(/admin/claims/complete) --> AdminClaimDetail : success
(/admin/claims/complete) --> AdminClaimDetail : refund_pending
AdminClaimDetail --> AdminClaimDetail(RejectModal) : 거절
AdminClaimDetail(RejectModal) --> (/admin/claims/reject)
(/admin/claims/reject) --> AdminClaimDetail : success
AdminClaimDetail --> (validate_reshipment) : 재발송 송장 등록
(validate_reshipment) --> (/admin/orders/shipments) : success
AdminClaimDetail --> AdminOrderDetail : 주문 보기
```

- 「발주 확인」은 고른 `PAID` 품목을 `PREPARING`(상품 준비중)으로 바꾼다. 그 뒤 고객은 주문을 취소할 수 없다(잠정 — order 상세). 결과와 상관없이 `AdminOrderDetail`에 머물며 주문을 다시 읽는다.
- 「확인 처리」는 대사·만료가 결론을 내지 못해 `MANUAL_REVIEW`로 빠진 주문에만 보인다. 운영자가 PG 콘솔에서 사실을 확인한 뒤 `ResolveModal`에서 「결제 확정」(`CONFIRM_PAID`) 또는 「해제」(`RELEASE` — 환불을 확인한 뒤)를 고르고 메모를 남긴다. `error`는 오류 코드마다 문구가 다르다 — 422 `VALIDATION_FAILED`는 「확인한 사실을 메모로 남겨 주세요」, 409 `NOT_SETTLEABLE`(가예약이 없어 결제 확정 불가)은 「재고 가예약이 없어 결제 확정을 할 수 없습니다. PG 콘솔에서 환불한 뒤 「해제」를 고르세요」, 409 `NOT_RELEASABLE`(이미 출고된 주문)은 「출고된 주문은 해제할 수 없습니다. 반품 절차로 처리하세요」, 503 `RETRY_LATER`는 「잠시 뒤 다시 시도해 주세요」를 창에 보이고 창에 머문다. 409 `INVALID_STATE`(이미 `MANUAL_REVIEW`를 벗어남)만 「이미 처리된 주문입니다」 알림과 함께 창을 닫고 다시 읽는다.
- 송장 등록 성공·실패는 `AdminOrderDetail`에 머물며 주문을 다시 읽는다. `refund_pending`은 검수 완료가 환불 실패로 `REFUND_PENDING`에 남은 경우다 — 화면은 「환불 대기 — 다시 완료」 버튼을 보인다(상위 [§5.12](../system-design-to-be.md#512-반품교환--신청에서-검수-완료까지)).
- 재발송 송장은 교환 완료(`EXCHANGED`) 뒤에만 버튼이 보인다. 결과는 위 송장 등록과 같다.

### 2.2 화면별 서버 계약

이 경계가 부르는 서버 계약 전수다. 입력·출력·오류의 원본은 계약 원본 칸의 상세 §2이고, 여기에는 화면이 쓰는 부분만 적는다. 상위 노드 칸은 상위 §5의 계약명이다.

| 화면 | 서버 계약 | 상위 §5 노드 | 계약 원본 |
|---|---|---|---|
| `AdminLogin`·재로그인 창 | `POST /api/admin/auth/login {loginId, password}` → 200 + 운영자 세션 쿠키, 401·423 | `Member.adminLogin`(§5.15) | [member 상세 §2](member.md#2-공개-계약) |
| 공통 가드·머리글 | `GET /api/admin/auth/me` → 200 `{adminId, name, role}`, 401 | `Member.adminLogin`(§5.1 — 운영 인증 라우트 묶음) | [member 상세 §2](member.md#2-공개-계약) |
| 메뉴 「로그아웃」 | `POST /api/admin/auth/logout` → 204 | `Member.adminLogin`(§5.1 — 운영 인증 라우트 묶음) | [member 상세 §2](member.md#2-공개-계약) |
| `AdminOrderList` | `GET /api/admin/orders?status=&q=&from=&to=&page=` → 주문 요약(`status=MANUAL_REVIEW`로 확인 필요 주문만) | `Order.adminOrders`(§5.1) | [order 상세 §2](order.md#2-공개-계약) |
| `AdminOrderDetail` | `GET /api/admin/orders/{orderId}` → 품목·결제·배송지·송장·클레임 표시 | `Order.adminOrders`(§5.1) | [order 상세 §2](order.md#2-공개-계약) |
| `AdminOrderDetail` | `POST /api/admin/orders/{orderId}/prepare {lineIds[]}` → 200(품목 `PAID → PREPARING`), 409 `INVALID_STATE {lineId, status}` | `Order.prepareShipment`(§5.11) | [order 상세 §2](order.md#2-공개-계약) |
| `AdminOrderDetail(ResolveModal)` | `POST /api/admin/orders/{orderId}/resolve {action:'CONFIRM_PAID'·'RELEASE', note}` → 200(`CONFIRM_PAID`는 결제 확정, `RELEASE`는 해제), 409 `INVALID_STATE`(`MANUAL_REVIEW`가 아님)·`NOT_SETTLEABLE`(가예약 없음 — 환불 확인 뒤 `RELEASE`)·`NOT_RELEASABLE`(출고 뒤 — 반품 절차로), 422 `VALIDATION_FAILED`(`note` 없음), 503 `RETRY_LATER`(일시 오류) | `Order.adminOrders`(§5.1) | [order 상세 §2](order.md#2-공개-계약) |
| `AdminOrderDetail`·`AdminClaimDetail` | `POST /api/admin/orders/{orderId}/shipments {lineIds[], carrierCode, trackingNumber, claimId?}` → 201(품목 `PAID`·`PREPARING` → `SHIPPING`), 409 `INVALID_STATE`, 422 택배사 코드·운송장 | `Order.registerShipment`(§5.11) | [order 상세 §2](order.md#2-공개-계약) |
| 송장 입력 폼 | `GET /api/admin/orders/carriers` → 200 `{carriers[{code, name}]}`(order 설정 `order.carriers`의 택배사 목록) | `Order.adminOrders`(§5.1) | [order 상세 §2](order.md#2-공개-계약) |
| `AdminClaimList` | `GET /api/admin/claims?status=&type=&page=` | `Claim.inspect`(§5.1) | [claim 상세 §2](claim.md#2-공개-계약) |
| `AdminClaimDetail` | `GET /api/admin/claims/{claimId}` | `Claim.inspect`(§5.1) | [claim 상세 §2](claim.md#2-공개-계약) |
| `AdminClaimDetail` | `POST /api/admin/claims/{claimId}/collect` → 200, 409 상태 | `Claim.inspect`(§5.1), §5.12 그림 밖 | [claim 상세 §2](claim.md#2-공개-계약) |
| `AdminClaimDetail(InspectionModal)` | `POST /api/admin/claims/{claimId}/complete` — 반품 `{inspection:'OK'·'DAMAGED', faultParty:'BUYER'·'SELLER'}`, 교환 `{inspection}` → 200 반품 `{status, refundAmount, returnFee}`, 409 `INVALID_STATE`·`REFUND_TERMS_FIXED`·`EXCHANGE_OUT_OF_STOCK`, 502 `REFUND_FAILED {result}`(클레임 `REFUND_PENDING`) | `Claim.completeReturn`(§5.12) | [claim 상세 §2](claim.md#2-공개-계약) |
| `AdminClaimDetail(RejectModal)` | `POST /api/admin/claims/{claimId}/reject {reasonText}`(고객에게 보인다) → 200, 409, 422 | `Claim.inspect`(§5.1), §5.12 그림 밖 | [claim 상세 §2](claim.md#2-공개-계약) |
| `AdminProductList` | `GET /api/admin/products?q=&categoryId=&status=&stock=&page=` — `status` = `DRAFT`·`ON_SALE`·`STOPPED`, `stock=OUT` = 품절 SKU가 있는 상품 | `Catalog.adminCatalog`(§5.1) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminProductForm`·`AdminStockAdjust` | `GET /api/admin/products/{productId}` → 상품·옵션·SKU(`available`·`reserved`·`saleStatus`)·이미지·`version` | `Catalog.adminCatalog`(§5.1) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminProductForm` | `POST /api/admin/products {name, brand, categoryId, description, optionAxes[], skus[], imageKeys[], status, searchTags[]}`·`PATCH /api/admin/products/{productId}`(일부 필드 + `version`) → 201/200, 409 `VERSION_CONFLICT`(수정만), 422 `VALIDATION_FAILED` | `Catalog.saveProduct`(§5.15) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminProductForm` | `POST /api/admin/uploads/product-images {contentType, size}` → 201 `{objectKey, uploadUrl, headers, expiresAt}` — 파일마다 1회, 422 `UNSUPPORTED_TYPE`·`TOO_LARGE` | `Catalog.issueUploadUrl`(§5.15) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminProductForm` | 서명 URL로 `PUT`(브라우저 → 객체 저장소 직접) | `Storage.putObject`(§5.15) | 객체 저장소(가정 — S3 호환 서명 URL) |
| `AdminStockAdjust` | `PATCH /api/admin/skus/{skuId}/stock {delta, reason}` → 200, 409 `BELOW_RESERVED` | `Catalog.adjustStock`(§5.15) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminProductForm`·`AdminCategoryTree` | `GET /api/admin/categories` → 숨김 포함 트리 | `Catalog.adminCatalog`(§5.1) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminCategoryTree` | `POST /api/admin/categories {name, parentId?, sortOrder, visible}`·`PATCH /api/admin/categories/{categoryId}`·`DELETE /api/admin/categories/{categoryId}` → 201/200/204, 409 `CATEGORY_IN_USE`, 422 `DEPTH_EXCEEDED`·`CYCLE` | `Catalog.adminCatalog`(§5.1) — §5.15 「같은 꼴이라 그리지 않음」 | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminExhibitionList`·`AdminExhibitionForm` | `GET /api/admin/exhibitions?status=&period=&page=`(`status` = `DRAFT`·`PUBLISHED`·`HIDDEN`, `period` = `UPCOMING`·`ONGOING`·`ENDED`)·`GET /api/admin/exhibitions/{exhibitionId}` → 단건(상품 ID·쿠폰 ID 포함), 404 | `Promotion.adminPromotion`(§5.1) | [promotion 상세 §2](promotion.md#2-공개-계약) |
| `AdminExhibitionForm` | `POST /api/admin/exhibitions {title, bannerImageKey, placement, productIds[], couponIds[], period, status}`·`PATCH /api/admin/exhibitions/{exhibitionId}` → 201/200, 422 | `Promotion.saveExhibition`(§5.15) | [promotion 상세 §2](promotion.md#2-공개-계약) |
| `AdminExhibitionForm(ProductPickerModal)` | `GET /api/admin/products?q=&status=ON_SALE` — 위 상품 목록과 같은 계약 | `Catalog.adminCatalog`(§5.1) | [catalog 상세 §2](catalog.md#2-공개-계약) |
| `AdminCouponList`·`AdminCouponForm` | `GET /api/admin/coupons?status=&page=` → 정의·`issuedCount`·`usedCount`, `GET /api/admin/coupons/{couponId}` → 단건 정의·`issuedCount`·`usedCount`, 404 | `Promotion.adminPromotion`(§5.1) | [promotion 상세 §2](promotion.md#2-공개-계약) |
| `AdminCouponForm` | `POST /api/admin/coupons {name, discountType, value, maxDiscount?, minOrderAmount, target, issueLimit?, perMemberLimit:1, validFrom·validTo 또는 daysAfterDownload, downloadFrom, downloadTo}` → 201, 422 | `Promotion.saveCoupon`(§5.15) | [promotion 상세 §2](promotion.md#2-공개-계약) |
| `AdminCouponForm` | `PATCH /api/admin/coupons/{couponId} {name?, issueLimit?, downloadTo?, status:'ACTIVE'·'STOPPED'?, 할인 조건?}` → 200, 409 `COUPON_TERMS_LOCKED`·`BELOW_ISSUED`, 422 | `Promotion.saveCoupon`(§5.15) | [promotion 상세 §2](promotion.md#2-공개-계약) |

- 상위 §5.1의 묶음 노드 `AdminBrowser.call`은 위 표 전부다. 발주 확인은 상위 §5.11의 `AdminBrowser.prepareOrder`(→ `Order.prepareShipment`), 확인 처리는 `Order.adminOrders` 묶음에 들고 둘 다 [§3 `JF-9`](#jf-9-발주-확인과-확인-처리--orderdetailpagepreparelines)에서 연다. 상위가 따로 그린 나머지 노드(`registerShipment`·`completeClaim`·`login`·`uploadImage`·`saveProduct`·`adjustStock`·`saveCoupon`·`saveExhibition`)는 [§3](#3-내부-job-flow--드릴다운)의 그림에서 연다.
- 이미 발급한 쿠폰의 할인 조건·대상·유효기간은 바꿀 수 없다(promotion `COUPON_TERMS_LOCKED`) — 회원이 가진 쿠폰의 뜻이 바뀌기 때문이다. 화면은 그 칸을 미리 잠근다.

### 2.3 세션 만료·역할

- **세션 쿠키**: 운영자 세션은 member가 `ASID` 쿠키(httpOnly·Secure·SameSite=Strict·`Path=/api/admin`)로 준다(이름·경로는 mall-api 상세와 같다). 고객 세션 `SID`와 이름·경로를 나눠, 같은 브라우저에서 고객으로 로그인해도 운영자 세션이 덮이지 않는다([mall-api 상세 §2](mall-api.md#2-공개-계약)). member·mall-api 상세가 같은 이름·경로를 쓴다.
- **만료**: 운영자 세션은 유휴 30분·절대 8시간이고 「로그인 유지」를 주지 않는다(잠정 — [member 상세 §4](member.md#4-소유-상태데이터)가 원본). 화면은 만료 시각을 세지 않는다. 서버의 401이 유일한 신호다.
- **401 처리**: 진입 가드에서 받으면 로그인 화면으로, 쓰는 중에 받으면 재로그인 창으로 간다(§2.1). 401은 mall-api 인증 단계에서 정해져 업무 처리기에 닿지 않으므로, 막힌 상태 변경 요청을 다시 보내도 같은 일이 두 번 일어나지 않는다([mall-api 상세 §3](mall-api.md#3-내부-job-flow--드릴다운)).
- **CSRF**: 상태를 바꾸는 요청(`POST`·`PUT`·`PATCH`·`DELETE`)마다 `XSRF-TOKEN` 쿠키 값을 읽어 `X-CSRF-Token` 헤더에 넣는다. 로그인하면 서버가 토큰을 바꾸므로 값을 기억해 두지 않고 요청마다 쿠키에서 읽는다.
- **역할**: 이 화면은 잠정으로 `ADMIN` 하나를 전제한다. 화면은 역할로 메뉴를 숨기지 않고, 서버의 403을 「권한 없음」으로 보일 뿐이다. member 상세도 같은 잠정이다 — 역할 세분화는 §8의 미확정이다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 단일 조율자는 없다 — 화면 컴포넌트(`*Page`)가 각자 자기 화면의 흐름을 조율하고, 모든 서버 호출은 공통 요청기 `adminHttp.request` 하나를 지난다. 바깥으로 나가는 클라이언트 객체는 업무별 API 객체 다섯(`AuthApi`·`OrderApi`·`ClaimApi`·`CatalogApi`·`PromotionApi`)과 객체 저장소 업로드용 `StorageClient`다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `AdminBrowser.call`(§5.1) — 운영 요청 전부 | [`JF-1` 공통 요청](#jf-1-공통-요청--adminhttprequest), [`JF-2` 진입 가드](#jf-2-진입-가드--sessionguardcheck) | — |
| `AdminBrowser.registerShipment`(§5.11) | [`JF-3` 송장 등록](#jf-3-송장-등록--orderdetailpageregistershipment) | — |
| `AdminBrowser.prepareOrder`(§5.11 — 발주 확인), `AdminBrowser.call` → `Order.adminOrders`(§5.1) 중 확인 처리 | [`JF-9` 발주 확인과 확인 처리](#jf-9-발주-확인과-확인-처리--orderdetailpagepreparelines) | — |
| `AdminBrowser.completeClaim`(§5.12) — 그림 밖의 회수 확인·거절·재발송 송장 포함 | [`JF-4` 클레임 처리](#jf-4-클레임-처리--claimdetailpagecompleteclaim) | — |
| `AdminBrowser.login`(§5.15) | [`JF-5` 운영자 로그인](#jf-5-운영자-로그인--loginpagesubmit) | — |
| `AdminBrowser.uploadImage`·`AdminBrowser.saveProduct`(§5.15) | [`JF-6` 상품 저장](#jf-6-상품-저장--productformpagesaveproduct) | `uploadImage` → [`JF-6.1` 이미지 올리기](#jf-61-이미지-올리기--imageuploaderupload) |
| `AdminBrowser.adjustStock`(§5.15) | [`JF-7` 재고 조정](#jf-7-재고-조정--stockadjustpageadjuststock) | — |
| `AdminBrowser.saveCoupon`·`AdminBrowser.saveExhibition`(§5.15) | [`JF-8` 프로모션 저장](#jf-8-프로모션-저장--couponformpagesavecoupon-exhibitionformpagesaveexhibition) | — |

상위 바깥 노드 ↔ 이 경계의 클라이언트: `Member.adminLogin` = `AuthApi.login`, `Order.prepareShipment` = `OrderApi.prepareLines`, `Order.registerShipment` = `OrderApi.registerShipment`, `Order.adminOrders` = `OrderApi.searchOrders`·`getOrder`·`prepareLines`·`resolveReview`, `Claim.completeReturn` = `ClaimApi.complete`, `Claim.inspect` = `ClaimApi.collect`·`reject`·`searchClaims`·`getClaim`, `Catalog.issueUploadUrl` = `CatalogApi.issueUploadUrl`, `Catalog.saveProduct`·`adjustStock` = `CatalogApi.saveProduct`·`adjustStock`, `Promotion.saveCoupon`·`saveExhibition` = `PromotionApi.saveCoupon`·`saveExhibition`, `Storage.putObject` = `StorageClient.put`. 업무별 API 객체는 모두 `adminHttp.request`를 부르는 얇은 함수 묶음이다.

**표기** 노드는 제안 심볼이다. 클래스가 아닌 모듈 객체는 소문자로 시작한다 — `adminHttp`(공통 요청기), `csrfToken`(쿠키에서 토큰 읽기), `imageRules`·`couponRules`(화면 검사 순수 함수). `*Queries`는 서버 상태 캐시(잠정 TanStack Query)의 무효화 함수다. 렌더 확인은 이 문서의 jobflow 블록 전부를 design-doc-check 렌더러로 SVG를 만들고 PNG로 바꿔 눈으로 봤다(브리프 §5에 통합 때 기록). 열지 않은 것: 업무별 API 객체(경로를 정해 `adminHttp.request`를 부를 뿐이다), 목록 화면(조회 하나와 표 그리기뿐이다), `CategoryTreePage`(상위 §5.15가 「같은 꼴」로 뺀 화면 — `JF-6`과 같은 모양).

### JF-1 공통 요청 — adminHttp.request

```jobflow
orchestrator: adminHttp
Object: adminHttp, csrfToken, HttpTransport, ApiError, ReLoginModal

adminHttp.request --> csrfToken.read
adminHttp.request --> HttpTransport.send
HttpTransport.send.failed --> ApiError.from
HttpTransport.send.unauthorized --> ReLoginModal.open
ReLoginModal.open.cancelled
ReLoginModal.open.loggedIn --> HttpTransport.send
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `adminHttp.request` | `C-19`·`R-21` | 모든 업무별 API 객체가 부르는 단일 진입점. 경로·메서드·본문을 받아 응답 본문이나 `ApiError`를 돌려준다 |
| `csrfToken.read` | `C-21`·`D-05` | 상태를 바꾸는 메서드일 때만 `XSRF-TOKEN` 쿠키를 읽어 `X-CSRF-Token` 헤더로 붙인다. `GET`은 부르지 않는다 |
| `HttpTransport.send` | `C-19` | 브라우저 `fetch` 감싸개 — `credentials:'same-origin'`, 기본 15s 시간 제한(§6). 응답 상태로 `.failed`(401 밖의 4xx·5xx·연결 실패)·`.unauthorized`(401)를 가른다 |
| `ApiError.from` | `C-21` | 오류 본문 `{code, message, details}`를 화면이 쓰는 오류 값으로 바꾼다. 본문이 그 형식이 아니면(프록시 오류 등) `code:'NETWORK'` |
| `ReLoginModal.open` | `D-05`·`R-21` | 재로그인 창을 띄우고 로그인 결과를 기다린다. 안에서 `AuthApi.login`(`JF-5`와 같은 계약)을 부른다. `.cancelled`면 복귀 주소를 남기고 `/admin/login`으로 가며, 막힌 요청은 401 오류로 끝난다 |
| `.loggedIn` → `HttpTransport.send` | `D-05` | 막힌 요청을 **한 번만** 다시 보낸다. 다시 보낼 때 CSRF 헤더를 새 쿠키 값으로 다시 만든다(로그인이 토큰을 바꾼다) |

- **트리거** 모든 화면의 서버 호출(상위 `AdminBrowser.call`). **완료 사실** 응답 본문, 또는 화면이 메시지로 바꿀 `ApiError`.
- `HttpTransport.send`로 들어오는 두 번째 화살표는 **실제 재호출**이다 — 조건은 401 뒤 재로그인 성공, 횟수는 1회다. 다시 보낸 요청이 또 401이면 재로그인을 다시 띄우지 않고 오류로 끝낸다. 중복 효과는 없다 — 401은 mall-api 인증 단계에서 정해져 처리기에 닿지 않았다([mall-api 상세 §3](mall-api.md#3-내부-job-flow--드릴다운)). 다시 보낸 요청의 실패도 `ApiError.from`을 지난다(렌더러는 첫 `send` 칸 아래에만 `.failed`를 그렸다).
- 여러 요청이 동시에 401을 받으면 재로그인 창은 하나만 뜨고, 기다리던 요청은 로그인 뒤 모두 한 번씩 다시 보낸다(`open`이 같은 약속 객체를 돌려준다).
- 403은 `.failed` 쪽이다 — 화면은 「권한 없음」 알림을 띄우고 이동하지 않는다. 자동 재시도는 없다. 502(환불 실패 등)를 다시 보낼지는 운영자가 정한다(`JF-4`).

### JF-2 진입 가드 — SessionGuard.check

```jobflow
orchestrator: SessionGuard
Object: SessionGuard, AuthApi, ReturnPath, AdminRouter

SessionGuard.check --> AuthApi.me
AuthApi.me.unauthorized --> ReturnPath.save
ReturnPath.save --> AdminRouter.goLogin
AuthApi.me.result --> AdminRouter.enter
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SessionGuard.check` | `C-19`·`R-21` | 라우터가 `/admin/login` 밖의 화면에 들어가기 전에 부른다. 앱을 처음 열 때 한 번 부르고 결과(운영자 이름·역할)를 메모리에 둔다 — 그 뒤 화면 전환에서는 다시 부르지 않고 서버 401에 맡긴다 |
| `AuthApi.me` | `C-02` | `GET /api/admin/auth/me`([member 상세 §2](member.md#2-공개-계약)). 401이면 `.unauthorized`. 이 호출의 401은 재로그인 창을 띄우지 않도록 `adminHttp.request`에 「가드 호출」 표시를 넘긴다 |
| `ReturnPath.save` → `AdminRouter.goLogin` | `C-19` | 요청한 주소(`/admin/` 시작만)를 sessionStorage `admin.returnPath`에 쓰고 `/admin/login`으로 바꾼다 |
| `AdminRouter.enter` | `C-19` | 요청한 화면을 연다. 머리글에 운영자 이름을 보인다 |

- **트리거** 주소 직접 입력·북마크·새로고침(§2.1 진입). **완료 사실** 요청한 화면, 또는 복귀 주소를 남긴 로그인 화면.
- sessionStorage를 쓸 수 없는 브라우저(사생활 보호 창 등)면 복귀 주소 없이 `/admin/orders`로 돌아간다.

### JF-3 송장 등록 — OrderDetailPage.registerShipment

```jobflow
orchestrator: OrderDetailPage
Object: OrderDetailPage, ShipmentForm, OrderApi, OrderQueries

OrderDetailPage.registerShipment --> ShipmentForm.validate
ShipmentForm.validate.invalid
ShipmentForm.validate.result --> OrderApi.registerShipment
OrderApi.registerShipment.unprocessable
OrderApi.registerShipment.conflict --> OrderQueries.invalidate
OrderApi.registerShipment.result --> OrderQueries.invalidate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderDetailPage.registerShipment` | `C-15`·`R-21` | 상위 `AdminBrowser.registerShipment`. 운영자가 품목을 고르고 택배사·운송장을 넣어 「송장 등록」 |
| `ShipmentForm.validate` | `C-15` | 품목 1개 이상, 택배사 코드가 목록(`GET /api/admin/orders/carriers`)에 있음, 운송장 숫자 10~14자리(상위 §6.1). `.invalid`는 폼에 머문다 |
| `OrderApi.registerShipment` | `C-15`·`R-21` | 상위 `Order.registerShipment` — `POST /api/admin/orders/{orderId}/shipments`. 서버가 품목 `PAID`·`PREPARING` → `SHIPPING`과 배송 시작 알림 적재를 한다 |
| `.unprocessable` | `C-15` | 422 — 택배사 코드·운송장 오류(`details.fields`)를 폼 칸에 표시하고 끝난다 |
| `.conflict`·`.result` → `OrderQueries.invalidate` | `C-15` | 409 `INVALID_STATE`(취소됐거나 이미 출고) 또는 201 뒤 주문을 다시 읽는다. 409면 「주문 상태가 바뀌었습니다」 알림을 함께 띄운다 |

- `OrderQueries.invalidate`로 들어오는 두 화살표는 409·201 택일의 **합류**다 — 등록 한 번에 다시 읽기는 한 번이다.
- 한 주문을 송장 둘로 나눠 보낼 수 있다(상위 §5.11) — 화면은 아직 송장이 없는 `PAID`·`PREPARING` 품목만 고를 수 있게 한다. 발주 확인을 건너뛰고 `PAID`에서 바로 송장을 넣어도 된다.

### JF-4 클레임 처리 — ClaimDetailPage.completeClaim

```jobflow
orchestrator: ClaimDetailPage
Object: ClaimDetailPage, InspectionForm, ClaimApi, ClaimQueries, OrderApi

ClaimDetailPage.collect --> ClaimApi.collect
ClaimDetailPage.completeClaim --> InspectionForm.validate
InspectionForm.validate.result --> ClaimApi.complete
ClaimApi.complete.refundPending --> ClaimQueries.invalidate
ClaimApi.complete.result --> ClaimQueries.invalidate
ClaimDetailPage.reject --> ClaimApi.reject
ClaimDetailPage.registerReshipment --> OrderApi.registerShipment
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ClaimDetailPage.collect` → `ClaimApi.collect` | `C-16`·`R-21` | 회수 확인 — `POST /api/admin/claims/{claimId}/collect`. 상위 §5.12의 그림 밖 계약 |
| `ClaimDetailPage.completeClaim` | `C-16`·`R-21` | 상위 `AdminBrowser.completeClaim`. 검수 창에서 `inspection`·`faultParty`를 고른다 |
| `InspectionForm.validate` | `C-16` | 두 값이 모두 골라졌는지만 본다. 환불액은 화면이 계산하지 않고 서버 응답으로 보인다(품목 결제 안분액 − 반품 배송비) |
| `ClaimApi.complete` | `C-16`·`R-14` | 상위 `Claim.completeReturn` — `POST /api/admin/claims/{claimId}/complete`. 서버 안에서 PG 부분 취소를 기다리므로 시간 제한이 길다(§6) |
| `.refundPending` → `ClaimQueries.invalidate` | `C-16`·`R-14` | 502 — 클레임이 `REFUND_PENDING`으로 남았다. 다시 읽은 화면에 「환불 대기 — 다시 완료」가 보이고, 운영자가 다시 누르면 같은 계약을 부른다(서버 멱등 키 `claim:<claimId>`로 이중 환불 없음 — 상위 §6.3) |
| `.result` → `ClaimQueries.invalidate` | `C-16` | 200 — 반품은 `COMPLETED`, 교환은 `EXCHANGED`. 409(상태 바뀜)도 이 줄과 같이 다시 읽는다 |
| `ClaimDetailPage.reject` → `ClaimApi.reject` | `C-16` | 거절 창의 사유를 실어 `POST …/reject`. 상위 §5.12의 그림 밖 계약 |
| `ClaimDetailPage.registerReshipment` → `OrderApi.registerShipment` | `C-15`·`C-16` | 교환 완료 뒤 재발송 — `claimId`를 실은 송장 등록(상위 §5.11·§5.12). 화면 검사와 결과 처리는 `JF-3`과 같다 |

- `ClaimQueries.invalidate`로 들어오는 두 화살표는 200·502 택일의 **합류**다. `collect`·`reject`의 결과도 같은 다시 읽기를 하지만 그림에서 뺐다.
- **실패 분기** 502 밖의 오류(409 상태 바뀜, 연결 실패)는 `JF-1`의 공통 처리다. 시간 제한으로 끊긴 `complete`는 결과를 모른다 — 화면은 「처리 결과 확인 중」을 보이고 클레임을 다시 읽는다. 자동으로 다시 보내지 않는다.
- 회수 확인 → 검수 완료 순서는 서버 클레임 상태가 강제한다. 화면은 현재 상태에 맞는 버튼만 보인다.

### JF-5 운영자 로그인 — LoginPage.submit

```jobflow
orchestrator: LoginPage
Object: LoginPage, AuthApi, ReturnPath, AdminRouter

LoginPage.submit --> AuthApi.login
AuthApi.login.rejected
AuthApi.login.result --> ReturnPath.take
ReturnPath.take.result --> AdminRouter.navigate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `LoginPage.submit` | `C-02`·`R-21` | 상위 `AdminBrowser.login`. 화면 검사(빈 칸)는 `validate_form`(§2.1) |
| `AuthApi.login` | `C-02` | 상위 `Member.adminLogin` — `POST /api/admin/auth/login`. 성공하면 서버가 `ASID` 쿠키를 주고 CSRF 토큰을 바꾼다 |
| `.rejected` | `C-02`·`R-03` | 401 「아이디 또는 비밀번호가 맞지 않습니다」, 423 `LOCKED {until}` 「{until}까지 잠김」, 429 `RATE_LIMITED` 「잠시 뒤 다시」. 폼에 머문다 |
| `ReturnPath.take` → `AdminRouter.navigate` | `C-19` | 복귀 주소를 꺼내 지우고 그 화면으로, 없으면 `/admin/orders` |

- 재로그인 창(`JF-1`의 `ReLoginModal`)도 같은 `AuthApi.login`을 부르지만 `ReturnPath`·`AdminRouter`로 가지 않고 창만 닫는다.
- 로그아웃은 `AuthApi.logout`(`POST /api/admin/auth/logout`) 뒤 `/admin/login`이다. 실패해도 화면은 로그인 화면으로 간다.

### JF-6 상품 저장 — ProductFormPage.saveProduct

```jobflow
orchestrator: ProductFormPage
Object: ProductFormPage, ImageUploader, ProductForm, CatalogApi, AdminRouter

ProductFormPage.uploadImage --> ImageUploader.upload
ProductFormPage.saveProduct --> ProductForm.validate
ProductForm.validate.invalid
ProductForm.validate.result --> CatalogApi.saveProduct
CatalogApi.saveProduct.unprocessable
CatalogApi.saveProduct.versionConflict
CatalogApi.saveProduct.result --> AdminRouter.navigate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ProductFormPage.uploadImage` → `ImageUploader.upload` | `C-05`·`R-21` | 상위 `AdminBrowser.uploadImage`. 파일을 고르면 바로 올린다 — 안쪽은 `JF-6.1`. 결과 `objectKey`를 폼의 `imageKeys[]`에 넣는다 |
| `ProductFormPage.saveProduct` | `C-05`·`R-21` | 상위 `AdminBrowser.saveProduct`. 올리는 중인 이미지가 있으면 저장 버튼을 잠근다 |
| `ProductForm.validate` | `C-05` | 이름·카테고리 필수, 옵션 조합마다 SKU 1개, 가격 ≥ 0, 초기 재고 ≥ 0(상위 §6.1). `.invalid`는 칸에 표시 |
| `CatalogApi.saveProduct` | `C-05` | 상위 `Catalog.saveProduct` — 새 상품은 `POST`, 수정은 `PATCH`(읽을 때 받은 `version`을 함께 보낸다). `.unprocessable`(422 `VALIDATION_FAILED`)은 서버의 `details.fields[].field`를 칸에 표시 |
| `.versionConflict` | `C-05` | 409 `VERSION_CONFLICT` — 다른 운영자가 먼저 고쳤다. 「다른 사람이 수정했습니다 — 다시 불러오기」를 보이고, 입력값은 지우지 않는다 |
| `.result` → `AdminRouter.navigate` | `C-19` | 201/200 뒤 `/admin/products`로 간다 |

- 수정 화면에서 SKU의 재고는 바꾸지 않는다 — 재고는 `JF-7`의 조정 계약으로만 바꾼다(가예약과 경합하지 않게 한 catalog 규칙, 상위 §5.15).
- 같은 상품을 두 운영자가 동시에 고치면 catalog의 `version` 검사로 나중 쪽이 409를 받는다. 기존 SKU의 옵션은 바꿀 수 없고 새 SKU만 더한다(catalog `OPTION_IMMUTABLE`).

### JF-6.1 이미지 올리기 — ImageUploader.upload

```jobflow
orchestrator: ImageUploader
Object: ImageUploader, imageRules, CatalogApi, StorageClient

ImageUploader.upload --> imageRules.check
imageRules.check.rejected
imageRules.check.ok --> CatalogApi.issueUploadUrl
CatalogApi.issueUploadUrl.result --> StorageClient.put
StorageClient.put.failed
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `imageRules.check` | `C-05` | 형식(JPEG·PNG·WebP)·크기(장당 10MB — catalog `TOO_LARGE`와 같은 값)를 먼저 본다. 상품당 장수 상한은 catalog 상세가 원본이다. `.rejected`는 그 파일에 오류를 표시하고 끝난다 |
| `CatalogApi.issueUploadUrl` | `C-05` | 상위 `Catalog.issueUploadUrl` — 파일마다 `POST /api/admin/uploads/product-images {contentType, size}` → `{objectKey, uploadUrl, headers, expiresAt}`. 422 `UNSUPPORTED_TYPE`·`TOO_LARGE`는 `.rejected`와 같이 그 파일에 표시 |
| `StorageClient.put` | `C-05` | 상위 `Storage.putObject` — 서명 URL로 `PUT`(본문 = 파일, 머리글 = 발급 응답의 `headers`). 서버를 거치지 않는다. 시간 제한 60s |
| `.failed` | `C-05` | 연결 실패·403(서명 만료)·5xx — 그 이미지 칸에 「다시 올리기」를 보인다. 다시 올리면 URL을 새로 받는다(만료 10분 — 잠정) |

- **완료 사실** 파일마다 `objectKey` 하나. 키는 상품 저장(`JF-6`) 때 서버로 간다 — 저장하지 않고 떠나면 저장소에 주인 없는 객체가 남는다(§8 위험, 정리는 catalog 소관).
- 여러 파일은 동시에 최대 3개씩 올린다. `issueUploadUrl`·`put` 화살표 하나가 각각 파일 수만큼의 **실제 재호출**이다.

### JF-7 재고 조정 — StockAdjustPage.adjustStock

```jobflow
orchestrator: StockAdjustPage
Object: StockAdjustPage, CatalogApi, ProductQueries

StockAdjustPage.adjustStock --> CatalogApi.adjustStock
CatalogApi.adjustStock.belowReserved
CatalogApi.adjustStock.result --> ProductQueries.invalidate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `StockAdjustPage.adjustStock` | `C-06`·`R-21` | 상위 `AdminBrowser.adjustStock`. SKU 하나에 증감 `delta`(정수, 0 아님)와 사유(입고·실사·파손 등)를 넣는다 |
| `CatalogApi.adjustStock` | `C-06` | 상위 `Catalog.adjustStock` — `PATCH /api/admin/skus/{skuId}/stock {delta, reason}`. 절대값이 아니라 증감을 보내 같은 SKU의 가예약·확정과 겹쳐도 서버가 조건부로 더한다 |
| `.belowReserved` | `C-06`·`D-03` | 409 `BELOW_RESERVED` — 「가예약 n개보다 적게 줄일 수 없습니다」. 폼에 머문다 |
| `.result` → `ProductQueries.invalidate` | `C-06` | 200 뒤 SKU 수량을 다시 읽는다 |

- 증감 계약이라 같은 조정을 두 번 보내면 두 번 반영된다. 화면은 버튼 잠금으로만 막는다 — 서버 멱등 키를 둘지는 catalog 상세의 판단이다(§8).

### JF-8 프로모션 저장 — CouponFormPage.saveCoupon, ExhibitionFormPage.saveExhibition

```jobflow
scope: 프로모션 폼 저장 — 쿠폰·기획전 화면
Object: CouponFormPage, ExhibitionFormPage, couponRules, PromotionApi, CatalogApi

CouponFormPage.saveCoupon --> couponRules.validate
couponRules.validate.ok --> PromotionApi.saveCoupon
ExhibitionFormPage.pickProducts --> CatalogApi.listProducts
ExhibitionFormPage.saveExhibition --> PromotionApi.saveExhibition
```

`scope:`를 쓴 이유: 두 화면은 서로 모르는 별개의 조율자다. 같은 promotion 계약을 쓰는 비슷한 모양이라 한 그림에 두었다.

| 노드 | 근거 | 비고 |
|---|---|---|
| `CouponFormPage.saveCoupon` | `C-07`·`R-21` | 상위 `AdminBrowser.saveCoupon` |
| `couponRules.validate` | `C-07` | 정률 1~90%, 정액 > 0, 최대 할인 ≥ 0, 기간 시작 < 끝 또는 받은 뒤 n일, 발급 수량 ≥ 1(상위 §6.1). 통과 못 하면 칸에 표시하고 끝난다(그림에서 뺐다) |
| `PromotionApi.saveCoupon` | `C-07` | 상위 `Promotion.saveCoupon` — 새 쿠폰은 `POST /api/admin/coupons`, 기존 쿠폰은 `PATCH /api/admin/coupons/{couponId}`(이름·발급 수량·받기 마감·발급 중지) → `/admin/coupons`. 422는 칸에 표시, 409 `COUPON_TERMS_LOCKED`·`BELOW_ISSUED`는 폼 위 알림 |
| `ExhibitionFormPage.pickProducts` → `CatalogApi.listProducts` | `C-05`·`C-07` | 상품 고르기 창 — `GET /api/admin/products?status=ON_SALE&q=`. 고른 상품의 ID만 폼에 둔다(promotion은 catalog를 부르지 않는다 — 상위 `D-02`) |
| `ExhibitionFormPage.saveExhibition` → `PromotionApi.saveExhibition` | `C-07` | 상위 `Promotion.saveExhibition` — 새 기획전은 `POST`, 수정은 `PATCH /api/admin/exhibitions/{exhibitionId}`. 배너는 `bannerImageKey` — 어느 업로드 계약으로 키를 받는지는 promotion 상세에 없다(잠정 `JF-6.1`의 상품 이미지 경로, §8) |

- 기획전의 쿠폰 칸은 `GET /api/admin/coupons?status=ACTIVE`로 고른다(그림에서 뺐다).

### JF-9 발주 확인과 확인 처리 — OrderDetailPage.prepareLines

```jobflow
orchestrator: OrderDetailPage
Object: OrderDetailPage, ResolveModal, OrderApi, OrderQueries

OrderDetailPage.prepareLines --> OrderApi.prepareLines
OrderApi.prepareLines.settled --> OrderQueries.invalidate
OrderDetailPage.resolveReview --> ResolveModal.open
ResolveModal.open.cancelled
ResolveModal.open.confirmed --> OrderApi.resolveReview
OrderApi.resolveReview.unprocessable
OrderApi.resolveReview.settled --> OrderQueries.invalidate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderDetailPage.prepareLines` | `C-15`·`R-21` | 「발주 확인」 — 운영자가 `PAID` 품목을 골라 상품 준비를 시작한다. 송장이 있거나 `PAID`가 아닌 품목은 고를 수 없다 |
| `OrderApi.prepareLines` | `C-15` | `POST /api/admin/orders/{orderId}/prepare {lineIds[]}` → 200(품목 `PAID → PREPARING`, 조건부 전이). 그 뒤 고객 취소는 409 `NOT_CANCELLABLE`이 된다(잠정 — order 상세) |
| `.settled` → `OrderQueries.invalidate` | `C-15` | 200, 또는 409 `INVALID_STATE {lineId, status}`(그 사이 고객이 취소했거나 다른 운영자가 처리함) — 어느 쪽이든 주문을 다시 읽는다. 409면 「주문 상태가 바뀌었습니다」 알림을 함께 띄운다 |
| `OrderDetailPage.resolveReview` → `ResolveModal.open` | `C-10`·`C-11`·`R-18` | 「확인 처리」 — 주문이 `MANUAL_REVIEW`일 때만 버튼이 보인다. 창은 고착 사유(대사 횟수 초과·PG 거절·입금 뒤 폐기·금액 불일치 — 상태 이력의 마지막 사유)와 PG 콘솔에서 확인할 항목을 보인다. `.cancelled`는 무시 분기 — 창만 닫는다 |
| `.confirmed` → `OrderApi.resolveReview` | `C-10`·`C-11` | `POST /api/admin/orders/{orderId}/resolve {action, note}` — `action` = `CONFIRM_PAID`(PG에서 결제가 확인됨 → 서버가 결제 확정) 또는 `RELEASE`(PG에서 환불·폐기를 확인함 → 서버가 해제), `note`는 운영자가 확인한 사실(필수). 자동 재전송 없음 |
| `.unprocessable` | `C-10`·`C-11`·`D-03` | 오류로 끝나는 분기 — 창에 머물고 오류 코드마다 다른 문구를 보인다. 422 `VALIDATION_FAILED` → 메모 칸에 「확인한 사실을 메모로 남겨 주세요」. 409 `NOT_SETTLEABLE`(가예약이 없어 결제 확정 불가) → 「재고 가예약이 없어 결제 확정을 할 수 없습니다. PG 콘솔에서 환불한 뒤 「해제」를 고르세요」. 409 `NOT_RELEASABLE`(이미 출고됨) → 「출고된 주문은 해제할 수 없습니다. 반품 절차로 처리하세요」. 503 `RETRY_LATER` → 「잠시 뒤 다시 시도해 주세요」(자동 재전송 없음 — 운영자가 다시 누른다) |
| `.settled` → `OrderQueries.invalidate` | `C-10` | 200, 또는 409 `INVALID_STATE`(이미 다른 운영자가 닫아 `MANUAL_REVIEW`가 아님) — 창을 닫고 주문을 다시 읽는다. `INVALID_STATE`면 「이미 처리된 주문입니다」 알림을 함께 띄운다. 다른 409 코드는 이 갈래가 아니다(위 `.unprocessable`) |

- **트리거** 둘 — 「발주 확인」, 「확인 처리」. **완료 사실** 다시 읽은 주문 상세(`PREPARING` 품목, 또는 `MANUAL_REVIEW`를 벗어난 주문).
- `OrderQueries.invalidate`로 들어오는 화살표 둘은 서로 다른 동작의 **합류**다 — 동작 한 번에 다시 읽기는 한 번이다.
- 「확인 처리」는 돈이 걸린 판단을 사람에게 맡기는 탈출구다. 화면은 판단을 돕지 않는다(PG 콘솔 조회는 운영자 몫) — 화면이 하는 일은 사유를 보이고, 고른 결론과 메모를 서버에 넘기는 것뿐이다. 누가 처리했는지는 서버가 상태 이력에 남긴다(order 상세).

## 4. 소유 상태·데이터

권위 데이터는 없다 — 모든 업무 데이터의 원본은 서버 모듈이다. 브라우저에 잠시 두는 것은 아래뿐이다.

| 데이터 | 경로 | 쓰기 주체 | 생명주기·보존 | 원자성 |
|---|---|---|---|---|
| 복귀 주소 | sessionStorage `admin.returnPath` | `ReturnPath.save` | 로그인 성공 때 꺼내며 지운다. 탭을 닫으면 사라진다 | 해당 없음 — 값 하나 |
| 운영자 요약(이름·역할) | 메모리 | `SessionGuard.check`, 로그인 성공 처리 | 새로고침하면 다시 읽는다 | 해당 없음 |
| 서버 응답 캐시 | 메모리(잠정 TanStack Query) | `*Queries` | 저장·조정 성공 때 무효화. 표시용이며 원본이 아니다 | 해당 없음 |
| 폼 입력값 | 메모리(화면 상태) | 각 `*Page` | 화면을 떠나면 사라진다. 재로그인 창 동안은 남는다 | 해당 없음 |

세션 쿠키 `ASID`와 CSRF 쿠키 `XSRF-TOKEN`은 mall-api가 쓰고, 이 SPA는 `XSRF-TOKEN`을 읽기만 한다(`ASID`는 httpOnly라 읽을 수 없다).

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| member | `POST /api/admin/auth/login`, `GET /api/admin/auth/me`, `POST /api/admin/auth/logout` | 같은 오리진 상대 경로 `/api/admin/auth/*` | 15s | 로그인 응답의 `ASID` 쿠키와 CSRF 토큰 교체에 기댄다 |
| order | `GET /api/admin/orders*`, `GET /api/admin/orders/carriers`, `POST /api/admin/orders/{orderId}/shipments`·`/prepare`·`/resolve` | 같음 | 15s | 품목 상태 값(`PAID`·`PREPARING`·`SHIPPING`·…)·주문 상태 값(`MANUAL_REVIEW` 포함)과 클레임 표시를 화면 문구로 바꾼다 — 값이 늘면 화면을 고친다 |
| claim | `GET /api/admin/claims*`, `POST …/collect`·`…/complete`·`…/reject` | 같음 | 15s, `complete`만 45s | 클레임 상태 값과 `REFUND_PENDING`의 뜻 |
| catalog | `/api/admin/products*`(목록 필터 `status`·`stock=OUT`), `/api/admin/categories*`, `/api/admin/skus/{skuId}/stock`, `/api/admin/uploads/product-images` | 같음 | 15s | SKU 가용 수량 = 실재고 − 가예약이라는 표시 규칙, 상품 상태 값(`DRAFT`·`ON_SALE`·`STOPPED`) |
| promotion | `/api/admin/exhibitions*`(단건 `GET …/{exhibitionId}`, 목록 필터 `status`·`period`), `/api/admin/coupons*`(단건 `GET …/{couponId}`) | 같음 | 15s | 쿠폰 할인 유형 값(`AMOUNT`·`RATE`), 기획전 상태 값(`DRAFT`·`PUBLISHED`·`HIDDEN`) |
| 객체 저장소 | 서명 URL `PUT` | URL은 catalog가 발급 — 이 SPA에 저장소 주소·키 설정이 없다 | 60s | 저장소의 CORS가 `PUT`과 `Content-Type`을 허용해야 한다(가정 — 운영 설정) |
| mall-api 조립 지점 | 정적 파일 제공(`/admin`·히스토리 폴백), 오류 형식, CSRF 쿠키 | 빌드 산출물(`dist/`)을 mall-api가 `/admin`에서 내려준다 | — | [mall-api 상세 §2](mall-api.md#2-공개-계약) |

모든 서버 호출은 같은 오리진이라 CORS가 없다. 화면 번들은 빌드 때 기본 경로를 `/admin/`으로 둔다(Vite `base`).

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 서버 요청 시간 제한 | 15s | `ADMIN_HTTP_TIMEOUT_MS`(빌드 상수) | `HttpTransport.send` |
| 검수 완료 시간 제한 | 45s — 서버의 PG 취소 대기(잠정 30s, payment 상세가 원본)보다 길게 | `ADMIN_CLAIM_COMPLETE_TIMEOUT_MS`(빌드 상수) | `ClaimApi.complete` |
| 이미지 업로드 시간 제한·동시 수 | 60s, 동시 3 | `ADMIN_UPLOAD_TIMEOUT_MS`·`ADMIN_UPLOAD_CONCURRENCY`(빌드 상수) | `StorageClient.put`, `ImageUploader` |
| 401 뒤 다시 보내기 | 재로그인 성공 뒤 1회 | — | `adminHttp.request` |
| 그 밖 자동 재시도 | 없음 | — | — |

- **인증** 화면은 권한을 판정하지 않는다. 모든 `/api/admin/*`는 mall-api가 운영자 세션만 받는다(403·401). 화면의 메뉴·버튼 숨김은 편의다.
- **동시성** 두 운영자가 같은 주문·클레임을 동시에 처리하면 서버 조건부 전이가 하나만 통과시키고 다른 쪽은 409를 받는다 — 화면은 다시 읽어 실제 상태를 보인다(`JF-3`·`JF-4`). 상품 수정은 catalog `version`이 나중 쪽을 409로 돌려보낸다(`JF-6`). 카테고리·기획전 수정은 나중 저장이 이긴다(§8).
- **결과 불명** 시간 제한으로 끊긴 상태 변경 요청은 성공·실패를 모른다. 화면은 자동으로 다시 보내지 않고 대상을 다시 읽는다. 검수 완료를 다시 눌러도 서버 멱등 키가 이중 환불을 막는다(상위 §6.3).
- **최후 방어** 다시 읽기까지 실패하면 「서버에 연결할 수 없습니다 — 새로고침」 띠를 보인다.

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 공통 요청기 | `JF-1` — CSRF 헤더, 401 재로그인·1회 재전송, 동시 401, 403·5xx 변환 | 컴포넌트 시험(잠정 Vitest + Testing Library + MSW 가짜 서버): `POST`에 `X-CSRF-Token` = 쿠키 값, `GET`에는 없음 / 401 → 창 1개 → 로그인 → 같은 요청 1회, 두 번째 401은 오류 / 요청 3개 동시 401 → 창 1개·재전송 3회 / 로그인 뒤 헤더가 새 쿠키 값 | admin-web 작업(상위 §9.1 순서 4) |
| 진입 가드·복귀 주소 | `JF-2`·`JF-5`, §2.1 진입 | 세션 없이 `/admin/claims/c1` → `/admin/login` → 로그인 → `/admin/claims/c1`. 복귀 주소 `https://evil.example` → 무시하고 `/admin/orders` | 같음 |
| 송장·클레임 화면 | `JF-3`·`JF-4` | 가짜 서버가 409·422·502를 준다 → 409는 다시 읽기 + 알림, 422 `details.fields`는 칸 표시, 502는 「환불 대기 — 다시 완료」 버튼. 버튼 연타 → 요청 1회. `PREPARING` 품목도 송장 대상으로 고를 수 있음 | 같음 |
| 발주 확인·확인 처리 | `JF-9` | 「발주 확인」 → 200 → 품목 「상품 준비중」, 409 → 알림·다시 읽기. `MANUAL_REVIEW` 아닌 주문에는 「확인 처리」 버튼 없음. 메모 없이 제출 → 422 칸 표시·창 유지, `CONFIRM_PAID` 200 → 창 닫힘·다시 읽기, 409 `INVALID_STATE` → 알림·창 닫힘·다시 읽기, 409 `NOT_SETTLEABLE`·`NOT_RELEASABLE`·503 `RETRY_LATER` → 코드별 안내 문구·창 유지. 목록 「확인 필요」 탭 → `status=MANUAL_REVIEW` 요청 | 같음 |
| 목록 필터 | §2 `AdminProductList`·`AdminExhibitionList` | 상품 `status=DRAFT`·`stock=OUT`, 기획전 `status=HIDDEN`·`period=UPCOMING`이 쿼리로 나가고 주소에 남는다(새로고침해도 유지) | 같음 |
| 이미지 업로드 | `JF-6.1` | 형식·크기 초과 거절, 서명 URL 403(만료) → 「다시 올리기」 → 새 URL, 올리는 중 저장 버튼 잠금 | 같음 |
| 끝단 — 실제 mall-api | §5.11·§5.12·§5.15, `R-21` | 시험 DB와 가짜 PG로 mall-api를 띄우고 브라우저 시험(잠정 Playwright): 운영자 로그인 → 상품 등록(이미지 포함) → 재고 조정 → 고객 주문 결제 → 송장 등록 → 반품 신청 → 회수 확인 → 검수 완료 | 상위 §9.1 순서 5 뒤 |
| 세션 분리 | §2.3 `ASID`·`SID` | 같은 브라우저에서 고객 로그인 → 운영자 로그인 → 고객 화면이 여전히 로그인 상태, 운영자 로그아웃이 고객 세션을 지우지 않음 | 끝단 시험과 함께 |
| 권한 | `R-21` 「운영자 계정만 `/api/admin/*`」 | 고객 세션만 가진 브라우저로 `/admin/orders` → 로그인 화면, 운영자 API 직접 호출 → 401 | 끝단 시험과 함께 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `D-05`·`C-02` | 위험 | 같은 오리진에서 고객·운영자 세션이 한 쿠키 이름을 쓰면 서로 덮는다 | 상위 `D-05` — 세션 쿠키 하나·같은 오리진(`D-01`) | `ASID`(`Path=/api/admin`)로 나눴다(§2.3). member·mall-api 상세가 같은 이름을 쓴다 |
| `C-02`·`R-21` | 미확정 | 운영자 역할 세분화(상품·주문·고객 응대) | `R-21`은 「운영자 계정」만 정한다. member·mall-api 상세도 잠정 `ADMIN` 하나다 | 역할을 나누면 mall-api 경로별 권한 규칙에 역할별 허용 경로를 정하고, 화면은 메뉴 숨김만 더한다 |
| `C-02` | 미확정 | 운영자 계정 생성·비밀번호 변경 화면 | `R-21`에 없다 | 잠정 DB·운영 스크립트로 만든다. 화면이 필요하면 member 계약과 이 SPA에 화면 하나가 는다 |
| `C-07` | 미확정 | 기획전 배너 이미지의 업로드 계약 — `bannerImageKey`를 어느 서명 URL 계약으로 받는지 promotion 상세 §2에 없다 | `JF-8` | 잠정 `JF-6.1`의 상품 이미지 경로를 쓴다. promotion이 자기 업로드 계약을 두면 `ExhibitionFormPage`의 업로드 대상만 바꾼다 |
| `C-05` | 위험 | 올리고 저장하지 않은 이미지가 저장소에 남는다 | `JF-6.1` | 화면은 지우지 않는다. 정리(수명 규칙·주기 삭제)는 catalog 상세가 정한다 |
| `C-05`·`C-07` | 위험 | 카테고리·기획전 동시 수정은 나중 저장이 이긴다(상품은 catalog `version`으로 막힌다) | §6 | 운영자 수가 적은 교육용 규모라 잠정 허용. 필요하면 상품처럼 `version` 열을 두고 화면은 409를 다시 읽기로 처리한다 |
| `C-06` | 위험 | 재고 조정은 증감 계약이라 결과 불명 뒤 다시 보내면 두 번 반영된다 | `JF-7` | 화면은 자동 재전송을 하지 않는다. 서버 멱등 키 도입은 catalog 상세의 판단 |
| `R-21` | 미확정 | 운영자 작업 이력(누가 송장·환불·거절을 했는지) | §1 「아무도 하지 않는 것」 | 클레임 상태 이력·주문 상태 이력에 운영자 ID를 남길지는 claim·order 상세가 정한다. 화면은 상세 화면의 이력 표에 보이기만 한다 |
| `C-15` | 위험 | 택배사 코드 목록이 바뀌면 열려 있던 송장 입력 폼의 목록이 낡는다 | order 상세 §2 `GET /api/admin/orders/carriers` — 설정 `order.carriers`가 원본 | 화면은 목록을 박아 두지 않고 폼을 열 때 받는다. 낡은 코드로 보내면 order가 422 `VALIDATION_FAILED`로 거절한다(§2.2) |
| `C-10`·`R-18` | 미확정 | 「확인 처리」의 판단 근거 — 화면은 PG 콘솔을 보여 주지 않아 운영자가 다른 창에서 확인해야 한다. 잘못 고르면(입금됐는데 `RELEASE`) 돈과 주문이 어긋난다 | `JF-9` | 창에 확인 항목(PG 거래 상태·금액·입금 여부)을 안내하고 메모를 필수로 받는다. 서버 쪽 방어(결론과 PG 사실 대조)는 order 상세의 판단 |

## 9. 미확인·한계

1. 코드·실행 환경이 없다 — 화면·심볼·시간 제한은 설계값이고 실행하지 않았다.
2. 운영자가 쓰는 브라우저 범위(최신 Chrome·Edge 가정)와 화면 폭(데스크톱 전용 가정)을 확인하지 않았다.
3. 객체 저장소의 서명 URL 형식·CORS 설정은 S3 호환 저장소를 가정했다.
4. §2.2의 계약은 member·order·claim·catalog·promotion 상세 §2와 경로·본문 필드·오류 코드를 대조해 맞췄다. 그 상세들이 같은 시기에 고쳐지고 있어 필드 이름이 바뀌면 §2.2를 다시 맞춘다. 택배사 목록 `GET /api/admin/orders/carriers`는 order 상세 §2의 계약이다.
