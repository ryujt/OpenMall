# order (모듈) — TO-BE 상세

> **대상**: 주문 수명 조율 — 주문서 견적·주문 생성(`C-09`), 결제 승인·대사·망취소(`C-10`), 가상계좌 발급·입금 웹훅·입금 확인·입금기한 만료(`C-11`), 주문 조회·비회원 조회 토큰(`C-13`), 주문 취소(`C-14`), 상품 준비·송장·배송 추적·구매확정(`C-15`), 주문 기록 보존·파기(`C-20`) · **기준**: 설계 기준 DATE 2026-10-19·커밋 `6ace327`
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 이 문서의 계약·클래스·메서드·테이블·설정 키는 모두 새 제안이다 — `(제안)` 표시는 생략한다. 외부 업체 동작은 「가정」, 확인하지 못한 것은 「미확인」이다. 심볼은 상위 §9.5의 잠정 스택(Java 21 + Spring Boot 3)을 전제로 한 이름이고, 스택이 바뀌어도 경계와 계약은 그대로다

## 1. 책임 / 비책임

- **책임**: 주문 하나의 수명을 처음부터 끝까지 조율한다(`D-02`). 견적과 금액 재계산, 주문·품목 저장과 주문번호 발급, 가예약·쿠폰 점유를 묶은 주문 생성(`C-09`). 승인 시작의 조건부 전이와 PG 승인 결과 처리, 확정 불가일 때의 망취소(`NET_CANCELLING`), 결과 불명 주문의 대사(`C-10`). 가상계좌 발급과 재발급 키, 입금 웹훅의 멱등 반영, 입금 대기 주문의 주기 조회, 입금기한 만료(`C-11`). 소유 검사와 비회원 조회 토큰(`C-13`). 결제 전·입금 대기·결제 완료 주문의 취소, 환불 계좌 받기, `CANCELLING` 회수(`C-14`). 대사·만료가 결론을 내지 못한 주문을 `MANUAL_REVIEW`로 빼고 운영자의 확인 처리를 받는 일(`C-10`·`C-11`·`C-14`). 상품 준비, 송장 등록, 배송 조회, 배송 완료 반영, 자동·수동 구매확정(`C-15`). 품목 클레임 표시와 교환 재발송 SKU 저장, 클레임·리뷰·탈퇴용 조회(`C-15`·`C-16`·`C-17`·`C-04`). 주문 기록의 보존 기한과 비회원 개인정보 파기(`C-20`). 주문·품목 상태의 유일한 쓰기 주체다.
- **비책임**: PG 통신·결제 기록·웹훅 서명 검증과 통보 분류(payment), 재고 수량과 가예약 행(catalog), 쿠폰 할인액 계산과 회원 쿠폰 상태(promotion — order는 받은 할인액을 합산만 한다), 장바구니 행(cart), 알림 발송과 재시도(notification), 클레임 상태·환불액 계산·부분 환불(claim), 리뷰(review), 세션 확인과 CSRF·트랜잭션 관리자·스케줄러 단일 실행(mall-api), 회원 개인정보 파기(member).
- **아무도 하지 않는 것**: 출고 전 부분 취소(상위 §9.5 — 전체 취소만), 환불 계좌의 실명 확인(상위 §9.5 — 받은 계좌를 그대로 payment에 넘긴다), 마감 뒤 입금의 자동 환불(`MANUAL_REVIEW`로 빼고 운영자가 PG 콘솔에서 환불한 뒤 확인 처리를 누른다), 상품 준비가 시작된 주문의 고객 취소(잠정 — 고객센터 문의 또는 배송 뒤 반품), 택배 조회가 끝내 배송 완료를 주지 않는 송장의 수동 배송 완료 처리, 운영자 화면의 주문 취소, 주문 비밀번호 재설정, 현금영수증 발급 결과 관리(신청 값만 PG에 넘긴다).

## 2. 공개 계약

계약 26개 — HTTP 라우트 17(고객 10·PG 웹훅 1·운영 6), 서비스 메서드 6(공개 인터페이스 `OrderApi` 5·공용 인터페이스 `RetentionTask` 구현 1), 타이머 3(`OrderJobs`). 라우트는 `OrderController`·`PaymentRouteController`·`PgWebhookController`·`AdminOrderController`에 둔다. 다른 모듈은 `OrderApi`만 참조하고(`C-21` 경계 검사), mall-api 스케줄러는 `OrderJobs`와 `RetentionTask`만 부른다. 오류 본문은 mall-api 공통 형식 `{code, message, details}`이고, 입력 검사 실패는 422 `VALIDATION_FAILED`(`details.fields[{field, reason}]`)다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `POST /api/orders/preview` | `{lines[{skuId, quantity, cartItemId?}], couponIds[], zipcode?}` — 회원 세션 또는 익명(비회원 구매) | 200 `{itemsAmount, discountAmount, shippingFee, payAmount, shippingFeeEstimated, lines[{skuId, unitPrice, quantity, discount}], coupons[{couponId, discount, unavailableReason?}]}` — 저장하지 않는다 | 409 `SOLD_OUT {skuIds}`, 422 `VALIDATION_FAILED`(비회원의 `couponIds` 포함) | `OrderController.preview` → `CheckoutService.previewCheckout` — `C-09` |
| `POST /api/orders` | `{lines[{skuId, quantity, cartItemId?}], couponIds, shippingAddress{recipient, phone, zipcode, address1, address2, memo?}, orderer{name, phone, email?}, paymentMethod:'CARD'·'EASY_PAY'·'VIRTUAL_ACCOUNT', expectedAmount, guest?{password(6~20자), privacyAgreedAt}}`, 비회원이면 쿠키 `cartKey`와 (있으면) `GOT`도 읽는다 | 201 `{orderId, orderNo, amount, orderName}`. 비회원이면 `Set-Cookie: GOT`(조회 토큰 30분 — 유효한 `GOT`가 왔으면 그 토큰에 이 주문을 더하고 수명을 갱신한다) | 409 `OUT_OF_STOCK {skuIds}`·`PRICE_CHANGED {amount}`·`COUPON_UNAVAILABLE {couponIds}`, 422 `VALIDATION_FAILED`·`GUEST_CONSENT_REQUIRED`·`GUEST_INFO_REQUIRED`(미로그인인데 `guest` 없음) | `OrderController.place` → `CheckoutService.placeOrder` — `C-09`·`D-03`·`D-07` |
| `POST /api/payments/{paymentKey}/approve` | path `paymentKey`, `{orderId, amount}` — 주문 소유자(회원 세션 또는 조회 토큰) | 200 `{orderId, status:'PAID'}`, 202 `{orderId, status}` — `status` = `APPROVING`(결과 불명·확정 일시 오류)·`NET_CANCELLING`(망취소 결과 불명)·`MANUAL_REVIEW`(망취소 거절) | 400 `AMOUNT_MISMATCH`, 402 `PAYMENT_DECLINED {pgCode, message}`, 403 `NOT_OWNER`, 404, 409 `INVALID_STATE {status}`, 500 `ORDER_COMMIT_FAILED`(망취소 성공) | `PaymentRouteController.approve` → `CheckoutService.approvePayment` — `C-10`·`D-04` |
| `POST /api/payments/virtual-accounts` | `{orderId, bankCode, depositorName, cashReceipt?{type, number}}` — 주문 소유자 | 201 `{bank, accountNumber, amount, dueAt}` | 403 `NOT_OWNER`, 404, 409 `INVALID_STATE {status}`, 422 `VALIDATION_FAILED`, 502 `PG_ERROR` | `PaymentRouteController.issueVirtualAccount` → `CheckoutService.issueVirtualAccount` — `C-11` |
| `POST /api/webhooks/pg` | PG가 보낸 헤더(서명)·본문 — 세션·CSRF 없음 | 200(반영했거나, 이미 반영했거나, 반영하지 않기로 함) | 400 `INVALID_SIGNATURE`(`verifyNotice`가 `rejected`), 503 `RETRY_LATER`(`verifyNotice`가 `unavailable` — PG 조회·기록 실패, 또는 폐기 요청 중 입금 — 둘 다 PG 재전송을 기다린다) | `PgWebhookController.receive` → `PgWebhookService.handlePgWebhook` — `C-11` |
| `POST /api/orders/{orderId}/cancel` | `{reason, refundAccount?{bankCode, accountNumber, holderName}}` — 주문 소유자. `refundAccount`는 가상계좌로 결제를 마친(`PAID`) 주문만 필수 | 200 `{status:'CANCELLED', refund?{amount}}`, 202 `{status:'CANCELLING'}`(PG 취소 결과 불명·같은 결제의 다른 취소 진행 중) | 403 `NOT_OWNER`, 404, 409 `NOT_CANCELLABLE {status}`(상품 준비·출고 시작, 결제 확인 중 등)·`ALREADY_DEPOSITED`(입금 대기 주문인데 이미 입금됨 — 결제 완료로 반영한 뒤 다시 취소한다), 422 `REFUND_ACCOUNT_REQUIRED`(`CANCELLING` 전에 판정)·`VALIDATION_FAILED`, 502 `REFUND_FAILED {code}`(PG 거절 — 주문은 `MANUAL_REVIEW`) | `OrderController.cancel` → `CancelService.cancelOrder` — `C-14` |
| `GET /api/orders` | query `period`(1m·3m·6m·1y), `page` — 회원만 | 200 `{items[{orderId, orderNo, orderedAt, status, amount, firstProductName, lineCount, lineStatuses}], page}` | 401 | `OrderController.list` → `OrderQueryService.listMyOrders` — `C-13` |
| `GET /api/orders/{orderId}` | path — 주문 소유자 | 200 상세 `{order, lines[{status, claimMark, exchangeSkuId?, …}], payment{method, vbank?}, shippingAddress, shipments[]}` | 403 `NOT_OWNER`, 404 | `OrderController.detail` → `OrderQueryService.getOrder` — `C-13` |
| `POST /api/guest/orders/lookup` | `{orderNo, password}` — 익명, (있으면) 쿠키 `GOT` | 200 `{orderId}` + `Set-Cookie: GOT`(30분 — 유효한 `GOT`가 왔으면 그 토큰에 더한다) | 404 `NOT_FOUND`(번호·비밀번호 어느 쪽이 틀렸는지 알리지 않는다), 429 `LOCKED {until}` | `OrderController.lookupGuest` → `OrderQueryService.lookupGuestOrder` — `C-13`·`D-07` |
| `GET /api/orders/{orderId}/tracking` | path — 주문 소유자 | 200 `{shipments[{shipmentId, carrierCode, trackingNumber, status, events[{at, location, description}]}]}` — 조회 실패한 송장은 `{trackingNumber, status:'UNAVAILABLE'}` | 403 `NOT_OWNER`, 404 | `OrderController.tracking` → `ShipmentService.getTracking` — `C-15` |
| `POST /api/orders/{orderId}/lines/{lineId}/confirm` | path — 주문 소유자 | 200 `{lineId, status:'CONFIRMED', confirmedAt}` | 403 `NOT_OWNER`, 404, 409 `NOT_CONFIRMABLE {status, claimMark}` | `OrderController.confirmLine` → `ShipmentService.confirmLine` — `C-15` |
| `GET /api/admin/orders` | query `status`, `from`, `to`, `q`(주문번호·주문자 이름·휴대폰 뒤 4자리), `page` — 운영자 | 200 목록(`MANUAL_REVIEW` 필터 포함) | 403(미들웨어) | `AdminOrderController.search` → `OrderQueryService.searchAdmin` — `C-15` |
| `GET /api/admin/orders/carriers` | 없음 — 운영자 | 200 `{carriers[{code, name}]}` — 설정 `order.carriers`의 택배사 목록(송장 등록 화면의 선택지) | 403(미들웨어) | `AdminOrderController.carriers` → `ShipmentService.listCarriers` — `C-15`·`R-21` |
| `GET /api/admin/orders/{orderId}` | path — 운영자 | 200 상세 + 상태 이력(경보 포함) + 송장 + 운영 확인 사유(`reviewReason`·`reviewFromStatus`) | 403, 404 | `AdminOrderController.detail` → `OrderQueryService.getAdminOrder` — `C-15` |
| `POST /api/admin/orders/{orderId}/prepare` | `{lineIds[]}` — 운영자(발주 확인) | 200 `{lineIds, status:'PREPARING'}` | 404, 409 `INVALID_STATE {lineId, status}`, 422 `VALIDATION_FAILED` | `AdminOrderController.prepare` → `ShipmentService.prepareLines` — `C-15` |
| `POST /api/admin/orders/{orderId}/shipments` | `{lineIds[], carrierCode, trackingNumber, claimId?}` — 운영자 | 201 `{shipmentId}` | 404, 409 `INVALID_STATE {lineId, status}`·`DUPLICATE_TRACKING`, 422 `VALIDATION_FAILED`(`carrierCode`·`trackingNumber`) | `AdminOrderController.registerShipment` → `ShipmentService.registerShipment` — `C-15`·`R-21` |
| `POST /api/admin/orders/{orderId}/resolve` | `{action:'CONFIRM_PAID'·'RELEASE', note(1~500자)}` — 운영자(PG 콘솔에서 사실을 확인한 뒤) | 200 `{orderId, status}` | 404, 409 `INVALID_STATE {status}`(`MANUAL_REVIEW`가 아니거나 그 사유에 받지 않는 `action`)·`NOT_SETTLEABLE`(가예약이 없어 확정 불가 — 환불 뒤 `RELEASE`)·`NOT_RELEASABLE`(`RELEASE`인데 품목이 `PREPARING` 이후 — 클레임 절차로), 422 `VALIDATION_FAILED`, 503 `RETRY_LATER`(확정 일시 오류) | `AdminOrderController.resolve` → `ManualReviewService.resolve` — `C-10`·`C-11`·`C-14` |
| 서비스 `getClaimableLines(orderId, requester)` | 주문 ID, 요청 주체(`Principal` — 회원 ID 또는 조회 토큰의 `guestOrderIds`) | `claimable {orderId, paymentRef{orderId, orderNo}, paymentMethod, orderer{name, phone}, itemsAmount, discountAmount, shippingFee, freeShippingApplied, freeShippingThreshold(주문 때 쓴 무료배송 기준 금액), lines[{lineId, skuId, status, claimMark, claimId, deliveredAt, allocatedAmount, claimable, why?}]}`·`notOwner`·`notFound` | — | `OrderApi` → `ClaimSupport.getClaimableLines` — `C-15`·`C-16`·`R-25` |
| 서비스 `markLineClaim(lineIds, claimId, mark, exchangeSkuIds?)` | `mark` = `RETURN_REQUESTED`·`EXCHANGE_REQUESTED`·`RETURNED`·`EXCHANGED`·`CLAIM_REJECTED`·`NONE`(클레임 철회). `exchangeSkuIds`는 `EXCHANGED`일 때 필수 — `lineIds`와 같은 순서·같은 길이의 재발송 SKU | `marked`·`conflict {lineId, why}` — 호출자 트랜잭션에 참여한다 | `EXCHANGED`인데 `exchangeSkuIds`가 없거나 길이가 다르면 `IllegalArgumentException`(호출자 버그) | `OrderApi` → `ClaimSupport.markLineClaim` — `C-16` |
| 서비스 `getConfirmedLine(orderLineId, memberId)` | 품목 ID, 회원 ID | `confirmed {orderId, productId, skuId, productName, optionName, confirmedAt}`·`notConfirmed`·`notOwner`(없는 품목 포함) | — | `OrderApi` → `ClaimSupport.getConfirmedLine` — `C-17` |
| 서비스 `resolveGuestToken(token)` | 쿠키 `GOT` 원문 값 | `guest {orderIds[]}`(최대 5)·`invalid`(없음·만료·형식 오류) | 예외 없음 | `OrderApi` → `GuestAccess.resolve` — mall-api 인증 단계가 세션 없이 `GOT`가 온 요청마다 부른다([mall-api 상세 `JF-1.1`](mall-api.md#jf-11-주체-결정--sessionauthfilterdofilter)) — `C-13`·`D-07` |
| 서비스 `hasActiveOrders(memberId)` | 회원 ID | `boolean` | — | `OrderApi` → `ClaimSupport.hasActiveOrders` — `C-04`·`R-26` |
| 서비스 `purgeExpired(now)` | 기준 시각 | `PurgeResult {task:'order', deleted}` — `deleted` = 개인정보를 지운 주문 수 + 지운 조회 토큰 행 수. mall-api 하루 1회 보존 작업이 공용 인터페이스 `RetentionTask`로 부른다([mall-api 상세 §2](mall-api.md#2-공개-계약)) | — | `OrderRetention.purgeExpired`(`RetentionTask` 구현) — `C-20`·`R-25` |
| 타이머 대사(1분) | 없음 | `APPROVING`·`NET_CANCELLING`·`CANCELLING`을 PG 사실로 닫고, 입금 의심·1시간 지난 `WAITING_DEPOSIT`을 PG에 묻는다. 틱당 시간 예산 3분 | — | `OrderJobs.onReconcileTick` — `C-10`·`C-11`·`C-14`·`R-18` |
| 타이머 만료(1분) | 없음 | `PENDING_PAYMENT` 30분 경과·`WAITING_DEPOSIT` 입금기한 경과 → `EXPIRED`. 틱당 시간 예산 3분 | — | `OrderJobs.onExpiryTick` — `C-11`·`R-19`·`R-20` |
| 타이머 배송(30분) | 없음 | `SHIPPING` → `DELIVERED`, `DELIVERED` 7일 → `CONFIRMED` | — | `OrderJobs.onDeliveryTick` — `C-15`·`R-24` |

- **요청 주체와 소유**: 라우트의 요청 주체는 mall-api 미들웨어가 만든 `Principal {subjectType:'MEMBER'·'ADMIN'·'GUEST'·'ANONYMOUS', subjectId?, guestOrderIds?, …}`다. 비회원 주체의 `guestOrderIds`는 미들웨어가 쿠키 `GOT`를 서비스 `resolveGuestToken`으로 풀어 얻은 주문 ID 목록이다. 토큰의 해시·만료 검사는 order의 `GuestAccess.resolve`가 하고, 조립 지점은 결과만 주체로 싣는다. 주문을 여는 모든 고객 라우트와 claim의 `getClaimableLines`는 `OrderAccessPolicy.loadOwned`에서 그 주체를 주문과 대조한다. 회원은 `orders.member_id`가 같아야 하고, 비회원은 요청 주문 ∈ `guestOrderIds`여야 한다. 회원 세션으로 비회원 주문을 열면 403이다.
- **비회원 토큰 두 출처**: 주문 생성 응답과 비회원 주문조회 응답이 같은 쿠키 `GOT`(httpOnly·Secure·SameSite=Lax·Path=`/api`)를 준다. 한 토큰은 같은 브라우저의 비회원 주문을 최대 5개 가리킨다(§4.2). 그래서 비회원도 결제창 복귀 뒤 승인·가상계좌 발급·주문 완료 화면을 그 토큰으로 부르고, 두 번째 비회원 주문을 해도 앞 주문을 계속 볼 수 있다.
- **경로 우선순위**: `GET /api/admin/orders/carriers`는 정적 경로라 `GET /api/admin/orders/{orderId}`보다 먼저 맞는다(Spring 경로 패턴 우선순위). 주문 ID는 숫자라 겹치지 않는다.
- **주문번호**: `yyyyMMdd-NNNNNNN` — 주문일(KST) 8자리, 하이픈, 첫 자리가 0이 아닌 무작위 7자리(예: `20261019-4821937`). 순번이 아니라서 남의 주문번호를 짐작하기 어렵다. 유일 색인에 걸리면 새로 뽑고, 3번 연속 겹치면 500이다. PG에 넘기는 주문 식별자도 이 값이다(가정 — PG가 6~64자 영숫자·`-`를 받는다).
- **금액 계산**(잠정 — 상위 §9.5 배송비 정책): `itemsAmount` = Σ 현재 단가 × 수량, `discountAmount` = `Promotion.quote`의 쿠폰 할인 합, 배송비 = (`itemsAmount` − `discountAmount`) ≥ 50,000원이면 0원, 아니면 3,000원. 우편번호가 제주·도서산간 표에 있으면 3,000원을 더한다(무료 배송이어도 더한다). `payAmount` = `itemsAmount` − `discountAmount` + 배송비. 모두 원 단위 정수다. 품목 `allocatedAmount` = 단가 × 수량 − 그 품목의 쿠폰 안분액이고, 배송비는 품목에 안분하지 않는다. 견적에 우편번호가 없으면 도서산간 추가 없이 계산하고 `shippingFeeEstimated:true`를 준다.
- **주문명**: PG 결제창과 알림에 쓰는 `orderName` = 첫 품목 상품명(40자에서 자름) + 품목이 둘 이상이면 「외 n건」.
- **취소 모드와 환불 계좌**: order가 취소 시작 때의 주문 상태로 `Payment.cancel`의 `mode`를 정한다 — `WAITING_DEPOSIT`은 가상계좌 폐기 `'VOID'`, `PAID`는 환불 `'REFUND'`. 가상계좌로 결제를 마친 주문의 환불은 `refundAccount`가 있어야 하므로, 없으면 `CANCELLING`으로 가기 전에 422 `REFUND_ACCOUNT_REQUIRED`다. 받은 계좌는 PG 취소가 끝날 때까지 암호화해 주문에 두고(대사가 같은 인자로 다시 부르려고), 취소가 끝나거나 되돌려지면 지운다(§4).
- **불변조건**: 주문 상태와 품목 상태는 이 모듈의 조건부 갱신으로만 바뀐다(§4.1). 저장한 `amount`는 바뀌지 않는다 — 반품 환불은 claim이 품목 `allocatedAmount`로 계산한다.
- **호환성**: 신규 계약이라 이전 버전이 없다. 응답에는 필드만 더하고, 오류 `code` 값은 지우지 않는다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 단일 조율자는 없다. 진입점 묶음마다 조율자가 따로 있다 — `CheckoutService`(견적·생성·승인·가상계좌), `CancelService`(취소), `ShipmentService`(상품 준비·송장·배송 조회·구매확정·배송 완료 반영), `OrderQueryService`(조회·비회원 토큰), `PgWebhookService`(입금 웹훅), `OrderJobs`(대사·만료·배송 타이머), `ManualReviewService`(운영 확인 처리), `ClaimSupport`(클레임·리뷰·탈퇴 지원). 결제 확정과 미결제 해제의 원자 구간은 `OrderSettlement` 하나에 모아 승인·대사·웹훅·만료·취소·운영 확인이 같이 쓴다. 바깥으로 나가는 객체는 공개 인터페이스 `CatalogApi`·`PromotionApi`·`CartApi`·`PaymentApi`·`NotificationApi`와 외부 게이트웨이 `DeliveryTrackerGateway`다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)). 상위의 타이머 노드 `Order.OnReconcileTick`·`Order.OnExpiryTick`·`Order.OnDeliveryTick`(§5.1에서는 묶음 `Order.OnTimer`)은 이 경계의 타이머 인터페이스 `OrderJobs.onReconcileTick`·`onExpiryTick`·`onDeliveryTick`으로 연다.

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Order.claimSupport`(§5.1) = `Order.getClaimableLines`·`Order.markLineClaim`(§5.12), `Order.getConfirmedLine`(§5.13), `hasActiveOrders`(§5.1 묶음 — member 탈퇴) | [`JF-1` 클레임·리뷰·탈퇴 지원](#jf-1-클레임리뷰탈퇴-지원--claimsupport) | — |
| `Order.checkout`(§5.1 묶음) 가운데 `Order.previewCheckout`(§5.5·§5.6) | [`JF-2` 주문서 견적](#jf-2-주문서-견적--checkoutservicepreviewcheckout) | — |
| `Order.placeOrder`·`.rejected`·`.result`(§5.6) | [`JF-3` 주문 생성](#jf-3-주문-생성--checkoutserviceplaceorder) — [`JF-3A`](#jf-3a-읽기와-금액-대조) 읽기·금액 대조, [`JF-3B`](#jf-3b-저장-트랜잭션) 저장 트랜잭션 | — |
| `Order.settle`·`.paid`·`.released`·`.unsettlable`(§5.7~§5.10 — 승인·대사·웹훅·만료·취소가 모이는 종결 입구) | `.paid` → [`JF-4.1` 결제 확정](#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid), `.released` → [`JF-4.2` 해제](#jf-42-해제-트랜잭션--ordersettlementrelease) (`OrderSettlement`) | `.unsettlable` = `settlePaid`의 결과 `unsettlable` — 카드는 [`JF-4`](#jf-4-카드간편결제-승인--checkoutserviceapprovepayment)·[`JF-10A`](#jf-10a-승인-결과-불명)의 `beginNetCancel`, 가상계좌 입금은 [`JF-9`](#jf-9-입금-웹훅--pgwebhookservicehandlepgwebhook)·[`JF-10C`](#jf-10c-입금-확인)의 `moveToReview`, 운영 확인은 [`JF-13`](#jf-13-운영-확인-처리--manualreviewserviceresolve)의 409 |
| `Order.approvePayment`·`.unknown`·`.result`(§5.7) | [`JF-4` 카드·간편결제 승인](#jf-4-카드간편결제-승인--checkoutserviceapprovepayment) | `Order.approvePayment --> Order.settle` → [`JF-4.1`](#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid)·[`JF-4.2`](#jf-42-해제-트랜잭션--ordersettlementrelease) |
| `Order.issueVirtualAccount`·`.issued`(§5.9) | [`JF-5` 가상계좌 발급](#jf-5-가상계좌-발급--checkoutserviceissuevirtualaccount) | `.issued` = `PaymentApi.issueVirtualAccount.issued` → `markWaitingDeposit.done`의 세 호출 |
| `Order.cancelOrder`·`.refundFailed`·`.notCancellable`(§5.10) | [`JF-6` 주문 취소](#jf-6-주문-취소--cancelservicecancelorder) | `Order.cancelOrder --> Order.settle` → [`JF-4.2`](#jf-42-해제-트랜잭션--ordersettlementrelease) |
| `Order.prepareShipment`·`Order.registerShipment`·`Order.getTracking`(§5.11), `Order.confirmLine`·`.result`(§5.13) | [`JF-7` 상품 준비·송장·배송 조회·구매확정](#jf-7-상품-준비송장배송-조회구매확정--shipmentservice) | `Order.prepareShipment` = `ShipmentService.prepareLines` |
| `Order.lookupGuestOrder`·`.result`·`Order.getOrder`·`.notOwner`·`Order.listMyOrders`(§5.14) | [`JF-8` 주문 조회·비회원 토큰](#jf-8-주문-조회비회원-토큰--orderqueryservice) | — |
| `Order.resolveGuestToken`(§3.1·§4.3 — 인증 미들웨어가 부르고 §5 그림에는 그리지 않음) | 열지 않음 — `GuestAccess.resolve`(§4.2) | — |
| `Order.handlePgWebhook`(§5.1·§5.9) | [`JF-9` 입금 웹훅](#jf-9-입금-웹훅--pgwebhookservicehandlepgwebhook) | `Order.handlePgWebhook --> Order.settle` → [`JF-4.1`](#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid)·[`JF-4.2`](#jf-42-해제-트랜잭션--ordersettlementrelease) |
| `Order.OnTimer`(§5.1 묶음) = `Order.OnReconcileTick`(§5.8) = `OrderJobs.onReconcileTick` | [`JF-10` 대사 타이머](#jf-10-대사-타이머--orderjobsonreconciletick) — [`JF-10A`](#jf-10a-승인-결과-불명) 승인 결과 불명, [`JF-10B`](#jf-10b-pg-취소-재시도) PG 취소 재시도, [`JF-10C`](#jf-10c-입금-확인) 입금 확인 | `Order.OnReconcileTick --> Order.settle` → [`JF-4.1`](#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid)·[`JF-4.2`](#jf-42-해제-트랜잭션--ordersettlementrelease) |
| `Order.OnTimer`(§5.1 묶음) = `Order.OnExpiryTick`(§5.9) = `OrderJobs.onExpiryTick` | [`JF-11` 만료 타이머](#jf-11-만료-타이머--orderjobsonexpirytick) | `Order.OnExpiryTick --> Order.settle` → [`JF-4.2`](#jf-42-해제-트랜잭션--ordersettlementrelease) |
| `Order.OnTimer`(§5.1 묶음) = `Order.OnDeliveryTick`(§5.11) = `OrderJobs.onDeliveryTick` | [`JF-12` 배송 타이머](#jf-12-배송-타이머--orderjobsondeliverytick) | 배송 완료 반영은 [`JF-7`](#jf-7-상품-준비송장배송-조회구매확정--shipmentservice)의 `applyDelivered` |
| `Order.adminOrders`(§5.1 묶음) = 운영 주문 조회·상품 준비·송장 등록·운영 확인 처리 | 준비·송장 → [`JF-7`](#jf-7-상품-준비송장배송-조회구매확정--shipmentservice), 조회 → [`JF-8`](#jf-8-주문-조회비회원-토큰--orderqueryservice), 확인 처리 → [`JF-13`](#jf-13-운영-확인-처리--manualreviewserviceresolve) | [`JF-4.1`](#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid), [`JF-4.2`](#jf-42-해제-트랜잭션--ordersettlementrelease) |
| `Order.cleanupSupport`(§5.1 묶음) = `Order.purgeExpired`(§5.17) | 열지 않음 — `OrderRetention.purgeExpired`(파기 질의 셋 — §4.3) | — |

상위 바깥 노드 ↔ 이 경계의 객체: `Catalog.*` = `CatalogApi.*`, `Promotion.*` = `PromotionApi.*`, `Cart.removeItems` = `CartApi.removeItems`, `Payment.*` = `PaymentApi.*`, `Notification.enqueue` = `NotificationApi.enqueue`, `Tracker.track` = `DeliveryTrackerGateway.track`, `Order.settle` = `OrderSettlement.settlePaid`·`release`. 상위 그림의 `Order.<계약>.<값>` 분기는 아래 그림에서 그 값을 만든 호출(대개 `PaymentApi` 결과나 `OrderSettlement` 결과)의 값 분기로 열린다. 아래 그림의 `PaymentApi.*` 값 분기 이름은 payment 결과 갈래 이름(`paid`·`declined`·`unknown`·`notApproved`·`cancelled`·`issued`·`failed`·`rejected`·`unavailable` 등) 그대로이고, 여러 갈래를 한 처리로 묶을 때만 order 쪽 묶음 이름(`.closed`·`.stillOpen`·`.foreignCancel`, 아래 `PaymentApi.cancel`의 `.failed`·`.rejected`·`.unknown` 묶음)을 쓴다 — 각 그림 아래 표에 묶은 갈래를 적었다.

**`PaymentApi.cancel` 부르는 곳과 결과 갈래** — `cancel(orderRef{orderId, orderNo}, amount, reason, idemKey, mode, refundAccount?)`의 결과는 예외가 아니라 값이다([payment 상세 §2](payment.md#2-공개-계약)). 아래 그림의 `PaymentApi.cancel` 값 분기 이름은 이 표의 갈래 이름이다 — `.cancelled`, `.failed`(되돌림: `ALREADY_DEPOSITED`·`REFUND_ACCOUNT_REQUIRED`), `.rejected`(운영 확인: `PG_REJECTED`·`NOT_CANCELLABLE`), `.unknown`(보류: `unknown`·`CANCEL_IN_PROGRESS`).

| 부르는 곳 | `mode`·멱등 키 | `cancelled` | `failed {ALREADY_DEPOSITED}` | `failed {REFUND_ACCOUNT_REQUIRED}` | `failed {PG_REJECTED}`·`{NOT_CANCELLABLE}` | `unknown`·`failed {CANCEL_IN_PROGRESS}` |
|---|---|---|---|---|---|---|
| 고객 취소 `PAID`(`JF-6`) | `REFUND`, `cancel:<orderId>`, `refundAccount`(가상계좌 결제면) | `CANCELLING → CANCELLED` + 해제 + 알림 → 200 | 나오지 않는다(`VOID`만) | 방어 — 직전 상태로 되돌림 → 422 | `CANCELLING → MANUAL_REVIEW` → 502 `REFUND_FAILED {code}` | `CANCELLING` 유지 → 202. `JF-10B`가 닫는다 |
| 고객 취소 `WAITING_DEPOSIT`(`JF-6`) | `VOID`, `vbank-void:<orderId>` | `CANCELLING → CANCELLED` + 해제 → 200 | `CANCELLING → WAITING_DEPOSIT` + 입금 의심 표시 → 409 `ALREADY_DEPOSITED`. `JF-10C`·웹훅이 `PAID`로 | 나오지 않는다 | 위와 같음 | 위와 같음 |
| 망취소(`JF-4`·`JF-10B`) | `REFUND`, `netcancel:<orderId>` | `NET_CANCELLING → PAYMENT_FAILED` + 해제 → (`JF-4`면) 500 | 나오지 않는다 | 나오지 않는다(카드) | `NET_CANCELLING → MANUAL_REVIEW` → (`JF-4`면) 202 | `NET_CANCELLING` 유지 → (`JF-4`면) 202. `JF-10B`가 닫는다 |
| 취소 재시도(`JF-10B`) | 처음과 같은 인자·같은 키 | 위 각 행과 같다 | `CANCELLING → WAITING_DEPOSIT` + 입금 의심 표시 | 방어 — 되돌림 + 경보 `CANCEL_FAILED` | `→ MANUAL_REVIEW` | 다음 틱. 결론 없는 시도 +1(§6 상한) |
| 만료 폐기(`JF-11`) | `VOID`, `vbank-void:<orderId>` | `WAITING_DEPOSIT → EXPIRED` + 해제 | 만료하지 않고 입금 의심 표시 | 나오지 않는다 | `WAITING_DEPOSIT → MANUAL_REVIEW` | 다음 틱. 시도 +1 |
| 발급 중 종료 폐기(`JF-5`) | `VOID`, `vbank-void:<orderId>` | 주문은 이미 끝났다 → 409 `INVALID_STATE` | 끝난 주문 → `MANUAL_REVIEW`(사유 `DEPOSIT_AFTER_CLOSE`) | 나오지 않는다 | 경보 `VBANK_VOID_FAILED` | 경보 `VBANK_VOID_FAILED` — 입금되면 `JF-9`의 마감 뒤 입금으로 잡힌다 |

- PG에서 이미 취소·폐기된 건은 payment가 `cancelled`로 준다(멱등 성공). 결제 기록이 `PAID`이면 `VOID`는 환불로 바뀌지 않고 `ALREADY_DEPOSITED`다 — 그래서 입금 대기 취소가 「몰래」 환불이 되지 않고, 고객은 결제 완료로 반영된 뒤 환불 계좌를 넣어 다시 취소한다.
- `VOID`는 고객 취소·만료·발급 중 종료가 모두 「주문 전체의 가상계좌 폐기」라 같은 키 `vbank-void:<orderId>`를 쓴다. 환불(`cancel:`)과 키를 나눈 것은 같은 주문에서 폐기가 `ALREADY_DEPOSITED`로 끝난 뒤 환불을 다시 시작할 때 다른 모드의 기록과 겹치지 않게 하려는 것이다.

**표기** 노드는 제안 클래스·메서드다. 타이머 진입 메서드 `onReconcileTick`·`onExpiryTick`·`onDeliveryTick`은 실제 타이머 이벤트라 `on`으로 시작하고, 렌더러가 이벤트 모양으로 그린다. 라우트 컨트롤러(`OrderController` 등)는 요청 주체·입력 검사·결과를 HTTP로 바꾸는 얇은 층이라 그리지 않고 §2 구현 칸에만 적었다. 저장소 메서드 이름은 조건부 갱신 하나를 뜻한다(§4.1). `OrderRepository.moveToReview`는 어느 상태에서든 「그 상태 → `MANUAL_REVIEW`」 조건부 갱신 + 사유·직전 상태 기록 + 경보 `RECONCILE_STUCK`이다. 렌더 확인은 `design-doc-check.mjs`의 `--renderer` SVG를 PNG로 바꿔 18개 블록 모두 눈으로 봤다. 열지 않은 것: `PricingCalculator.calculate`·`LinePolicy`·`NoticePolicy`(순수 판단 — 판단표는 각 그림 아래), `OrderNumberGenerator.next`(무작위 발급과 유일 색인 재시도), `GuestAccess`(비밀번호 해시·잠금·토큰 — §4.2), `OrderRetention.purgeExpired`(파기 질의 셋 — §4.3).

### JF-1 클레임·리뷰·탈퇴 지원 — ClaimSupport

```jobflow
orchestrator: ClaimSupport
Object: ClaimSupport, OrderAccessPolicy, LinePolicy, OrderRepository
ClaimSupport.getClaimableLines --> OrderAccessPolicy.loadOwned
OrderAccessPolicy.loadOwned.notOwner
OrderAccessPolicy.loadOwned.result --> LinePolicy.evaluateClaimable
ClaimSupport.markLineClaim --> OrderRepository.updateLineClaim
OrderRepository.updateLineClaim.conflict
ClaimSupport.getConfirmedLine --> OrderRepository.findLine
OrderRepository.findLine.result --> LinePolicy.checkConfirmed
ClaimSupport.hasActiveOrders --> OrderRepository.existsActive
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `getClaimableLines` → `OrderAccessPolicy.loadOwned` | `C-15`·`C-16` | 요청 주체가 소유자가 아니면 `.notOwner`(claim이 403으로 바꾼다), 주문이 없으면 `notFound`(그리지 않음) |
| `LinePolicy.evaluateClaimable` | `R-14`·`R-25` | 품목마다 반품 가능 여부와 이유 — 상태 `DELIVERED`, 배송 완료 7일 안(`deliveredAt + 7일 > 지금`), 구매확정 전, 클레임 표시가 `NONE`·`CLAIM_REJECTED`. 아니면 `why` = `NOT_DELIVERED`(배송 전)·`WINDOW_EXPIRED`(7일 지남)·`CONFIRMED`(구매확정)·`CLAIM_IN_PROGRESS`(`RETURN_REQUESTED`·`EXCHANGE_REQUESTED`이거나 교환 재발송 대기)·`ALREADY_RETURNED`(`RETURNED`, 그리고 교환을 마친 `EXCHANGED` — 교환품 재클레임은 받지 않는다, §8). 결과에 결제 참조(`paymentRef` = payment의 `orderRef {orderId, orderNo}` — claim이 `Payment.cancel`에 넘긴다)·결제수단·주문자 연락처·상품금액·할인·배송비·무료배송 여부·품목 `allocatedAmount`를 담는다 — claim이 반품 배송비와 무료배송 기준을 다시 계산한다 |
| `markLineClaim` → `OrderRepository.updateLineClaim` | `C-16` | 품목별 조건부 갱신(§4.1의 클레임 표시 기계). 하나라도 조건에 안 맞으면 `.conflict {lineId, why}`(`why`는 위와 같은 코드) — 그 호출 안에서 바꾼 품목은 없다(호출자 트랜잭션을 롤백한다). `RETURNED`면 같은 갱신에서 주문 상태를 `PARTIALLY_RETURNED`·`RETURNED`로 다시 계산한다. `EXCHANGED`면 품목에 `exchange_sku_id`(받은 `exchangeSkuIds`의 짝)와 재발송 대기 표시를 단다 — 교환 재발송 송장이 이 SKU로 나간다(`JF-7`). `NONE`은 같은 `claimId`의 요청 표시만 지운다(클레임 철회) |
| `getConfirmedLine` → `findLine` → `LinePolicy.checkConfirmed` | `C-17` | 품목이 없거나 주문의 회원 ID ≠ `memberId`(비회원 주문 포함)면 `notOwner`, 품목이 `CONFIRMED`가 아니면 `notConfirmed`, 맞으면 `confirmed {orderId, productId, skuId, productName, optionName, confirmedAt}` — 상품명·옵션명은 품목 스냅숏이다(review가 리뷰에 남긴다) |
| `hasActiveOrders` → `existsActive` | `C-04`·`R-26` | `true` 조건 — 주문이 `PENDING_PAYMENT`·`APPROVING`·`NET_CANCELLING`·`WAITING_DEPOSIT`·`CANCELLING`·`MANUAL_REVIEW`이거나, `PAID`·`PARTIALLY_RETURNED` 주문에 출고 전(`PAID`·`PREPARING`) 품목이 있거나, 클레임 표시가 `RETURN_REQUESTED`·`EXCHANGE_REQUESTED`이거나 교환 재발송 대기인 품목이 있다 |

- **트리거** 상위 `Claim.requestReturn`·`Claim.completeReturn`(§5.12), `Review.createReview`(§5.13), member 탈퇴(§5.1 `Member.auth`). **완료 사실** 조회 결과, 또는 품목 클레임 표시 1회 변경.
- 네 진입은 서로 다른 호출자의 서로 다른 계약이라 합류가 아니다. `markLineClaim`만 쓰기이고 나머지 셋은 읽기다.
- 클레임 상태 자체(`REFUND_PENDING` 등)는 claim이 갖는다. order는 품목 표시만 바꾸고, 진행 중 클레임이 하나라도 걸린 품목에 두 번째 요청 표시를 거절해 「품목당 진행 중 클레임 1건」을 지킨다(상위 §6.2).

### JF-2 주문서 견적 — CheckoutService.previewCheckout

```jobflow
orchestrator: CheckoutService
Object: CheckoutService, CatalogApi, PromotionApi, PricingCalculator
CheckoutService.previewCheckout --> CatalogApi.getSkus
CatalogApi.getSkus.soldOut
CheckoutService.previewCheckout --> PromotionApi.quote
CheckoutService.previewCheckout --> PricingCalculator.calculate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CatalogApi.getSkus`·`.soldOut` | `R-09` | 현재 단가·판매 상태·재고 여부·`productId`·`categoryIds`·`maxQuantity`. 판매중지나 품절 SKU가 있으면 409 `SOLD_OUT {skuIds}`로 끝난다 |
| `PromotionApi.quote` | `C-07`·`C-09` | 회원이고 `couponIds`가 있을 때만 부른다. `lines`의 가격·카테고리는 `getSkus` 값으로만 채운다. 적용 불가 쿠폰은 오류가 아니라 `unavailableReason`으로 돌려준다 |
| `PricingCalculator.calculate` | `C-09` | §2 「금액 계산」의 순수 함수. 상위 `Order.previewCheckout`의 응답이 이 결과다 |

- **트리거** 상위 `Browser.openCheckout`·`Browser.applyCoupon`(§5.5·§5.6). **완료 사실** 견적 응답 — 아무것도 저장하지 않고 가예약·점유도 하지 않는다. 그래서 같은 견적을 몇 번 불러도 효과가 없다.
- `PricingCalculator.calculate`는 `JF-3`의 주문 생성과 같은 함수다. 견적과 주문 생성의 금액이 다르면 그 사이에 단가·쿠폰 조건이 바뀐 것이고, `JF-3`이 409 `PRICE_CHANGED`로 막는다.

### JF-3 주문 생성 — CheckoutService.placeOrder

`placeOrder` 한 번의 호출을 두 묶음으로 나눠 그렸다. `JF-3A`는 트랜잭션 전의 읽기·금액 대조·비밀번호 해시이고, `JF-3B`는 그 뒤에 이어지는 저장 트랜잭션이다. 한 그림에 두면 `CatalogApi`·`PromotionApi`를 두 번씩 부르는 칸이 앞 행에 끼어들어 순서가 흐려진다.

#### JF-3A 읽기와 금액 대조

```jobflow
orchestrator: CheckoutService
Object: CheckoutService, CatalogApi, PromotionApi, PricingCalculator, GuestAccess
CheckoutService.placeOrder --> CatalogApi.getSkus
CatalogApi.getSkus.soldOut
CheckoutService.placeOrder --> PromotionApi.quote
PromotionApi.quote.unavailable
CheckoutService.placeOrder --> PricingCalculator.calculate
CheckoutService.placeOrder --> GuestAccess.hashPassword
```

| 노드 | 근거 | 비고 |
|---|---|---|
| 입력 검사(그리지 않음) | `R-08` | 품목 1~50행, 수량 1~SKU 최대, 휴대폰 `010-…`, 우편번호 5자리, 비회원 비밀번호 6~20자 — 어긋나면 422 `VALIDATION_FAILED`. 미로그인이면 `guest`가 있어야 하고(422 `GUEST_INFO_REQUIRED`), `privacyAgreedAt`이 없으면 422 `GUEST_CONSENT_REQUIRED`, 비회원 쿠폰은 422 `VALIDATION_FAILED` |
| `CatalogApi.getSkus`·`.soldOut` | `R-09` | 판매중지·품절 SKU가 있으면 409 `OUT_OF_STOCK {skuIds}` |
| `PromotionApi.quote`·`.unavailable` | `C-07`·`C-09` | 견적 뒤에 쿠폰이 만료·사용됐으면 409 `COUPON_UNAVAILABLE` |
| `PricingCalculator.calculate` | `C-09`·`R-09` | 결과 `payAmount` ≠ `expectedAmount`면 409 `PRICE_CHANGED {amount}` — 서비스 안의 비교라 그리지 않았다 |
| `GuestAccess.hashPassword` | `D-07`·`R-16` | 비회원 주문만 — bcrypt(cost 10, 잠정) 해시를 트랜잭션 **전에** 만든다. 해시는 수십 ms가 걸려(설계상 예상) 트랜잭션 안에서 하면 가예약 행 잠금을 그만큼 오래 쥔다 |

#### JF-3B 저장 트랜잭션

```jobflow
orchestrator: CheckoutService
Object: CheckoutService, OrderNumberGenerator, OrderRepository, CatalogApi, PromotionApi, GuestAccess
CheckoutService.placeOrder --> OrderNumberGenerator.next
CheckoutService.placeOrder --> OrderRepository.insert
CheckoutService.placeOrder --> CatalogApi.reserveStock
CatalogApi.reserveStock.outOfStock
CheckoutService.placeOrder --> PromotionApi.lockCoupons
PromotionApi.lockCoupons.unavailable
CheckoutService.placeOrder --> GuestAccess.register
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderNumberGenerator.next` | `C-09` | §2 「주문번호」. 유일 색인 충돌은 `insert`가 알려 주고 새 번호로 다시 넣는다(최대 3회) |
| `OrderRepository.insert` | `C-09`·`R-25` | 트랜잭션 시작. 주문(`PENDING_PAYMENT`, `hold_until` = 지금 + 30분), 품목 스냅숏(상품명·옵션명·단가·`allocatedAmount`, 상태 `ORDERED`), 장바구니 소유자·`cartItemIds`, 비회원 동의 시각, 상태 이력 1행 |
| `CatalogApi.reserveStock`·`.outOfStock` | `D-03`·`R-20` | `reserveStock('order:<orderId>', lines, holdUntil)`. 모자라면 409 `OUT_OF_STOCK {skuIds}` + 롤백 |
| `PromotionApi.lockCoupons`·`.unavailable` | `C-07` | `lockCoupons('order:<orderId>', memberCouponIds)`. `unavailable`이면 409 `COUPON_UNAVAILABLE` + 롤백 |
| `GuestAccess.register` | `D-07`·`R-16` | 비회원 주문만 — `JF-3A`에서 만든 비밀번호 해시로 접근 행을 넣고, 요청에 유효한 `GOT`가 있으면 그 토큰에 주문을 더하고 수명을 갱신한다(없으면 새 토큰). 쿠키 `GOT`를 응답에 싣는다. 트랜잭션 끝 |

- **트리거** 상위 `Browser.placeOrder`(§5.6). **완료 사실** 주문 `PENDING_PAYMENT` + 가예약 30분 + 쿠폰 점유 + (비회원) 접근 행·조회 토큰 — `insert`부터 `register`까지 한 트랜잭션이다(상위 §6.3 ①).
- **실패 분기** `JF-3A`·`JF-3B`의 `.soldOut`·`.unavailable`·`.outOfStock`과 그리지 않은 409·422는 모두 상위 `Order.placeOrder.rejected`다. `JF-3B` 안에서 난 거절은 롤백되어 주문·가예약·점유·토큰이 남지 않는다.
- `JF-3A`의 `PromotionApi.quote`와 `CatalogApi.getSkus`를 트랜잭션 밖에서 먼저 부르는 것은 읽기라서다. 그 사이 바뀐 재고는 `reserveStock`의 조건부 감소가, 바뀐 쿠폰은 `lockCoupons`가 다시 막는다.

### JF-4 카드·간편결제 승인 — CheckoutService.approvePayment

```jobflow
orchestrator: CheckoutService
Object: CheckoutService, OrderAccessPolicy, OrderRepository, PaymentApi, OrderSettlement
CheckoutService.approvePayment --> OrderAccessPolicy.loadOwned
OrderAccessPolicy.loadOwned.notOwner
CheckoutService.approvePayment --> OrderRepository.beginApproving
OrderRepository.beginApproving.rejected
CheckoutService.approvePayment --> PaymentApi.approve
PaymentApi.approve.declined --> OrderSettlement.release
PaymentApi.approve.unknown
PaymentApi.approve.paid --> OrderSettlement.settlePaid
OrderSettlement.settlePaid.retryable
OrderSettlement.settlePaid.unsettlable --> OrderRepository.beginNetCancel
OrderRepository.beginNetCancel.lost
OrderRepository.beginNetCancel.started --> PaymentApi.cancel
PaymentApi.cancel.cancelled --> OrderSettlement.release
PaymentApi.cancel.rejected --> OrderRepository.moveToReview
PaymentApi.cancel.unknown
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderAccessPolicy.loadOwned`·`.notOwner` | `C-13` | 403 `NOT_OWNER`, 없는 주문 404. 이어서 서비스가 `amount` = 저장 금액인지 본다 — 다르면 400 `AMOUNT_MISMATCH`이고 상태는 그대로다(그리지 않음) |
| `OrderRepository.beginApproving`·`.rejected` | `D-04`·`R-18` | 트랜잭션 하나(상위 §6.3 ②). 조건 — 상태 `PENDING_PAYMENT`, 결제수단 카드·간편결제, `hold_until > 지금`. 맞으면 `APPROVING` + `paymentKey`·`state_changed_at` 기록. 아니면 `.rejected` → 409 `INVALID_STATE {status}`(두 번째 요청이면 `APPROVING`, 30분이 지났으면 `EXPIRED`) |
| `PaymentApi.approve` | `C-10`·`C-12` | 트랜잭션 밖. `approve(paymentKey, orderRef {orderId, orderNo}, amount)` — 30s, 멱등 키 `approve:<orderId>` |
| `.declined` → `OrderSettlement.release` | `R-10` | payment `declined` — 상위 `Order.approvePayment --> Order.settle`의 `.released`. `APPROVING → PAYMENT_FAILED` + 해제(`JF-4.2`) → 402 `PAYMENT_DECLINED` |
| `.unknown` | `D-04` | 보류로 끝나는 분기 — 상위 `Order.approvePayment.unknown`. 주문은 `APPROVING`, 202. `JF-10A`가 닫는다 |
| `.paid` → `OrderSettlement.settlePaid` | `C-10`·`R-10` | 상위 `Order.settle.paid`. `settlePaid(orderId, APPROVING)`(`JF-4.1`). `settled`면 200 `PAID`. `lost`면 다시 읽어 그 상태로 답한다(대사가 먼저 확정했으면 200) |
| `.retryable` | `C-10`·`R-18` | 보류로 끝나는 분기 — 상위 `Order.approvePayment.unknown`의 둘째 원인. 확정 트랜잭션의 **일시 오류**(잠금 대기·교착·타임아웃)로 롤백됐다. 망취소하지 않는다 — 주문은 `APPROVING`으로 두고 202. `JF-10A`가 PG `paid`를 보고 다시 확정한다 |
| `.unsettlable` → `OrderRepository.beginNetCancel` | `C-10`·`R-18` | 상위 `Order.settle.unsettlable` — **확정 불가**(가예약 소실 `notHeld`)다. 조건부 `APPROVING → NET_CANCELLING`(행 하나). 바뀐 행이 1이면 `.started`, 0이면 `.lost` — 대사가 먼저 확정했거나 망취소를 시작했다는 뜻이라 PG를 부르지 않고 다시 읽어 그 상태로 답한다 |
| `.started` → `PaymentApi.cancel` | `C-10`·`C-12` | 트랜잭션 밖. `cancel(orderRef, amount, '주문 확정 실패', 'netcancel:<orderId>', 'REFUND')` |
| `.cancelled` → `OrderSettlement.release` | `C-10` | `NET_CANCELLING → PAYMENT_FAILED` + 가예약·점유 해제(`JF-4.2`) → 500 `ORDER_COMMIT_FAILED` |
| `.rejected` → `OrderRepository.moveToReview` | `C-10` | `PG_REJECTED`·`NOT_CANCELLABLE` — 돈은 빠졌고 PG가 취소를 거절했다. `NET_CANCELLING → MANUAL_REVIEW`(사유 = 코드) + 경보 `RECONCILE_STUCK` → 202 `{status:'MANUAL_REVIEW'}`. 운영자가 `JF-13`으로 닫는다 |
| `PaymentApi.cancel.unknown` | `C-10`·`R-18` | 보류로 끝나는 분기 — 결과 불명·`CANCEL_IN_PROGRESS`. 주문은 `NET_CANCELLING`으로 남고 202. `JF-10B`가 PG 사실로 닫는다 |

- **트리거** 상위 `Browser.returnFromPg`(§5.7). **완료 사실** 200이면 `PAID`와 확정 트랜잭션의 네 효과, 402·500이면 `PAYMENT_FAILED`와 해제, 202면 `APPROVING`·`NET_CANCELLING`·`MANUAL_REVIEW` 가운데 하나(화면은 주문 상세를 폴링한다).
- `OrderSettlement.release`로 들어오는 화살표 둘은 택일 경로(거절 / 망취소 성공)의 **합류**다 — 승인 한 번에 해제는 많아야 한 번이고, `release` 안의 조건부 전이(`APPROVING → PAYMENT_FAILED` 또는 `NET_CANCELLING → PAYMENT_FAILED`)가 두 번째를 막는다.
- **망취소와 대사의 경합** 망취소는 조건부 전이 `APPROVING → NET_CANCELLING`으로만 시작하고, `settlePaid`는 카드 주문을 `APPROVING`에서만 확정한다. 그래서 대사가 먼저 확정했으면 망취소가 시작되지 않고, 망취소가 시작됐으면 대사가 확정하지 않는다 — 「확정된 주문의 돈을 돌려주는」 일과 「망취소한 주문을 확정하는」 일이 둘 다 막힌다.
- **두 번 누름** 두 요청이 함께 와도 `beginApproving`의 조건부 갱신이 하나만 통과시킨다. 진 쪽은 PG를 부르지 않는다. 서버가 `beginApproving` 뒤 PG 호출 중에 죽으면 주문은 `APPROVING`으로 남고 `JF-10A`가 거둔다.
- **결제 대기 기한** `hold_until > 지금` 조건 때문에 30분이 지난 주문은 만료 타이머가 아직 돌지 않았어도 승인을 시작하지 않는다(PG 인증만 한 결제라 돈이 빠지지 않는다). 승인을 시작한 주문은 만료 타이머가 건드리지 않고, catalog는 `holdUntil`을 기록만 하고 스스로 풀지 않으므로([catalog 상세 §3](catalog.md#3-내부-job-flow--드릴다운)) `APPROVING`이 길어져도 가예약이 남는다.

#### JF-4.1 결제 확정 트랜잭션 — OrderSettlement.settlePaid

```jobflow
orchestrator: OrderSettlement
Object: OrderSettlement, OrderRepository, CatalogApi, PromotionApi, CartApi, NotificationApi
OrderSettlement.settlePaid --> OrderRepository.transition
OrderRepository.transition.lost
OrderRepository.transition.done --> CatalogApi.commitReservation
CatalogApi.commitReservation.notHeld
OrderRepository.transition.done --> PromotionApi.useCoupons
OrderRepository.transition.done --> CartApi.removeItems
OrderRepository.transition.done --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `settlePaid(orderId, from)` | `C-10`·`C-11` | 트랜잭션 하나(상위 §6.3 ③). `from` = `APPROVING`(카드 승인·대사 — `NET_CANCELLING`은 받지 않는다), `WAITING_DEPOSIT`(웹훅·입금 확인 대사), `MANUAL_REVIEW`(운영 확인 `CONFIRM_PAID`). 결과 `settled`·`lost`·`unsettlable`(확정 불가 — 롤백, 상위 `Order.settle.unsettlable`)·`retryable`(일시 오류 — 롤백, 상태 그대로) |
| `OrderRepository.transition`·`.done`·`.lost` | `R-18`·`R-19` | 조건부 `from → PAID` + 품목 `ORDERED → PAID` + `paid_at` + 이력. 이미 다른 경로가 바꿨으면 `.lost` — 아무것도 부르지 않고 `lost`를 돌려준다(호출자가 현재 상태를 다시 읽는다) |
| `CatalogApi.commitReservation`·`.notHeld` | `D-03` | `commitReservation('order:<orderId>')`. 가예약이 없으면 `.notHeld` → 예외 → 롤백 → 호출자에게 `unsettlable`. 가예약을 푸는 쪽은 order뿐이고 그 해제는 조건부 전이와 한 트랜잭션이라 정상 흐름에서는 나오지 않는다 — 운영자가 DB를 손댄 경우 등을 받는 방어 갈래다 |
| `PromotionApi.useCoupons` | `C-07` | `useCoupons('order:<orderId>')` — 점유를 사용으로(멱등) |
| `CartApi.removeItems` | `C-08` | 결제수단이 카드·간편결제일 때만 — 장바구니 소유자·`cartItemIds`. 가상계좌는 발급 때 이미 지웠다(`JF-5`) |
| `NotificationApi.enqueue` | `R-22`·`D-06` | 카드·간편결제면 `ORDER_PAID`(`dedupKey` `order-paid:<orderId>`), 가상계좌면 `VBANK_DEPOSITED`(`vbank-deposited:<orderId>`) |

- **트리거** `JF-4` `.paid`, `JF-9` `.settle`, `JF-10A` `.paid`, `JF-10C` `.paid`, `JF-13` `CONFIRM_PAID`. 상위 `Order.settle.paid`가 이 그림이다. **완료 사실** 주문 `PAID` + 재고 확정 + 쿠폰 사용 + (카드) 장바구니 정리 + 알림 1건 — 넷 다이거나 아무것도 아니다.
- 여러 호출자가 한 주문에 함께 들어와도 `transition`의 조건부 갱신이 한 번만 `.done`을 준다. 워커 계약도 참조 키로 멱등이라 두 번째 방어가 된다(상위 §5.8).
- 롤백의 원인이 `notHeld`면 `unsettlable`, 잠금 대기·교착·타임아웃 같은 DB 일시 오류면 `retryable`이다 — 앞의 것만 망취소·운영 확인으로 가고, 뒤의 것은 상태를 그대로 둬 다시 시도한다.
- 값 분기 `.done`에서 나가는 넷은 같은 트랜잭션 안의 순차 호출이다. 줄 순서는 실제 호출 순서와 같다.

#### JF-4.2 해제 트랜잭션 — OrderSettlement.release

```jobflow
orchestrator: OrderSettlement
Object: OrderSettlement, OrderRepository, CatalogApi, PromotionApi, NotificationApi
OrderSettlement.release --> OrderRepository.transition
OrderRepository.transition.lost
OrderRepository.transition.done --> CatalogApi.releaseStock
OrderRepository.transition.done --> PromotionApi.releaseCoupons
OrderRepository.transition.done --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `release(orderId, from, to, notice?)` | `C-10`·`C-11`·`C-14` | 트랜잭션 하나(상위 §6.3 ④·⑥). 결과 `released`·`lost` |
| `OrderRepository.transition`·`.done`·`.lost` | `R-20` | 조건부 `from → to` + 품목 → `CANCELLED` + 이력 + (있으면) 암호화한 환불 계좌 지움. `.lost`면 해제하지 않는다 |
| `CatalogApi.releaseStock` | `D-03` | `releaseStock('order:<orderId>')` — 가예약이면 해제, 확정이면 재입고(catalog가 참조 키로 가른다) |
| `PromotionApi.releaseCoupons` | `C-07` | 점유 해제 또는 사용 취소(기간이 남은 쿠폰만 — promotion이 정한다) |
| `NotificationApi.enqueue` | `R-22` | `notice`가 있을 때만 — 결제 완료 주문의 취소(`ORDER_CANCELLED`, `order-cancelled:<orderId>`). 결제 전·입금 대기 취소와 만료는 알리지 않는다 |

| 호출자 | `from → to` | 알림 |
|---|---|---|
| `JF-4` `.declined`, `JF-10A` `.notApproved` | `APPROVING → PAYMENT_FAILED` | 없음 |
| `JF-4`·`JF-10B` 망취소 확인 | `NET_CANCELLING → PAYMENT_FAILED` | 없음 |
| `JF-6` 결제 전 취소 | `PENDING_PAYMENT → CANCELLED` | 없음 |
| `JF-6`·`JF-10B` PG 취소·폐기 확인, `JF-9` 폐기 요청 중 `expired` 통보 | `CANCELLING → CANCELLED` | 결제 완료였던 주문만 |
| `JF-11` 만료, `JF-9` `expired` 통보·우리 폐기의 `cancelled` 통보, `JF-10C` `.closed` | `PENDING_PAYMENT`·`WAITING_DEPOSIT → EXPIRED` | 없음 |
| `JF-13` `RELEASE` | `MANUAL_REVIEW →` 들어온 곳에 따라 `PAYMENT_FAILED`·`EXPIRED`·`CANCELLED` | `CANCELLED`이고 결제 완료였던 주문만 |

- 상위 `Order.settle.released`가 이 그림이다. 줄 순서는 실제 호출 순서와 같다. `.lost`는 다른 경로가 먼저 상태를 바꾼 경우다(예: 만료 타이머와 고객 취소가 겹침) — 해제는 이긴 쪽이 한 번 했다.

### JF-5 가상계좌 발급 — CheckoutService.issueVirtualAccount

```jobflow
orchestrator: CheckoutService
Object: CheckoutService, OrderAccessPolicy, PaymentApi, OrderRepository, CatalogApi, CartApi, NotificationApi
CheckoutService.issueVirtualAccount --> OrderAccessPolicy.loadOwned
OrderAccessPolicy.loadOwned.notOwner
CheckoutService.issueVirtualAccount --> PaymentApi.issueVirtualAccount
PaymentApi.issueVirtualAccount.failed
PaymentApi.issueVirtualAccount.unknown
PaymentApi.issueVirtualAccount.issued --> OrderRepository.markWaitingDeposit
OrderRepository.markWaitingDeposit.lost --> PaymentApi.cancel
OrderRepository.markWaitingDeposit.done --> CatalogApi.extendReservation
OrderRepository.markWaitingDeposit.done --> CartApi.removeItems
OrderRepository.markWaitingDeposit.done --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderAccessPolicy.loadOwned`·`.notOwner` | `C-13` | 이어서 서비스가 상태 `PENDING_PAYMENT`·결제수단 `VIRTUAL_ACCOUNT`·`hold_until > 지금`을 본다 — 아니면 409 `INVALID_STATE`(그리지 않음) |
| `PaymentApi.issueVirtualAccount` | `C-11`·`C-12` | 트랜잭션 밖. `issueVirtualAccount(orderRef, amount, orderName, bankCode, depositorName, cashReceipt?)` — 입금기한 72시간, 30s. order는 매번 「발급 (재)요청」만 부르고 멱등 키·시도 번호는 정하지 않는다 — 첫 시도 `vbank:<orderId>`, PG 거절 뒤의 재요청과 은행 변경은 `vbank:<orderId>#<n>`, 결과 불명 뒤는 같은 키를 payment가 고른다([payment 상세 §2](payment.md#2-공개-계약) 「멱등」) |
| `.failed` | `C-11` | 오류로 끝나는 분기 — PG 거절(확정 실패) → 502 `PG_ERROR`. 주문은 `PENDING_PAYMENT` 그대로라 고객이 다시 누르면(은행을 바꿔도) 같은 계약을 다시 부르고, 새 시도의 키는 payment가 붙인다 |
| `.unknown` | `C-11` | 오류로 끝나는 분기 — 결과 불명 → 502 `PG_ERROR`. 고객이 다시 누르면 payment가 같은 키로 다시 보내 같은 계좌를 받는다(가정 — 상위 §6.3) |
| `.issued` → `OrderRepository.markWaitingDeposit` | `C-11` | 상위 `Order.issueVirtualAccount.issued`. `issued {bank, accountNumber, dueAt}`를 받아 아래 트랜잭션을 연다 |
| `OrderRepository.markWaitingDeposit`·`.done` | `R-11` | 트랜잭션 시작 — 조건부 `PENDING_PAYMENT → WAITING_DEPOSIT` + 은행·계좌·`vbank_due_at`·`deposit_checked_at` = 지금 기록 |
| `.done` → 셋 | `D-03`·`C-08`·`R-22` | 같은 트랜잭션 — `extendReservation('order:<orderId>', dueAt)`, 장바구니 정리, `VBANK_ISSUED`(`vbank-issued:<orderId>`). 연장이 `notHeld`면(방어 갈래 — `JF-4.1`과 같다) 롤백하고 `.lost`와 같이 처리한다 |
| `.lost` → `PaymentApi.cancel` | `C-11` | PG 발급 사이에 주문이 만료·취소됐다. 막 받은 계좌를 `cancel(orderRef, amount, '발급 중 주문 종료', 'vbank-void:<orderId>', 'VOID')`로 닫고 409 `INVALID_STATE`. 결과별 처리는 §3 「`PaymentApi.cancel` 결과 갈래」 표의 「발급 중 종료 폐기」 행 |

- **트리거** 상위 `Browser.chooseVirtualAccount`(§5.9). **완료 사실** 주문 `WAITING_DEPOSIT` + 가예약 입금기한까지 + 장바구니 정리 + 입금 안내 알림 — 한 트랜잭션.
- 값 분기 `.done`의 셋은 순차 호출이다. `.lost`는 `.done`과 택일이다.

### JF-6 주문 취소 — CancelService.cancelOrder

```jobflow
orchestrator: CancelService
Object: CancelService, OrderAccessPolicy, OrderSettlement, OrderRepository, PaymentApi
CancelService.cancelOrder --> OrderAccessPolicy.loadOwned
OrderAccessPolicy.loadOwned.notCancellable
OrderAccessPolicy.loadOwned.pendingPayment --> OrderSettlement.release
OrderAccessPolicy.loadOwned.pgLinked --> OrderRepository.beginCancelling
OrderRepository.beginCancelling.rejected
OrderRepository.beginCancelling.started --> PaymentApi.cancel
PaymentApi.cancel.cancelled --> OrderSettlement.release
PaymentApi.cancel.failed --> OrderRepository.revertCancelling
PaymentApi.cancel.rejected --> OrderRepository.moveToReview
PaymentApi.cancel.unknown
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderAccessPolicy.loadOwned` | `C-13`·`C-14` | 소유자가 아니면 403 `NOT_OWNER`(그리지 않음 — `JF-4`와 같다). 결과를 상태로 가른다 — `.pendingPayment`(결제 전), `.pgLinked`(PG 결제 건이 있는 `WAITING_DEPOSIT`, 또는 모든 품목이 `PAID`인 `PAID`), `.notCancellable`(그 밖 — 품목 하나라도 `PREPARING`·`SHIPPING`, `APPROVING`·`NET_CANCELLING`·`CANCELLING`·`MANUAL_REVIEW`·끝난 주문) → 409 `NOT_CANCELLABLE {status}` |
| 환불 계좌 검사(그리지 않음) | `C-14` | `.pgLinked`이고 상태 `PAID`·결제수단 `VIRTUAL_ACCOUNT`인데 `refundAccount`가 없으면 `beginCancelling` 전에 422 `REFUND_ACCOUNT_REQUIRED`. 계좌 형식(은행 코드 목록·숫자 10~16자리·예금주 1~20자)이 어긋나면 422 `VALIDATION_FAILED` |
| `.pendingPayment` → `OrderSettlement.release` | `R-20` | PG를 부르지 않는다. `PENDING_PAYMENT → CANCELLED` + 해제 → 200. 진 경우(그 사이 승인 시작·만료)는 409 `NOT_CANCELLABLE` |
| `.pgLinked` → `OrderRepository.beginCancelling`·`.rejected` | `C-14`·`R-13` | 트랜잭션 하나(상위 §6.3 ⑤) — 조건부 「`loadOwned`가 읽은 상태」(`PAID`이면 `fulfillment = NONE`까지) → `CANCELLING`. 직전 상태·취소 모드·사유·암호화한 환불 계좌를 기록한다. 그 사이 상품 준비·송장·입금 반영이 먼저 커밋됐으면 `.rejected` → 409 `NOT_CANCELLABLE {status}`(상위 `Order.cancelOrder.notCancellable`) |
| `PaymentApi.cancel` | `C-12` | 트랜잭션 밖. `PAID`면 `cancel(orderRef, amount, reason, 'cancel:<orderId>', 'REFUND', refundAccount?)`, `WAITING_DEPOSIT`이면 `cancel(orderRef, amount, reason, 'vbank-void:<orderId>', 'VOID')` |
| `.cancelled` → `OrderSettlement.release` | `C-14` | `CANCELLING → CANCELLED` + 재입고·쿠폰 복원 + (결제 완료였으면) 취소 알림 → 200 |
| `.failed` → `OrderRepository.revertCancelling` | `R-13` | 되돌림 — `CANCELLING →` 직전 상태 + 환불 계좌 지움. `ALREADY_DEPOSITED`(폐기하려던 가상계좌에 입금됨)면 입금 의심 표시도 달고 409 `ALREADY_DEPOSITED` — 웹훅이나 `JF-10C`가 `PAID`로 바꾼 뒤 고객이 환불 계좌를 넣어 다시 취소한다. `REFUND_ACCOUNT_REQUIRED`는 위 검사가 막아 나오지 않는 방어 갈래 → 422 |
| `.rejected` → `OrderRepository.moveToReview` | `C-14` | 상위 `Order.cancelOrder.refundFailed`의 거절 — `PG_REJECTED`·`NOT_CANCELLABLE`. `CANCELLING → MANUAL_REVIEW`(사유 = 코드) + 경보 `RECONCILE_STUCK` → 502 `REFUND_FAILED {code}`. 화면은 「취소 확인 중 — 고객센터가 연락드립니다」를 보이고, 운영자가 `JF-13`으로 닫는다 |
| `.unknown` | `C-14` | 보류로 끝나는 분기 — 상위 `Order.cancelOrder.refundFailed`의 결과 불명, 또는 같은 결제의 다른 취소가 진행 중(`CANCEL_IN_PROGRESS`). 주문은 `CANCELLING`으로 남고 202 `{status:'CANCELLING'}`. `JF-10B`가 닫는다 |

- **트리거** 상위 `Browser.cancelOrder`(§5.10) — 고객의 「주문 취소」와 PG 결제창 실패·닫기 복귀. **완료 사실** 주문 `CANCELLED` + (결제한 경우) 환불·폐기 + 재입고·쿠폰 복원 + 취소 알림.
- `OrderSettlement.release`로 들어오는 화살표 둘은 택일 경로(결제 전 / PG 취소 성공)의 **합류**다 — 주문 상태가 하나라 취소 한 번에 한 경로만 탄다.
- **준비·송장과 취소의 경합** `beginCancelling`과 `JF-7`의 `markPreparing`·`markShipping`은 같은 주문 행을 조건부로 갱신한다(`fulfillment` 열과 상태 열). 먼저 커밋한 쪽만 통과하므로 준비가 시작된 주문이 취소되거나 `CANCELLING` 주문에 준비·송장이 붙지 않는다.

### JF-7 상품 준비·송장·배송 조회·구매확정 — ShipmentService

```jobflow
orchestrator: ShipmentService
Object: ShipmentService, OrderAccessPolicy, ShipmentRepository, DeliveryTrackerGateway, OrderRepository, NotificationApi
ShipmentService.getTracking --> OrderAccessPolicy.loadOwned
OrderAccessPolicy.loadOwned.notOwner
ShipmentService.getTracking --> ShipmentRepository.findByOrder
ShipmentService.getTracking --> DeliveryTrackerGateway.track
DeliveryTrackerGateway.track.unavailable
ShipmentService.confirmLine --> OrderRepository.confirmLine
OrderRepository.confirmLine.notConfirmable
ShipmentService.prepareLines --> OrderRepository.markPreparing
OrderRepository.markPreparing.invalidState
ShipmentService.registerShipment --> OrderRepository.markShipping
OrderRepository.markShipping.invalidState
ShipmentService.registerShipment --> ShipmentRepository.insert
ShipmentService.registerShipment --> NotificationApi.enqueue
ShipmentService.applyDelivered --> ShipmentRepository.markDelivered
ShipmentService.applyDelivered --> OrderRepository.markLinesDelivered
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `getTracking` → `loadOwned`·`.notOwner`, `findByOrder` | `C-15`·`R-12` | 오류로 끝나는 분기 `.notOwner` → 403 `NOT_OWNER`, 없는 주문은 404(그리지 않음). 소유 검사 뒤 그 주문의 송장 목록 |
| `DeliveryTrackerGateway.track`·`.unavailable` | `R-12` | 송장마다 택배 조회(5s, 가정). 실패·타임아웃은 그 송장만 `UNAVAILABLE`이고 응답은 200이다. 결과를 저장하지 않는다 — 배송 완료 반영은 `JF-12`만 한다 |
| `confirmLine` → `OrderRepository.confirmLine`·`.notConfirmable` | `C-15`·`R-15` | 소유 검사는 `getTracking`과 같아 그리지 않았다. 조건부 `DELIVERED → CONFIRMED`(클레임 표시 `NONE`·`CLAIM_REJECTED`·`EXCHANGED`이고 재발송 대기가 아님) + `confirmed_at`·`confirm_type = MANUAL`. 아니면 409 `NOT_CONFIRMABLE` |
| `prepareLines` → `OrderRepository.markPreparing`·`.invalidState` | `C-15` | 운영자 발주 확인. 트랜잭션 하나 — 주문 행 조건부 갱신(상태 `PAID`·`PARTIALLY_RETURNED`, `fulfillment = NONE`이면 `PREPARING`으로) + 품목 `PAID → PREPARING` + `prepared_at`. 어긋난 품목이 있거나 주문이 `CANCELLING`이면 `.invalidState` → 409 `INVALID_STATE {lineId, status}` + 롤백. 이미 `PREPARING`인 품목은 그대로 둔다(멱등) |
| `registerShipment` → `OrderRepository.markShipping`·`.invalidState` | `C-15`·`R-21` | 트랜잭션 시작. 택배사 코드(`order.carriers`)·운송장 숫자 10~14자리 검사(422 `VALIDATION_FAILED`, 그리지 않음) 뒤 조건부 갱신 — 일반 출고는 주문 `PAID`·`PARTIALLY_RETURNED`이고 품목 `PAID`·`PREPARING`, 교환 재발송(`claimId`)은 품목 `DELIVERED`·클레임 표시 `EXCHANGED`·같은 `claimId`·재발송 대기·`exchange_sku_id` 있음. 품목 → `SHIPPING`, 주문 `fulfillment` → `PARTIAL`·`ALL`. 하나라도 어긋나면 `.invalidState` → 409 + 롤백 |
| `ShipmentRepository.insert` | `C-15` | 송장 행(`IN_TRANSIT`)과 `items[{lineId, skuId}]` — 일반 출고는 품목의 `sku_id`, 교환 재발송은 `exchange_sku_id`(운영 상세와 배송 알림이 「무엇을 보냈는지」를 이 값으로 보인다). `(carrier_code, tracking_number)` 유일 — 같은 운송장을 두 번 넣으면 409 `DUPLICATE_TRACKING` |
| `NotificationApi.enqueue` | `R-22` | `SHIPPING_STARTED`(주문 상세 링크 `/orders/{orderId}`, `dedupKey` `shipping-started:<shipmentId>`). 트랜잭션 끝 |
| `applyDelivered` → `markDelivered`·`markLinesDelivered` | `R-24` | `JF-12`가 부른다. 트랜잭션 하나 — 송장 `DELIVERED` + 그 송장 품목 `SHIPPING → DELIVERED` + `delivered_at`(택배사가 준 배송 완료 시각). 재발송 품목은 재발송 대기 표시를 지운다. 이미 반영됐으면 둘 다 0행이라 효과가 없다 |

- **트리거** 상위 `Browser.openTracking`·`AdminBrowser.registerShipment`(§5.11), `Browser.confirmPurchase`(§5.13), 운영 화면 「상품 준비」, `JF-12`의 배송 완료 판정. **완료 사실** 배송 단계 응답, 품목 `CONFIRMED`, 품목 `PREPARING`, 품목 `SHIPPING` + 송장 + 배송 시작 알림, 품목 `DELIVERED`.
- 다섯 진입은 서로 다른 계약이다. `OrderRepository`·`ShipmentRepository`로 들어오는 여러 화살표는 서로 다른 메서드라 합류가 아니다. `listCarriers`(설정 목록 읽기)는 그리지 않았다.
- `registerShipment`의 줄 순서(갱신 → 송장 행 → 알림)는 실제 호출 순서다. `.invalidState`는 예외라 그 뒤 두 호출이 일어나지 않는다.

### JF-8 주문 조회·비회원 토큰 — OrderQueryService

```jobflow
orchestrator: OrderQueryService
Object: OrderQueryService, GuestAccess, OrderAccessPolicy, ShipmentRepository, OrderRepository
OrderQueryService.lookupGuestOrder --> GuestAccess.open
GuestAccess.open.notFound
GuestAccess.open.locked
OrderQueryService.getOrder --> OrderAccessPolicy.loadOwned
OrderAccessPolicy.loadOwned.notOwner
OrderQueryService.getOrder --> ShipmentRepository.findByOrder
OrderQueryService.listMyOrders --> OrderRepository.findByMember
OrderQueryService.searchAdmin --> OrderRepository.search
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `lookupGuestOrder` → `GuestAccess.open` | `C-13`·`R-16`·`D-07` | 주문번호로 접근 행을 찾아 비밀번호 해시를 비교한다. 맞으면 실패 횟수를 0으로 하고, 요청의 `GOT`가 유효하면 그 토큰에 주문을 더하고 수명을 갱신한다(없으면 새 토큰 — 무작위 32바이트, 해시만 저장, 30분) → 200 `{orderId}` + 쿠키. 상위 `Order.lookupGuestOrder.result` |
| `.notFound` | `R-16` | 오류로 끝나는 분기 — 번호가 없거나 비밀번호가 틀렸다 → 404. 틀리면 실패 횟수 +1, 10회째에 `locked_until` = 지금 + 30분. 없는 번호도 더미 해시 비교를 해 응답 시간으로 가를 수 없게 한다 |
| `.locked` | `R-16` | 오류로 끝나는 분기 — 잠금 중이면 비밀번호가 맞아도 429 `LOCKED {until}` |
| `getOrder` → `loadOwned`·`.notOwner` | `C-13`·`R-17`·`D-07` | 비회원 주체면 요청 주문 ∈ `guestOrderIds`인지 본다(주체는 mall-api가 `resolveGuestToken`으로 이미 풀었다). 403 `NOT_OWNER`가 상위 `Order.getOrder.notOwner`다(화면이 `OrderList`로 간다). 404는 그리지 않음 |
| `getOrder` → `ShipmentRepository.findByOrder` | `R-12` | 상세에 송장 목록을 붙인다(택배 조회는 하지 않는다 — `JF-7`) |
| `listMyOrders` → `OrderRepository.findByMember` | `R-12` | 회원 ID·기간·페이지(20건). 비회원 주문은 나오지 않는다 |
| `searchAdmin` → `OrderRepository.search` | `R-21` | 운영 주문 검색(`MANUAL_REVIEW` 필터 포함). 운영 상세(`getAdminOrder`)는 소유 검사 없이 같은 상세 조회에 상태 이력·운영 확인 사유를 더한 것이라 그리지 않았다 |

- **트리거** 상위 `Browser.lookupGuestOrder`·`Browser.openOrderDetail`·`Browser.openOrderList`(§5.14), 운영 화면 주문 검색. **완료 사실** 조회 응답 또는 조회 토큰 1개(주문 ID 목록에 한 건 추가).
- 한 조회 토큰은 같은 브라우저의 비회원 주문을 최대 5개 가리킨다 — 다섯을 넘으면 가장 오래 더한 주문을 뺀다. 토큰으로 할 수 있는 일은 그 주문들의 조회·승인·가상계좌 발급·취소·배송 조회·구매확정과 claim의 반품·교환 신청이다.

### JF-9 입금 웹훅 — PgWebhookService.handlePgWebhook

```jobflow
orchestrator: PgWebhookService
Object: PgWebhookService, PaymentApi, OrderRepository, NoticePolicy, OrderSettlement
PgWebhookService.handlePgWebhook --> PaymentApi.verifyNotice
PaymentApi.verifyNotice.rejected
PaymentApi.verifyNotice.unavailable
PaymentApi.verifyNotice.ignored
PgWebhookService.handlePgWebhook --> OrderRepository.findById
PgWebhookService.handlePgWebhook --> NoticePolicy.decide
NoticePolicy.decide.settle --> OrderSettlement.settlePaid
NoticePolicy.decide.release --> OrderSettlement.release
NoticePolicy.decide.review --> OrderRepository.moveToReview
NoticePolicy.decide.retryLater
NoticePolicy.decide.noop
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PaymentApi.verifyNotice` | `C-11`·`C-12` | 트랜잭션 밖. 서명 확인 + PG 조회로 실제 상태 확인과 분류(payment). 결과는 모두 반환 값이다([payment 상세 §2](payment.md#2-공개-계약)) — `deposited {orderRef, amount, depositedAt}`·`expired {orderRef}`·`cancelled {orderRef, cancelledAt, ours}`·`ignored {reason}`·`duplicate {first}`·`rejected {reason}`·`unavailable`. `ours`는 payment가 우리 취소 기록과 대조한 값이다 — 같은 결제의 우리 취소 기록(부분 취소 포함)의 합이 결제액과 같으면 `true` |
| `.rejected` | `C-11`·`R-19` | 오류로 끝나는 분기 — 형식·서명 불일치 → 400 `INVALID_SIGNATURE`. 주문을 읽지 않는다 |
| `.unavailable` | `C-11` | 오류로 끝나는 분기 — PG 조회·기록 실패 → 503 `RETRY_LATER`. payment가 이벤트를 기록하지 않았으므로 PG가 다시 보내면 처음처럼 검증한다(가정 — 업체 재전송 정책) |
| `.ignored` | `C-11` | 반영하지 않고 끝나는 분기 — 관심 없는 이벤트(카드 `DONE`, 모르는 주문 등) → 200. 중복 통보는 여기로 오지 않는다 |
| `duplicate {first}`(그리지 않음) | `R-19` | 같은 이벤트 ID가 다시 왔다 — `first`(처음 검증한 사실)를 꺼내 그 사실의 갈래로 그대로 진행해 조건부 전이를 다시 시도한다. 첫 통보의 반영이 롤백됐으면 이 통보가 메우고, 이미 반영됐으면 `lost`·`.noop`으로 200이다. `first`가 `ignored`면 200 |
| `OrderRepository.findById` | `R-19` | `orderRef`의 주문 ID로 현재 상태·금액·직전 상태(`cancel_from_status`)·`fulfillment`를 읽는다 |
| `NoticePolicy.decide` | `R-19`·`C-11` | 순수 판단 — 아래 판단표. 상위 `Order.handlePgWebhook --> Order.settle`이 `.settle`(확정)·`.release`(해제)다 |
| `.settle` → `OrderSettlement.settlePaid` | `R-19` | `settlePaid(orderId, WAITING_DEPOSIT)`(`JF-4.1`) → 200. `lost`면 다시 읽어 한 번 더 판단한다. `retryable`이면 입금 의심 표시 → 200(`JF-10C`가 다시 확정한다). `unsettlable`(가예약 없음 — 상위 `Order.settle.unsettlable`)이면 `moveToReview`(사유 `DEPOSIT_COMMIT_FAILED`) → 200 |
| `.release` → `OrderSettlement.release` | `R-19` | `WAITING_DEPOSIT → EXPIRED`, 또는 폐기 요청 중(`CANCELLING`, 직전 `WAITING_DEPOSIT`)이면 `CANCELLING → CANCELLED` — PG가 계좌를 닫았으니 폐기 완료로 본다. `lost`면 200 |
| `.review` → `OrderRepository.moveToReview` | `R-19`·`C-11` | 마감 뒤 입금·금액 불일치·우리가 시작하지 않은 PG 취소(`ours:false`) → `MANUAL_REVIEW` + 경보 `RECONCILE_STUCK` → 200 |
| `.retryLater` | `C-11` | 오류로 끝나는 분기 — 폐기 요청 중(`CANCELLING`, 직전 `WAITING_DEPOSIT`) 입금 통보 → 503 `RETRY_LATER`(상위 §5.9 `Order.handlePgWebhook`의 503 갈래). 이 순간에는 `settlePaid(WAITING_DEPOSIT)`가 통과하지 못하는데 200으로 받으면 PG 재전송이 끊기므로, 우리 폐기가 `ALREADY_DEPOSITED`로 끝나 `WAITING_DEPOSIT` + 입금 의심으로 돌아간 뒤 PG 재전송(가정)이나 `JF-10C`가 확정하게 둔다 |
| `.noop` | `C-11` | 반영하지 않고 끝나는 분기 — 이미 반영됐거나 이 상태에서 할 일이 없다 → 200. 이력만 남긴다 |

**끝난 상태**는 `PAYMENT_FAILED`·`EXPIRED`·`CANCELLED`·`RETURNED`다 — 결제 흐름이 닫혀 이 판단표에서 확정·해제할 일이 없는 상태. `PAID`·`PARTIALLY_RETURNED`는 품목 진행이 남아 있어 끝난 상태로 치지 않고 따로 적었다.

| 사실 | 주문 상태 | 결정 |
|---|---|---|
| `deposited`, 입금액 = 주문 금액 | `WAITING_DEPOSIT` | `.settle` |
| `deposited`, 입금액 ≠ 주문 금액 | `WAITING_DEPOSIT` | `.review`(사유 `DEPOSIT_AMOUNT_MISMATCH`) |
| `deposited` | `CANCELLING`(직전 `WAITING_DEPOSIT`) | `.retryLater` |
| `deposited` | `CANCELLING`(직전 `PAID`) | `.noop` — 이미 반영한 입금이고 환불이 진행 중이다. `JF-10B`가 닫는다 |
| `deposited` | `PAID`·`PARTIALLY_RETURNED`·`MANUAL_REVIEW` | `.noop` — 이미 반영했거나 운영자가 볼 주문이다 |
| `deposited` | `PAYMENT_FAILED`·`EXPIRED`·`CANCELLED`, 그리고 입금을 기다리지 않던 `PENDING_PAYMENT` | `.review`(사유 `DEPOSIT_AFTER_CLOSE` — 환불 대상) |
| `deposited` | `RETURNED` | `.noop` — 반품으로 결제액이 모두 환불된 주문이라 PG가 이 사실을 새로 주지 않는다(방어 갈래) |
| `expired` | `WAITING_DEPOSIT`, 또는 `CANCELLING`(직전 `WAITING_DEPOSIT`) | `.release` |
| `expired` | 그 밖 | `.noop` |
| `cancelled` | `CANCELLING`·`NET_CANCELLING` | `.noop` — 우리 취소가 진행 중이다. `JF-10B`가 PG 사실로 닫는다(`ours`와 상관없이) |
| `cancelled` | `PARTIALLY_RETURNED`·`RETURNED`·`MANUAL_REVIEW`, 그 밖의 끝난 상태(`PAYMENT_FAILED`·`EXPIRED`·`CANCELLED`), `PENDING_PAYMENT` | `.noop` — 이미 닫혔거나 클레임·운영자·만료 타이머가 닫는다 |
| `cancelled`, `ours:true` | `PAID` | `.noop` — 클레임 환불(부분 취소 합 = 결제액)의 PG 취소는 끝났고 claim의 완료 트랜잭션이 아직 커밋 전이다. 그 트랜잭션이 `markLineClaim(RETURNED)`로 주문을 `RETURNED`로 바꾼다 |
| `cancelled`, `ours:true` | `WAITING_DEPOSIT` | `.release`(→ `EXPIRED`) — 만료 폐기(`JF-11`)가 결과 불명이었다가 PG에서 닫혔다 |
| `cancelled`, `ours:false` | `PAID`·`WAITING_DEPOSIT`·`APPROVING` | `.review`(사유 `FOREIGN_CANCEL` — 우리가 시작하지 않은 PG 콘솔 취소) |

- **트리거** 상위 `PG.OnDepositNotice`(§5.9). **완료 사실** 입금 → 주문 `PAID`(`JF-4.1`), 기한 경과·우리 폐기 완료 통보 → `EXPIRED`·`CANCELLED`, 사람이 봐야 하는 통보 → `MANUAL_REVIEW`, 그 밖은 기록만.
- **같은 사실은 같은 결과** `WAITING_DEPOSIT`·`APPROVING` 주문의 PG `cancelled`는 웹훅으로 오든 대사(`JF-10A`·`JF-10C`)의 조회로 알든 우리 취소 기록이 없으면 `MANUAL_REVIEW`(`FOREIGN_CANCEL`), 우리 만료 폐기면 `EXPIRED`다. PG가 `notApproved`·`expired`면 기존대로 만료·실패다. 웹훅은 payment의 `ours`로, 대사는 order의 폐기 요청 표시(`void_requested_at` — `JF-11`이 `VOID`를 부르기 전에 남긴다)로 가르는데, payment의 폐기 기록은 그 표시 뒤에만 생기므로 두 판정이 같다.
- **멱등** 같은 웹훅이 두 번 오면 payment가 이벤트 ID로 `duplicate {first}`를 주고 order는 `first`로 다시 판단한다. 동시 도착은 `settlePaid`·`release`의 조건부 전이가 한 번만 통과시킨다(`R-19`).
- **만료 경합** 만료 타이머(`JF-11`)가 가상계좌를 닫고 `EXPIRED`로 바꾸기 전에 입금 웹훅이 오면, 웹훅의 `WAITING_DEPOSIT → PAID`가 이기고 타이머의 해제는 `lost`가 된다. PG가 입금을 받았다는 사실(`verifyNotice`의 PG 조회)이 우선이다.

### JF-10 대사 타이머 — OrderJobs.onReconcileTick

한 틱이 세 묶음을 차례로 처리한다. `JF-10A`는 PG 승인 결과를 모르는 주문, `JF-10B`는 PG 취소를 요청한 주문, `JF-10C`는 입금을 확인해야 하는 가상계좌 주문이다. 주문마다 PG에 한 번 묻고, 필요하면 같은 멱등 키로 한 번 다시 부른다. 주문 하나의 처리는 짧은 트랜잭션 하나로 끝나고, 틱의 시간 예산 3분을 넘으면 새 주문을 고르지 않는다(남은 주문은 다음 틱). mall-api 스케줄러가 인스턴스 하나에서만 돌리고 잠금 `lockAtMostFor`는 예산보다 긴 5분이다(상위 §4.3). `MANUAL_REVIEW` 주문은 어느 묶음도 고르지 않는다.

**결론 없는 시도의 상한** 대사·만료가 한 주문에서 결론을 내지 못할 때마다(`unknown`·`CANCEL_IN_PROGRESS`·확정 일시 오류) `reconcile_attempts`를 1 올리고, 10회(잠정)를 넘으면 `moveToReview`(사유 `ATTEMPTS_EXCEEDED`) + 경보 `RECONCILE_STUCK`이다. 상태가 바뀌면 0으로 돌아간다.

#### JF-10A 승인 결과 불명

```jobflow
orchestrator: OrderJobs
Object: OrderJobs, PaymentApi, OrderSettlement, OrderRepository
OrderJobs.onReconcileTick --> OrderRepository.findApproving
OrderJobs.onReconcileTick --> PaymentApi.queryPayment
PaymentApi.queryPayment.notApproved --> OrderSettlement.release
PaymentApi.queryPayment.cancelled --> OrderRepository.moveToReview
PaymentApi.queryPayment.unknown --> OrderRepository.countAttempt
PaymentApi.queryPayment.paid --> OrderSettlement.settlePaid
OrderSettlement.settlePaid.unsettlable --> OrderRepository.beginNetCancel
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderRepository.findApproving` | `R-18` | `APPROVING`이 된 지(`state_changed_at`) 1분 넘은 주문, 오래된 순 최대 50건 |
| `PaymentApi.queryPayment` | `C-10`·`C-12` | 주문마다 `queryPayment(orderRef {orderId, orderNo})`(5s) |
| `.notApproved` → `OrderSettlement.release` | `R-18` | PG가 승인하지 않았다(`ABORTED`·`EXPIRED`·결제 없음). 상위 `Order.OnReconcileTick --> Order.settle`의 `.released`. `APPROVING → PAYMENT_FAILED` + 해제 |
| `.cancelled` → `OrderRepository.moveToReview` | `R-18`·`C-10` | PG는 승인 뒤 취소됐다고 답한다. `APPROVING` 주문에는 우리 취소 기록이 있을 수 없다(망취소는 `NET_CANCELLING`에서만 PG를 부른다) — 우리가 시작하지 않은 PG 콘솔 취소다. `APPROVING → MANUAL_REVIEW`(사유 `FOREIGN_CANCEL`) + 경보 `RECONCILE_STUCK`. 같은 사실이 웹훅으로 와도 같은 결과다(`JF-9` 판단표) |
| `.unknown` → `OrderRepository.countAttempt` | `D-04` | 결과 불명 — settle에 들어가지 않는다. 시도 +1, 상한을 넘으면 `MANUAL_REVIEW`(위 「상한」). 아니면 다음 틱에 다시 |
| `.paid` → `OrderSettlement.settlePaid` | `C-10` | 상위 `Order.settle.paid`. `settlePaid(orderId, APPROVING)`(`JF-4.1`). `lost`면 고객 요청이 먼저 확정했거나 망취소를 시작했다 — 할 일이 없다. `retryable`이면 시도 +1, 다음 틱 |
| `.unsettlable` → `OrderRepository.beginNetCancel` | `C-10`·`R-18` | 상위 `Order.settle.unsettlable` — 확정 불가(`notHeld`). 조건부 `APPROVING → NET_CANCELLING`. PG 취소는 `JF-10B`가 다음 틱에 부른다 — 망취소를 시작하는 곳은 이 조건부 전이 하나이고, PG를 부르는 곳도 `JF-4`의 첫 시도와 `JF-10B`뿐이다 |

- **트리거** 대사 타이머 1분(상위 `Order.OnReconcileTick`). **완료 사실** 대상 주문이 `PAID`·`PAYMENT_FAILED`·`NET_CANCELLING`·`MANUAL_REVIEW`가 되거나, 시도 횟수만 올라 그대로 남는다.
- `queryPayment` 화살표 하나가 대상 주문 수만큼의 실제 재호출이다. 반복은 그리지 않았다. 고객의 승인 요청과 대사가 같은 주문에 겹쳐도 `settlePaid`의 조건부 전이가 한 번만 확정한다.
- `JF-4`의 확정 일시 오류(202)로 `APPROVING`에 남은 주문도 여기로 온다 — PG는 `paid`라 다시 확정한다.

#### JF-10B PG 취소 재시도

```jobflow
orchestrator: OrderJobs
Object: OrderJobs, PaymentApi, OrderSettlement, OrderRepository
OrderJobs.onReconcileTick --> OrderRepository.findPgCancelPending
OrderJobs.onReconcileTick --> PaymentApi.queryPayment
PaymentApi.queryPayment.closed --> OrderSettlement.release
PaymentApi.queryPayment.stillOpen --> PaymentApi.cancel
PaymentApi.cancel.cancelled --> OrderSettlement.release
PaymentApi.cancel.failed --> OrderRepository.revertCancelling
PaymentApi.cancel.rejected --> OrderRepository.moveToReview
PaymentApi.cancel.unknown --> OrderRepository.countAttempt
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderRepository.findPgCancelPending` | `C-10`·`C-14` | 1분 넘은 `CANCELLING` 주문과 `NET_CANCELLING` 주문, 최대 50건 |
| `PaymentApi.queryPayment` | `C-12` | `queryPayment(orderRef)`. 주문 취소·망취소는 모두 **전액**이라, 결과 불명을 다시 부르기 전에 PG 사실로 먼저 닫을 수 있다([payment 상세 §2](payment.md#2-공개-계약)). 조회가 `unknown`이면 시도 +1, 다음 틱(그리지 않음) |
| `.closed` → `OrderSettlement.release` | `C-14`·`R-18` | PG `cancelled`, 또는 폐기(`VOID`)인데 `notApproved`(계좌가 이미 닫힘). `CANCELLING → CANCELLED`(+ 결제 완료였으면 취소 알림), `NET_CANCELLING → PAYMENT_FAILED` |
| `.stillOpen` → `PaymentApi.cancel` | `C-12` | PG `paid`·`waitingDeposit` — 취소가 아직 일어나지 않았다. 처음과 같은 인자(저장한 모드·사유·암호화한 환불 계좌)와 같은 멱등 키(`cancel:`·`vbank-void:`·`netcancel:<orderId>`)로 다시 부른다. payment는 정해진 결과를 돌려주거나 같은 PG 키로 다시 부른다 |
| `.cancelled` → `OrderSettlement.release` | `C-14`·`R-18` | `.closed`와 같다 |
| `.failed` → `OrderRepository.revertCancelling` | `R-13` | `ALREADY_DEPOSITED` — `CANCELLING → WAITING_DEPOSIT` + 입금 의심 표시(`JF-10C`가 확정). `REFUND_ACCOUNT_REQUIRED`는 방어 갈래 — 직전 상태로 되돌리고 경보 `CANCEL_FAILED` |
| `.rejected` → `OrderRepository.moveToReview` | `C-10`·`C-14` | `PG_REJECTED`·`NOT_CANCELLABLE` → `MANUAL_REVIEW` + 경보 `RECONCILE_STUCK`. 망취소 거절이면 돈은 빠졌고 주문은 확정되지 않았다 — 운영자가 PG 콘솔에서 환불한 뒤 `RELEASE` |
| `.unknown` → `OrderRepository.countAttempt` | `C-14` | `unknown`·`CANCEL_IN_PROGRESS` — 시도 +1, 상한을 넘으면 `MANUAL_REVIEW`. 아니면 다음 틱 |

- **트리거** 같은 대사 틱의 둘째 묶음. **완료 사실** 취소 요청 주문이 `CANCELLED`·`PAYMENT_FAILED`·직전 상태·`MANUAL_REVIEW`가 되거나 시도 횟수만 오른다. `NET_CANCELLING`은 여기서만 닫힌다(PG 취소 상태로 → `PAYMENT_FAILED`).
- `queryPayment`·`cancel` 화살표는 대상 주문 수만큼의 실제 재호출이다(같은 멱등 키라 중복 효과가 없다). `OrderRepository`로 들어오는 셋은 서로 다른 메서드다. `OrderSettlement.release`로 들어오는 둘은 택일 경로(조회로 닫힘 / 재호출로 닫힘)의 합류다.

#### JF-10C 입금 확인

```jobflow
orchestrator: OrderJobs
Object: OrderJobs, PaymentApi, OrderSettlement, OrderRepository
OrderJobs.onReconcileTick --> OrderRepository.findDepositCheck
OrderJobs.onReconcileTick --> PaymentApi.queryPayment
PaymentApi.queryPayment.closed --> OrderSettlement.release
PaymentApi.queryPayment.foreignCancel --> OrderRepository.moveToReview
PaymentApi.queryPayment.waitingDeposit --> OrderRepository.markDepositChecked
PaymentApi.queryPayment.paid --> OrderSettlement.settlePaid
OrderSettlement.settlePaid.unsettlable --> OrderRepository.moveToReview
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderRepository.findDepositCheck` | `C-11`·`R-19` | `WAITING_DEPOSIT` 가운데 ① 입금 의심 표시가 있는 주문(만료 폐기·고객 취소가 `ALREADY_DEPOSITED`였거나, 웹훅 확정이 일시 오류였다) ② 마지막 조회(`deposit_checked_at`)가 1시간 넘은 주문 — 웹훅 유실 대비. 최대 50건 |
| `PaymentApi.queryPayment` | `C-11`·`C-12` | `queryPayment(orderRef)`. `unknown`이면 의심 주문만 시도 +1, 다음 틱(그리지 않음) |
| `.closed` → `OrderSettlement.release` | `C-11` | PG `notApproved`(계좌가 닫힘), 또는 `cancelled`인데 주문에 폐기 요청 표시(`void_requested_at`)가 있다 — 우리 만료 폐기가 PG에서 닫혔다. 만료 경로와 같이 `WAITING_DEPOSIT → EXPIRED` + 해제(상위 `Order.OnReconcileTick --> Order.settle`의 `.released`) |
| `.foreignCancel` → `OrderRepository.moveToReview` | `C-11` | PG `cancelled`인데 폐기 요청 표시가 없다 — 우리가 시작하지 않은 PG 콘솔 취소. `WAITING_DEPOSIT → MANUAL_REVIEW`(사유 `FOREIGN_CANCEL`) + 경보 `RECONCILE_STUCK`. 같은 사실이 웹훅으로 와도 같은 결과다(`JF-9` 판단표의 `ours:false`) |
| `.waitingDeposit` → `OrderRepository.markDepositChecked` | `R-19` | 입금이 아직 없다. `deposit_checked_at` = 지금, 입금 의심 표시를 지운다 — 기한이 지났으면 만료 타이머가 다시 닫는다 |
| `.paid` → `OrderSettlement.settlePaid` | `R-19` | 상위 `Order.settle.paid`. 입금액 = 주문 금액이면 `settlePaid(orderId, WAITING_DEPOSIT)` — 웹훅을 잃어도 입금이 반영된다. 금액이 다르면 `moveToReview`(사유 `DEPOSIT_AMOUNT_MISMATCH`, 그리지 않음). `retryable`이면 시도 +1, 다음 틱 |
| `.unsettlable` → `OrderRepository.moveToReview` | `R-19` | 상위 `Order.settle.unsettlable` — 돈은 들어왔는데 가예약이 없다 → `MANUAL_REVIEW`(사유 `DEPOSIT_COMMIT_FAILED`) |

- **트리거** 같은 대사 틱의 셋째 묶음. **완료 사실** 입금된 주문이 `PAID`, 계좌가 닫힌 주문이 `EXPIRED`, PG 콘솔에서 취소된 주문이 `MANUAL_REVIEW`, 나머지는 조회 시각만 바뀐다.
- `OrderRepository.moveToReview`로 들어오는 둘은 서로 다른 갈래(콘솔 취소 / 확정 불가 입금)의 택일이다.
- 1시간 주기 조회는 입금 대기 주문 하나당 입금기한 72시간 동안 많아야 72번의 PG 조회다(설계상 예상). 웹훅이 오면 그 전에 `PAID`가 되어 대상에서 빠진다.

### JF-11 만료 타이머 — OrderJobs.onExpiryTick

```jobflow
orchestrator: OrderJobs
Object: OrderJobs, OrderRepository, OrderSettlement, PaymentApi
OrderJobs.onExpiryTick --> OrderRepository.findExpired
OrderJobs.onExpiryTick --> OrderSettlement.release
OrderJobs.onExpiryTick --> PaymentApi.cancel
PaymentApi.cancel.cancelled --> OrderSettlement.release
PaymentApi.cancel.failed --> OrderRepository.flagDepositSuspected
PaymentApi.cancel.rejected --> OrderRepository.moveToReview
PaymentApi.cancel.unknown --> OrderRepository.countAttempt
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderRepository.findExpired` | `R-20`·`R-19` | `PENDING_PAYMENT`이고 `hold_until < 지금`인 주문과, `WAITING_DEPOSIT`이고 `vbank_due_at < 지금`이며 입금 의심 표시가 없는 주문, 각각 최대 100건. 시간 예산 3분 안에서 주문마다 짧은 트랜잭션으로 처리한다 |
| `onExpiryTick` → `OrderSettlement.release` | `R-20` | `PENDING_PAYMENT → EXPIRED` + 해제. PG를 부르지 않는다(인증만 한 결제는 돈이 빠지지 않았다) |
| `onExpiryTick` → `PaymentApi.cancel` | `C-11` | `WAITING_DEPOSIT`만 — 먼저 가상계좌를 닫는다. 부르기 전에 짧은 트랜잭션으로 폐기 요청 표시 `void_requested_at`을 남기고(그리지 않음 — `JF-9`·`JF-10C`가 PG `cancelled`를 「우리 폐기」로 가르는 근거), `cancel(orderRef, amount, '입금기한 만료', 'vbank-void:<orderId>', 'VOID')` |
| `.cancelled` → `OrderSettlement.release` | `R-19` | `WAITING_DEPOSIT → EXPIRED` + 해제. `lost`면 그 사이 웹훅이 `PAID`로 바꿨거나 고객이 취소를 시작한 것이다 |
| `.failed` → `OrderRepository.flagDepositSuspected` | `C-11` | `ALREADY_DEPOSITED` — 기한 직전 입금이다. 만료하지 않고 입금 의심 표시만 단다 — 웹훅이나 `JF-10C`가 `PAID`로 닫는다(상위 §5.9 경합) |
| `.rejected` → `OrderRepository.moveToReview` | `C-11` | `PG_REJECTED`·`NOT_CANCELLABLE` → `WAITING_DEPOSIT → MANUAL_REVIEW` + 경보 `RECONCILE_STUCK` |
| `.unknown` → `OrderRepository.countAttempt` | `C-11` | 닫혔는지 모르니 만료하지 않는다. 시도 +1, 상한을 넘으면 `MANUAL_REVIEW`. 아니면 다음 틱에 같은 키로 다시 |

- **트리거** 만료 타이머 1분(상위 `Order.OnExpiryTick`). **완료 사실** 결제하지 않은 주문과 기한이 지난 가상계좌 주문이 `EXPIRED`, 가예약·점유가 풀린다.
- `OrderSettlement.release`로 들어오는 화살표 둘은 같은 틱 안의 **서로 다른 주문**에 대한 호출이다(결제 대기 만료 / 가상계좌 만료). 한 주문은 상태가 하나라 한쪽만 탄다.
- `APPROVING`·`NET_CANCELLING`·`CANCELLING`·`MANUAL_REVIEW` 주문은 만료하지 않는다 — PG 사실을 모르는 채 해제하면 결제된 주문의 재고를 놓친다. 앞의 셋은 `JF-10`이, 마지막은 운영자(`JF-13`)가 닫는다.

### JF-12 배송 타이머 — OrderJobs.onDeliveryTick

```jobflow
orchestrator: OrderJobs
Object: OrderJobs, ShipmentRepository, DeliveryTrackerGateway, ShipmentService, OrderRepository
OrderJobs.onDeliveryTick --> ShipmentRepository.findInTransit
OrderJobs.onDeliveryTick --> DeliveryTrackerGateway.track
DeliveryTrackerGateway.track.delivered --> ShipmentService.applyDelivered
DeliveryTrackerGateway.track.failed
OrderJobs.onDeliveryTick --> OrderRepository.autoConfirm
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ShipmentRepository.findInTransit` | `R-24` | `IN_TRANSIT` 송장, 마지막 조회가 오래된 순 최대 200건 |
| `DeliveryTrackerGateway.track` | `R-24` | 송장마다 택배 조회(5s, 가정). 배송 중이면 마지막 조회 시각만 적는다(그리지 않음) |
| `.delivered` → `ShipmentService.applyDelivered` | `R-24` | 배송 완료면 `JF-7`의 `applyDelivered` — 송장·품목 `DELIVERED` |
| `.failed` | `R-24` | 보류로 끝나는 분기 — 조회 실패는 저장하지 않고 다음 틱에 다시. 송장 등록 뒤 14일 동안 배송 완료가 없으면 경보 `DELIVERY_STALE` |
| `OrderRepository.autoConfirm` | `R-24`·`C-15` | 한 번의 조건부 갱신 — `DELIVERED`이고 `delivered_at + 7일 < 지금`이며 클레임 표시가 `NONE`·`CLAIM_REJECTED`·`EXCHANGED`이고 재발송 대기가 아닌 품목 → `CONFIRMED`(`confirm_type = AUTO`) |

- **트리거** 배송 타이머 30분(상위 `Order.OnDeliveryTick`). **완료 사실** 품목 `DELIVERED`(배송 완료 시각 기록), 7일 지난 품목 `CONFIRMED`. 30분 주기라 배송 완료는 1시간 안에 반영된다(`R-24`).
- **경합** 자동 확정과 반품 신청(`markLineClaim`)·수동 구매확정은 같은 품목 행의 조건부 갱신이라 먼저 커밋한 쪽만 통과한다. 반품이 이기면 그 품목은 자동 확정 대상에서 빠지고, 자동 확정이 이기면 반품 신청은 `conflict`가 된다.
- `track` 화살표 하나가 송장 수만큼의 실제 재호출이다.

### JF-13 운영 확인 처리 — ManualReviewService.resolve

```jobflow
orchestrator: ManualReviewService
Object: ManualReviewService, OrderRepository, OrderSettlement
ManualReviewService.resolve --> OrderRepository.findById
OrderRepository.findById.notAllowed
OrderRepository.findById.notReleasable
ManualReviewService.resolve --> OrderSettlement.settlePaid
OrderSettlement.settlePaid.unsettlable
ManualReviewService.resolve --> OrderSettlement.release
ManualReviewService.resolve --> OrderRepository.restoreFromReview
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderRepository.findById`·`.notAllowed` | `C-10`·`C-11`·`C-14` | 상태·`review_reason`·`review_from_status`를 읽는다. `MANUAL_REVIEW`가 아니거나 아래 표에서 그 `action`을 받지 않으면 `.notAllowed` → 409 `INVALID_STATE {status}` |
| `.notReleasable` | `C-14`·`C-15` | 오류로 끝나는 분기 — `RELEASE`인데 품목이 하나라도 `PREPARING` 이후다(`fulfillment ≠ NONE`). 해제는 품목을 `CANCELLED`로 바꾸는데 품목 상태 기계에 `PREPARING`·`SHIPPING` 이후 → `CANCELLED` 전이가 없다 → 409 `NOT_RELEASABLE`. 운영자는 `CONFIRM_PAID`(→ `PAID`)로 되돌린 뒤 클레임(반품) 절차로 처리한다 |
| `OrderSettlement.settlePaid` | `C-10`·`C-11` | `CONFIRM_PAID` — 운영자가 PG 콘솔에서 결제·입금을 확인했다. `settlePaid(orderId, MANUAL_REVIEW)`(`JF-4.1`) → 200 `PAID`. `retryable`이면 503 `RETRY_LATER`(그리지 않음) |
| `.unsettlable` | `D-03` | 오류로 끝나는 분기 — 가예약이 없어 확정 불가 → 409 `NOT_SETTLEABLE`. 운영자는 PG 콘솔에서 환불한 뒤 `RELEASE`를 누른다 |
| `OrderSettlement.release` | `C-14`·`R-20` | `RELEASE` — 운영자가 PG 콘솔에서 취소·환불(또는 미결제)을 확인했다. `release(orderId, MANUAL_REVIEW, to)`(`JF-4.2`) |
| `OrderRepository.restoreFromReview` | `C-14` | 해제·확정 효과 없이 상태만 되돌린다 — 이미 확정된 주문을 `PAID`로, 이미 해제된 주문을 원래 끝 상태로 |

| 들어온 곳(`review_from_status`) | `CONFIRM_PAID` | `RELEASE` |
|---|---|---|
| `APPROVING`·`NET_CANCELLING` | `settlePaid` → `PAID` | `release` → `PAYMENT_FAILED` |
| `WAITING_DEPOSIT` | `settlePaid` → `PAID` | `release` → `EXPIRED` |
| `CANCELLING`(직전 `WAITING_DEPOSIT`) | `settlePaid` → `PAID` | `release` → `CANCELLED` |
| `CANCELLING`(직전 `PAID`)·`PAID`(PG 콘솔 취소) | `restoreFromReview` → `PAID`(취소가 일어나지 않았음을 확인, 또는 준비·출고가 시작된 주문을 클레임 절차로 넘김) | `fulfillment = NONE`이면 `release` → `CANCELLED` + 취소 알림. 아니면 409 `NOT_RELEASABLE`(`CANCELLING`은 `fulfillment = NONE`에서만 시작하므로 `PAID`에서 들어온 주문만 해당) |
| `EXPIRED`·`CANCELLED`·`PAYMENT_FAILED`(마감 뒤 입금) | 받지 않는다(409) | `restoreFromReview` → 원래 끝 상태(운영자가 입금액을 환불한 뒤) |

- **트리거** 운영 화면의 「확인 처리」(`POST /api/admin/orders/{orderId}/resolve`). **완료 사실** `MANUAL_REVIEW` 주문이 `PAID` 또는 끝 상태가 되고, 이력에 운영자·`action`·`note`가 남는다.
- 세 처리는 위 표의 한 칸만 탄다(택일). 그래서 그림에서 `restoreFromReview`가 `release`보다 위 행에 그려진 것은 시간 순서가 아니다(렌더러가 빈 앞 행에 끼워 넣었다). 대사·만료는 `MANUAL_REVIEW` 주문을 고르지 않으므로 운영 처리와 겹치지 않고, 같은 주문의 두 운영 요청은 조건부 전이(`MANUAL_REVIEW →`)가 하나만 통과시킨다.
- 운영자가 PG 콘솔에서 하는 환불·취소 절차 자체는 이 설계 밖이다(§8).

## 4. 소유 상태·데이터

테이블 6개 — 모두 이 모듈만 쓴다. 다른 모듈은 §2 계약으로만 읽는다(상위 §6.2).

| 표 | 주요 열 | 비고 |
|---|---|---|
| `orders` | `id`, `order_no`(유일), `member_id`(NULL = 비회원), `status`, `state_changed_at`, `version`, `payment_method`, `items_amount`·`discount_amount`·`shipping_fee`·`amount`, `order_name`, `member_coupon_ids`, `hold_until`, `payment_key`, `cancel_from_status`·`cancel_mode`·`cancel_reason`·`cancel_refund_account`(암호화 — 취소가 끝나면 NULL), `deposit_suspected_at`, `deposit_checked_at`, `void_requested_at`(만료 폐기 요청 표시 — `JF-11`), `vbank_bank`·`vbank_account`·`vbank_due_at`, `reconcile_attempts`, `review_reason`·`review_from_status`, `fulfillment`(`NONE`·`PREPARING`·`PARTIAL`·`ALL`), `cart_owner`·`cart_item_ids`, 주문자·수령인 이름·휴대폰·이메일, `zipcode`·`address1`·`address2`·`memo`, `privacy_agreed_at`, `paid_at`·`closed_at`·`created_at`, `personal_purged_at` | 모든 상태 전이는 `UPDATE … WHERE id = ? AND status = ?`(필요하면 `fulfillment`·시각 조건 추가)이고 바뀐 행이 0이면 `lost`다. 색인: `(status, state_changed_at)`, `(status, hold_until)`, `(status, vbank_due_at)`, `(status, deposit_checked_at)`, `(member_id, created_at)` |
| `order_lines` | `id`, `order_id`, `product_id`·`sku_id`, `product_name`·`option_name`(스냅숏), `unit_price`, `quantity`, `discount_amount`, `allocated_amount`, `status`, `claim_mark`, `claim_id`, `exchange_sku_id`, `reship_pending`, `shipment_id`, `prepared_at`, `delivered_at`, `confirmed_at`, `confirm_type` | 품목 스냅숏은 주문 뒤 상품이 바뀌어도 그대로다. `exchange_sku_id`는 교환 완료 때 `markLineClaim`이 넣는 재발송 SKU. 색인: `(status, delivered_at)` — 자동 확정 |
| `order_status_history` | `id`, `order_id`, `line_id`(NULL = 주문), `from_status`, `to_status`, `event`, `actor`(`CUSTOMER`·`GUEST`·`ADMIN`·`TIMER`·`WEBHOOK`), `detail`(JSON — PG 코드·경보 이름·운영 `note`), `at` | 전이마다 1행, 같은 트랜잭션. 경보(`RECONCILE_STUCK`과 그 사유 등)도 `event`로 남겨 운영 상세에서 보인다 |
| `shipments` | `id`, `order_id`, `claim_id`(교환 재발송), `carrier_code`, `tracking_number`, `items`(JSON `[{lineId, skuId}]`), `status`(`IN_TRANSIT`·`DELIVERED`), `last_checked_at`, `delivered_at`, `created_at` | `(carrier_code, tracking_number)` 유일 |
| `guest_order_access` | `order_id`(PK), `password_hash`, `failed_count`, `locked_until` | 비회원 주문에만 행이 있다 |
| `guest_tokens` | `token_hash`(PK), `order_ids`(JSON, 최대 5), `expires_at`, `created_at` | 조회 토큰. 해시만 저장한다. 한 주문이 여러 토큰(여러 브라우저)에 들어 있을 수 있다 |

### 4.1 주문·품목 상태 기계

**상태 소유자**는 order 모듈이고, 쓰기는 `OrderRepository`의 조건부 갱신뿐이다. **초기화**는 주문 생성(`JF-3`)이 주문 `PENDING_PAYMENT`·품목 `ORDERED`·클레임 표시 `NONE`으로 만든다. 주문 상태는 결제·취소·반품의 집계를, 품목 상태는 준비·배송 진행을, 클레임 표시는 품목에 걸린 클레임을 나타낸다 — 소유자는 같지만 바뀌는 이유가 달라 기계를 셋으로 나눴다.

주문 상태:

```state
<s> --> (PENDING_PAYMENT) : placeOrder
(PENDING_PAYMENT) --> (APPROVING) : approvePayment 승인 시작
(PENDING_PAYMENT) --> (WAITING_DEPOSIT) : issueVirtualAccount
(PENDING_PAYMENT) --> (CANCELLED) : cancelOrder 결제 전
(PENDING_PAYMENT) --> (EXPIRED) : 만료 타이머 30분
(APPROVING) --> (PAID) : paid 확정
(APPROVING) --> (PAYMENT_FAILED) : declined, 대사 notApproved
(APPROVING) --> (NET_CANCELLING) : 확정 불가 unsettlable
(APPROVING) --> (MANUAL_REVIEW) : 시도 상한, PG 콘솔 취소
(NET_CANCELLING) --> (PAYMENT_FAILED) : PG 취소 확인
(NET_CANCELLING) --> (MANUAL_REVIEW) : PG 거절, 시도 상한
(WAITING_DEPOSIT) --> (PAID) : 입금 웹훅, 입금 확인 대사
(WAITING_DEPOSIT) --> (EXPIRED) : 입금기한 경과, PG 계좌 닫힘
(WAITING_DEPOSIT) --> (CANCELLING) : cancelOrder 폐기
(WAITING_DEPOSIT) --> (MANUAL_REVIEW) : 폐기 거절, 금액 불일치, 확정 불가 입금, PG 콘솔 취소
(PAID) --> (CANCELLING) : cancelOrder 모든 품목 PAID
(PAID) --> (MANUAL_REVIEW) : PG 콘솔 취소
(CANCELLING) --> (CANCELLED) : PG 취소 확인, expired 통보
(CANCELLING) --> (PAID) : 되돌림, 직전 PAID
(CANCELLING) --> (WAITING_DEPOSIT) : ALREADY_DEPOSITED, 직전 WAITING_DEPOSIT
(CANCELLING) --> (MANUAL_REVIEW) : PG 거절, 시도 상한
(MANUAL_REVIEW) --> (PAID) : resolve CONFIRM_PAID
(MANUAL_REVIEW) --> (PAYMENT_FAILED) : resolve RELEASE
(MANUAL_REVIEW) --> (EXPIRED) : resolve RELEASE
(MANUAL_REVIEW) --> (CANCELLED) : resolve RELEASE
(EXPIRED) --> (MANUAL_REVIEW) : 마감 뒤 입금
(CANCELLED) --> (MANUAL_REVIEW) : 마감 뒤 입금
(PAYMENT_FAILED) --> (MANUAL_REVIEW) : 마감 뒤 입금
(PAID) --> (PARTIALLY_RETURNED) : 품목 RETURNED, 남은 품목 있음
(PAID) --> (RETURNED) : 모든 품목 RETURNED
(PARTIALLY_RETURNED) --> (RETURNED) : 마지막 품목 RETURNED
(RETURNED) --> <e>
```

품목 상태:

```state
<s> --> (ORDERED) : placeOrder
(ORDERED) --> (PAID) : 주문 PAID와 같은 트랜잭션
(ORDERED) --> (CANCELLED) : 주문 PAYMENT_FAILED, EXPIRED, CANCELLED
(PAID) --> (CANCELLED) : 주문 취소 완료
(PAID) --> (PREPARING) : prepareLines 발주 확인
(PAID) --> (SHIPPING) : registerShipment
(PREPARING) --> (SHIPPING) : registerShipment
(SHIPPING) --> (DELIVERED) : 배송 타이머 배송 완료
(DELIVERED) --> (SHIPPING) : 교환 재발송 송장
(DELIVERED) --> (CONFIRMED) : confirmLine, 자동 확정 7일
(CANCELLED) --> <e>
(CONFIRMED) --> <e>
```

클레임 표시(`order_lines.claim_mark`):

```state
<s> --> (NONE) : placeOrder
(NONE) --> (RETURN_REQUESTED) : markLineClaim 반품 신청
(NONE) --> (EXCHANGE_REQUESTED) : markLineClaim 교환 신청
(RETURN_REQUESTED) --> (RETURNED) : 반품 검수 완료
(EXCHANGE_REQUESTED) --> (EXCHANGED) : 교환 완료, exchangeSkuIds 저장
(RETURN_REQUESTED) --> (CLAIM_REJECTED) : 클레임 거절
(EXCHANGE_REQUESTED) --> (CLAIM_REJECTED) : 클레임 거절
(CLAIM_REJECTED) --> (RETURN_REQUESTED) : 기한 안 재신청
(CLAIM_REJECTED) --> (EXCHANGE_REQUESTED) : 기한 안 재신청
(RETURN_REQUESTED) --> (NONE) : 클레임 철회
(EXCHANGE_REQUESTED) --> (NONE) : 클레임 철회
(RETURNED) --> <e>
```

**기호**: `<s>` 시작점, `(…)` 상태, `<e>` 그 기록의 상태가 더 바뀌지 않는 곳(행은 보존 기한까지 남는다), `A --> B : 글` A에서 B로 가는 전이와 그 입력.

- **불변조건 1** 주문 `PAID` ⇔ 재고 확정·쿠폰 사용이 같은 트랜잭션으로 일어났다(`JF-4.1`). `PAYMENT_FAILED`·`EXPIRED`·`CANCELLED` ⇔ 해제가 일어났다(`JF-4.2`).
- **불변조건 2** PG 결과를 모르는 주문은 `APPROVING`·`NET_CANCELLING`·`CANCELLING`에만 있고, 이 셋은 대사(`JF-10`)만 닫는다 — 만료 타이머·고객 취소가 건드리지 않는다. 대사가 결론을 못 내면 `MANUAL_REVIEW`로 빠지고, 그 뒤는 운영자(`JF-13`)만 닫는다.
- **불변조건 3** 망취소는 `APPROVING → NET_CANCELLING` 조건부 전이로만 시작하고, 카드 주문의 확정은 `APPROVING`에서만 한다 — 한 주문에서 둘 다 일어나지 않는다.
- **불변조건 4** 준비·송장이 있는 주문(`fulfillment ≠ NONE`)은 `CANCELLING`이 되지 않는다. 품목 `PREPARING` 이후는 고객 취소가 아니라 문의·반품이다.
- **불변조건 5** 한 품목에 진행 중 클레임(`RETURN_REQUESTED`·`EXCHANGE_REQUESTED`)은 하나다. `CONFIRMED` 품목과 `RETURNED` 품목은 클레임 표시가 더 바뀌지 않는다.
- `EXPIRED`·`CANCELLED`·`PAYMENT_FAILED`는 업무상 끝 상태지만 마감 뒤 입금 때 `MANUAL_REVIEW`로 갈 수 있어 `<e>`를 두지 않았다 — 그 경우도 운영 처리 뒤 원래 끝 상태로 돌아온다(`JF-13`). `PAID`·`PARTIALLY_RETURNED`도 끝 상태가 아니다 — 그 뒤 진행은 품목 상태가 맡는다.
- 교환 완료(`EXCHANGED`) 품목은 `exchange_sku_id`와 재발송 대기 표시를 달고, 교환 재발송 송장이 등록되면 품목이 다시 `SHIPPING`이 된다. 교환 품목의 재반품은 받지 않는다(잠정 — §8).
- 이 주문의 결제·가예약·쿠폰·클레임 기록이 같은 순간 어떤 값인지는 상위 [§5.18](../system-design-to-be.md#518-주문-상태--여러-경계가-나눠-가진-기록)이 원본이다.

### 4.2 비회원 접근

- 주문 비밀번호는 6~20자(잠정)를 받아 bcrypt(cost 10, 잠정)로 해시한다. 해시는 주문 생성 트랜잭션 전에 만든다(`JF-3A`). 평문은 저장하지 않는다.
- 실패 10회 연속이면 `locked_until` = 지금 + 30분, `failed_count`는 0으로 되돌린다. 잠금 중에는 맞는 비밀번호도 429 `LOCKED {until}`다. 성공하면 `failed_count` = 0.
- 토큰은 무작위 32바이트(base64url)이고 `token_hash` = SHA-256만 저장한다. 한 토큰이 같은 브라우저의 비회원 주문을 최대 5개 가리킨다. 새 비회원 주문이나 조회 성공 때 요청의 `GOT`가 유효하면 그 토큰의 `order_ids`에 주문을 더하고(다섯을 넘으면 가장 오래 더한 것을 뺀다) `expires_at` = 지금 + 30분으로 갱신한다. 그 밖의 요청으로는 수명을 늘리지 않는다. `GOT`가 없거나 무효면 새 토큰을 만든다.

### 4.3 보존·파기

| 데이터 | 보존 | 파기 방법 | 근거 |
|---|---|---|---|
| 주문·품목·상태 이력·송장 | 주문 종료(`closed_at`, 없으면 마지막 품목 확정·반품) 뒤 5년 | 행을 지우지 않는다 — 계약·대금결제·재화공급 기록 | `R-25`·`C-20` |
| 비회원 주문의 주문자·수령인 이름·휴대폰·이메일·주소, `guest_order_access` 행 | 위와 같은 5년 | `purgeExpired`가 열을 `NULL`(이름은 `***`)로 바꾸고 `personal_purged_at`을 적고, 접근 행을 지운다 | `R-25`·`C-20` |
| 회원 주문의 연락처·주소 | 위와 같은 5년 | 같은 방법. 탈퇴 때는 지우지 않는다 — 회원 행은 member가 파기하므로 `member_id`만으로는 사람을 알 수 없게 된다 | `R-26`·`C-20` |
| 만료된 조회 토큰(`guest_tokens`) | 만료 즉시 무효 | `purgeExpired`가 행을 지운다 | `D-07` |
| 취소 환불 계좌(`cancel_refund_account`) | PG 취소가 끝날 때까지 | 취소 확정·되돌림·운영 처리 트랜잭션이 `NULL`로. 남은 것이 있으면(`CANCELLING`·`MANUAL_REVIEW`가 아닌데 값이 있음) `purgeExpired`가 지운다 | `C-14` |

- `purgeExpired(now)`는 mall-api의 하루 1회 보존 작업이 부르고, 1회에 최대 1,000주문씩 처리해 긴 트랜잭션을 피한다. 남으면 다음 날 이어서 한다. 결과는 `PurgeResult {task:'order', deleted}`다.
- 법정 기간의 해석과 「탈퇴 회원의 주문 배송지」를 거래 기록으로 볼지는 법무 확인이 필요하다(§8).

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| catalog | `getSkus`·`reserveStock`·`commitReservation`·`extendReservation`·`releaseStock`([catalog 상세 §2](catalog.md#2-공개-계약)) | `CatalogApi` 주입 | 같은 프로세스 — DB 트랜잭션 타임아웃(mall-api) | order 트랜잭션에 참여한다. 참조 키 `order:<orderId>`로 멱등. `commitReservation`의 `notHeld` 결과에 기댄다(§8) |
| promotion | `quote`·`lockCoupons`·`useCoupons`·`releaseCoupons`([promotion 상세 §2](promotion.md#2-공개-계약)) | `PromotionApi` 주입 | 같음 | order 트랜잭션에 참여. 참조 키 멱등. 할인 안분 결과를 그대로 `allocated_amount`에 쓴다 |
| cart | `removeItems(owner, cartItemIds)`([cart 상세 §2](cart.md#2-공개-계약)) | `CartApi` 주입 | 같음 | order 트랜잭션에 참여. 없는 품목은 무시(멱등) |
| payment | `approve`·`queryPayment(orderRef)`·`issueVirtualAccount`·`verifyNotice`·`cancel(orderRef, amount, reason, idemKey, mode, refundAccount?)`([payment 상세 §2](payment.md#2-공개-계약)) | `PaymentApi` 주입 | 승인·발급·취소 30s, 조회 5s | **트랜잭션 밖에서만 부른다**(상위 §6.3). 업무 결과는 예외가 아니라 값이다 — `paid`·`declined`·`unknown`·`cancelled`·`notApproved`·`waitingDeposit`·`failed {code}`(`ALREADY_DEPOSITED`·`REFUND_ACCOUNT_REQUIRED`·`NOT_CANCELLABLE`·`CANCEL_IN_PROGRESS`·`PG_REJECTED {pgCode}`), 발급 `issued`·`failed`·`unknown`, 통보 `deposited`·`expired`·`cancelled {ours}`·`ignored`·`duplicate {first}`·`rejected`·`unavailable`. 주문 참조는 `orderRef {orderId, orderNo}`. 취소 멱등 키는 order가 정한다 — `approve:`·`netcancel:`·`cancel:`(환불)·`vbank-void:`(가상계좌 폐기) + 주문 ID. 발급 키와 재발급 시도 번호는 payment가 정한다(order는 발급 재요청만 부른다) |
| notification | `enqueue(template, recipient, vars, dedupKey)`([notification 상세 §2](notification.md#2-공개-계약)) | `NotificationApi` 주입 | 같은 프로세스 | order 트랜잭션에 참여. 템플릿 다섯 `ORDER_PAID`·`VBANK_ISSUED`·`VBANK_DEPOSITED`·`SHIPPING_STARTED`·`ORDER_CANCELLED`(8종 가운데 클레임 셋은 claim). `enqueue`는 내용 오류에 던지지 않아 알림 실수가 결제 확정을 롤백하지 않는다 |
| 택배 조회 API | 택배사 코드 + 운송장 → 단계·이력·배송 완료 시각(가정 — 스마트택배형) | `DeliveryTrackerGateway`, `order.tracker.base-url`·`order.tracker.api-key` | 5s, 재시도 없음 | 외부 HTTP. 응답을 저장하는 것은 배송 타이머뿐 |
| mall-api | 트랜잭션 관리자, 스케줄러(인스턴스 하나만 실행 — `OrderJobs`·`RetentionTask`를 부른다), 요청 주체 `Principal`, 시계 | 조립 지점이 주입([mall-api 상세 §2](mall-api.md#2-공개-계약)) | 작업 잠금 `lockAtMostFor` 대사·만료 5분(시간 예산 3분보다 길다) | 타이머 주기는 order 설정 키를 mall-api 스케줄러가 읽는다 |

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 결제 대기(가예약) 시간 | 30분 | `order.pending-payment-ttl` | `CheckoutService.placeOrder`, `OrderJobs.onExpiryTick` |
| 가상계좌 입금기한 | 72시간 | `order.vbank.due` | `CheckoutService.issueVirtualAccount` |
| 대사 주기·대상 나이·건수 | 1분·1분·50건(묶음마다) | `order.reconcile.interval`·`order.reconcile.min-age`·`order.reconcile.batch` | `OrderJobs.onReconcileTick` |
| 입금 대기 주기 조회 | 1시간 | `order.reconcile.deposit-poll-interval` | `OrderJobs.onReconcileTick`(`JF-10C`) |
| 결론 없는 시도 상한 | 10회 → `MANUAL_REVIEW` | `order.reconcile.max-attempts` | `OrderRepository.countAttempt` |
| 대사·만료 틱 시간 예산 | 3분(잠금 `lockAtMostFor` 5분보다 짧게) | `order.reconcile.time-budget`·`order.expiry.time-budget` | `OrderJobs.onReconcileTick`·`onExpiryTick` |
| 만료 주기·건수 | 1분·100건 | `order.expiry.interval`·`order.expiry.batch` | `OrderJobs.onExpiryTick` |
| 배송 주기·건수 | 30분·200건 | `order.delivery.interval`·`order.delivery.batch` | `OrderJobs.onDeliveryTick` |
| 배송 지연 경보 | 송장 등록 14일 | `order.delivery.stale-after` | `OrderJobs.onDeliveryTick` |
| 자동 구매확정 | 배송 완료 7일 | `order.auto-confirm-after` | `OrderRepository.autoConfirm` |
| 택배 조회 | 5s, 재시도 없음 | `order.tracker.timeout` | `DeliveryTrackerGateway.track` |
| 택배사 목록 | 설정 목록(코드·이름) | `order.carriers` | `ShipmentService.listCarriers`·`registerShipment` |
| 비회원 조회 잠금 | 10회 연속 실패 → 30분 | `order.guest.max-failures`·`order.guest.lock` | `GuestAccess.open` |
| 비회원 조회 토큰 | 30분, 토큰당 주문 5개 | `order.guest.token-ttl`·`order.guest.token-max-orders` | `GuestAccess` |
| 환불 계좌 암호화 키 | 환경 변수(잠정 — 상위 §9.5 비밀 관리) | `order.refund-account.key` | `CancelService`, `OrderRepository` |
| 배송비 | 무료 기준 50,000원, 기본 3,000원, 도서산간 3,000원 | `order.shipping.free-threshold`·`order.shipping.base-fee`·`order.shipping.remote-surcharge` | `PricingCalculator` |
| 주문번호 충돌 재시도 | 3회 | `order.number.max-attempts` | `OrderNumberGenerator` |
| 보존 작업 1회 처리량 | 1,000주문 | `order.retention.batch` | `OrderRetention.purgeExpired` |

- **인증** 주문을 여는 고객 라우트는 모두 `OrderAccessPolicy.loadOwned`가 소유를 확인한다 — 회원 세션의 회원 ID 또는 조회 토큰의 `guestOrderIds`. `GET /api/orders`는 회원만(401). `/api/admin/orders*`는 운영자 역할을 mall-api 미들웨어가 확인한다. `POST /api/webhooks/pg`는 세션·CSRF가 없고, 출처는 `Payment.verifyNotice`의 서명과 PG 조회가 확인한다 — 본문의 상태를 믿지 않는다. 승인 금액은 브라우저가 보낸 `amount`가 아니라 저장된 주문 금액만 PG에 보낸다. 환불 계좌는 암호화해 저장하고 로그에 남기지 않는다.
- **동시성** 모든 상태 전이는 현재 상태를 조건으로 건 한 행 갱신이고, 진 쪽은 `lost`·`rejected`로 아무 효과 없이 끝난다(§4 `orders` 비고). PG 호출은 언제나 트랜잭션 밖이고, 호출 전 상태(`APPROVING`·`NET_CANCELLING`·`CANCELLING`)를 먼저 커밋해 결과 불명이 남을 자리를 만든다(상위 §6.3). 타이머 셋은 mall-api가 인스턴스 하나에서만 돌리고, 그래도 겹치면 같은 조건부 전이가 막는다. 워커 호출은 참조 키·멱등 키로 두 번 불러도 효과가 한 번이다.
- **부분 실패 규칙** PG 승인 결과 불명 = `APPROVING`으로 대사(`C-10`), 승인 뒤 확정 일시 오류 = `APPROVING`으로 대사(202), 승인 뒤 확정 불가 = `NET_CANCELLING`으로 망취소(`C-10`), 망취소·취소 결과 불명 = 대사가 PG 조회로 닫거나 같은 멱등 키로 재시도(`C-14`), 웹훅 반영 실패 = 입금 의심 표시로 대사(`C-11`), 웹훅 유실 = 1시간 주기 조회(`C-11`), 결론 없는 시도 10회·PG 거절·마감 뒤 입금 = `MANUAL_REVIEW`(운영자), 택배 조회 실패 = 다음 틱(`C-15`), 알림 = 업무 트랜잭션과 함께 적재되고 발송 실패는 주문에 영향 없음(`D-06`).
- **최후 방어** 사람이 봐야 하는 주문은 `MANUAL_REVIEW` 상태와 경보 `RECONCILE_STUCK`(이력 `detail`의 사유 — `ATTEMPTS_EXCEEDED`·`PG_REJECTED`·`NOT_CANCELLABLE`·`DEPOSIT_AFTER_CLOSE`·`DEPOSIT_AMOUNT_MISMATCH`·`DEPOSIT_COMMIT_FAILED`·`FOREIGN_CANCEL`)로 남고, 운영 목록의 `MANUAL_REVIEW` 필터와 `POST /api/admin/orders/{orderId}/resolve`로 닫는다. 그 밖의 경보는 `CANCEL_FAILED`(방어 갈래), `VBANK_VOID_FAILED`(발급 중 종료 폐기 실패), `DELIVERY_STALE`이다. 경보를 받아 PG 콘솔에서 환불하는 운영 절차는 이 설계 밖이다.

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 주문 생성 원자성 | `JF-3`, `R-09`·`R-20` | `lockCoupons`가 `unavailable`을 주게 한 가짜 → 주문·가예약·토큰 0행. `expectedAmount` 1원 차이 → 409 `PRICE_CHANGED`, 저장 0행. 비회원 비밀번호 5자·21자 → 422 `VALIDATION_FAILED` | 상위 §9.1 순서 3 |
| 재고 경합 | `JF-3` + catalog, `R-09` | 재고 1개 SKU에 동시 주문 10건(실제 MySQL, Testcontainers 잠정) → 201 1건·409 9건 | 순서 3 |
| 금액 계산 | `PricingCalculator`, `C-09` | 표 시험 — 할인 뒤 49,999원·50,000원 경계, 도서산간 우편번호, 쿠폰 안분 합 = 할인 합, 우편번호 없는 견적의 `shippingFeeEstimated` | 순서 3 |
| 주문번호 | `OrderNumberGenerator` | 형식 정규식 `^\d{8}-[1-9]\d{6}$`, 충돌 주입 2회 → 3번째 성공, 3회 충돌 → 500 | 순서 3 |
| 승인 갈래 | `JF-4`·`JF-4.1`·`JF-4.2`, `R-10`·`R-18` | 가짜 `PaymentApi`로 `paid`·`declined`·`unknown`. `paid` + `commitReservation` `notHeld` 강제 → `NET_CANCELLING` → 망취소 `cancelled`(500, `PAYMENT_FAILED`)·`unknown`(202 `NET_CANCELLING`)·`PG_REJECTED`(202 `MANUAL_REVIEW`). `paid` + 확정 중 잠금 대기 타임아웃 주입 → 망취소 호출 0회, 202 `APPROVING` | 순서 3 |
| 두 번 누름 | `beginApproving`, `R-18` | 같은 주문 승인 2건 동시 → `PaymentApi.approve` 호출 1회, 하나는 409 `INVALID_STATE {status:'APPROVING'}` | 순서 3 |
| 망취소와 대사 경합 | `JF-4`·`JF-10A`, 불변조건 3 | 승인 요청의 `beginNetCancel`과 대사의 `settlePaid`를 동시 실행 100회 → 매번 한쪽만 통과, 「`PAID`인데 PG 취소 호출」·「`NET_CANCELLING`인데 확정」 0건 | 순서 3 |
| 대사 | `JF-10A`·`JF-10B`, `R-18` | `APPROVING` + `queryPayment` `paid`·`notApproved`·`cancelled`·`unknown` 각각 → `PAID`·`PAYMENT_FAILED`·`MANUAL_REVIEW`(`FOREIGN_CANCEL`)·시도 +1. 시도 11회째 → `MANUAL_REVIEW` + `RECONCILE_STUCK`. `CANCELLING` + 조회 `cancelled` → `cancel` 호출 0회로 `CANCELLED`, 조회 `paid` → `cancel` 재호출 1회(같은 키). 고객 승인과 대사가 같은 주문을 동시에 확정 → `useCoupons` 효과 1회 | 순서 3 |
| 시간 예산 | `JF-10`·`JF-11`, `C-21` | 가짜 PG 조회를 주문당 5s로 늦춘 대상 100건 → 한 틱이 3분 안에 새 주문 고르기를 멈추고, 처리한 주문마다 커밋이 따로 남는다 | 순서 3 |
| 가예약 만료 경합 | `JF-4.1` `notHeld`, `JF-10A` | 가예약을 catalog에서 직접 풀어 둔 `APPROVING` 주문을 대사 → 확정 롤백 → `NET_CANCELLING` → 다음 틱 망취소 → `PAYMENT_FAILED` | 순서 3 |
| 가상계좌 | `JF-5`·`JF-9`, `R-11`·`R-19` | 발급 → `WAITING_DEPOSIT`·가예약 연장. 발급 `failed`·`unknown` 뒤 재요청 → 주문 `PENDING_PAYMENT` 그대로, `PaymentApi.issueVirtualAccount`를 같은 인자로 다시 1회(order는 키를 넘기지 않는다 — `vbank:<orderId>#2`·같은 키 선택은 payment 시험). 같은 웹훅 2회 → `PAID` 1회·알림 1건. 첫 반영을 롤백시킨 뒤 `duplicate {first}` → `PAID`. 금액 다른 웹훅 → `MANUAL_REVIEW`. 발급 중 만료(`.lost`) → `vbank-void:` 폐기 호출 | 순서 4 |
| 만료와 입금 경합 | `JF-11`·`JF-9`·`JF-10C`, `R-19` | ① 폐기 `failed {ALREADY_DEPOSITED}` → 입금 의심 표시 → 웹훅 없이 대사가 `PAID` ② 만료 커밋 뒤 입금 웹훅 → `MANUAL_REVIEW`(`DEPOSIT_AFTER_CLOSE`) ③ 폐기 성공 직후 웹훅이 먼저 커밋 → `PAID`, 만료 `lost` ④ 웹훅을 버린 입금 → 1시간 주기 조회가 `PAID` ⑤ 폐기 `unknown` 뒤 PG `cancelled` → 웹훅(`ours:true`)으로 와도 대사 조회로 와도 `EXPIRED` ⑥ 폐기 요청 없는 `WAITING_DEPOSIT`에 PG `cancelled` → 웹훅(`ours:false`)·대사 조회 모두 `MANUAL_REVIEW`(`FOREIGN_CANCEL`) | 순서 4 |
| 웹훅 판단표 | `JF-9` `NoticePolicy`, `R-19`·`C-11` | 판단표 행마다 표 시험 — 특히 `rejected` → 400 `INVALID_SIGNATURE`, `unavailable` → 503 `RETRY_LATER`, `deposited` × `CANCELLING`(직전 `WAITING_DEPOSIT`) → 503, × `CANCELLING`(직전 `PAID`) → 200 효과 없음, `cancelled` × `PAID` `ours:true` → 200 효과 없음·`ours:false` → `MANUAL_REVIEW`, `cancelled` × `PARTIALLY_RETURNED`·`RETURNED`·`MANUAL_REVIEW` → 200 효과 없음. 같은 사실을 `duplicate {first}`로 다시 주면 같은 결정 | 순서 4 |
| 취소 | `JF-6`, `R-13`·`R-20` | 결제 전 취소 → PG 호출 0회. 카드 결제 완료 취소 → 환불·재입고·쿠폰 복원·알림. 가상계좌 결제 완료인데 계좌 없음 → 422, 상태 그대로. 입금 대기 취소 + `ALREADY_DEPOSITED` → 409, `WAITING_DEPOSIT` + 의심 표시. `PG_REJECTED` → 502, `MANUAL_REVIEW`. `unknown` → 202 `CANCELLING` → 대사가 `CANCELLED`. 폐기 요청 중 `expired` 통보 → `CANCELLED` | 순서 4 |
| 준비·송장과 취소 경합 | `beginCancelling` × `markPreparing`·`markShipping` | 두 요청 동시 실행 100회 → 매번 한쪽만 성공, 준비·송장 있는 `CANCELLED` 0건. `PREPARING` 품목이 있는 주문 취소 → 409 `NOT_CANCELLABLE` | 순서 5 |
| 운영 확인 처리 | `JF-13` | `review_from_status` 다섯 경우 × `action` 둘 → 표대로의 끝 상태·해제 효과 횟수. 가예약 없는 `CONFIRM_PAID` → 409 `NOT_SETTLEABLE`. `PREPARING` 품목이 있는 `PAID`(PG 콘솔 취소) 주문의 `RELEASE` → 409 `NOT_RELEASABLE`, 품목 상태 그대로. 같은 주문 두 요청 동시 → 하나만 200 | 순서 5 |
| 비회원 조회 | `JF-8`, `R-16` | 틀린 비밀번호 10회 → 429 `LOCKED {until}`, 30분 뒤(시계 이동) 성공. 없는 번호와 틀린 비밀번호의 응답 코드·본문 동일. 비회원 주문 둘을 한 브라우저에서 → 한 토큰으로 둘 다 열림, 여섯째 주문 → 첫 주문 빠짐. 토큰에 없는 주문 → 403 | 순서 4 |
| 소유 검사 | `OrderAccessPolicy`, `R-12`·`R-17` | 회원 A가 회원 B 주문·비회원 주문을 열기 → 403. 모든 고객 라우트(§2)에 같은 표 시험 | 순서 4 |
| 배송·자동 확정 | `JF-7`·`JF-12`, `R-24` | 가짜 택배 조회로 배송 완료 → `DELIVERED` 1회(두 틱 연속 반영해도 1회). 시계를 7일 옮김 → `CONFIRMED`. 반품 신청 품목·재발송 대기 품목은 제외 | 순서 5 |
| 클레임 표시 | `JF-1`, `R-14` | 8일 지난 품목 `claimable:false` `WINDOW_EXPIRED`. 같은 품목 반품·교환 표시 동시 → 하나만 `marked`. 마지막 품목 `RETURNED` → 주문 `RETURNED`. `EXCHANGED` + `exchangeSkuIds` → 재발송 송장 `items.skuId` = 새 SKU, `exchangeSkuIds` 누락 → 예외 | 순서 5 |
| 탈퇴 확인 | `hasActiveOrders`, `R-26` | 상태 조합 표(결제 대기·망취소 중·운영 확인 중·출고 전·상품 준비 중·배송 중·클레임 중·재발송 대기·모두 확정) → 기대값 대조 | 순서 6 |
| 보존 작업 | `purgeExpired`, `C-20` | 시계를 5년 1일 옮긴 시험 DB → 비회원 연락처만 지워지고 주문 금액·품목은 남음. 결과 `{task:'order', deleted}` | 순서 6 |

명령은 잠정 스택 기준 `./gradlew :order:test`(단위·가짜 워커)와 `./gradlew :order:integrationTest`(실제 MySQL)다. 경계를 넘는 끝단 검증(가짜 PG로 결제 끝단 등)은 상위 [§9.2](../system-design-to-be.md#92-검증)가 원본이다.

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-10`·`D-03` | 위험 | 「가예약을 푸는 쪽은 order 하나이고 해제는 조건부 전이와 한 트랜잭션」이라는 전제에 결제 확정의 안전이 걸려 있다. catalog가 `holdUntil`로 스스로 풀거나 운영자가 가예약을 직접 고치면 확정이 `notHeld`로 롤백되고 승인된 결제를 망취소한다 | `JF-4.1`, [catalog 상세 §3](catalog.md#3-내부-job-flow--드릴다운) | 상위 §5.8이 적은 대로 `notHeld`는 방어 갈래다 — `APPROVING`·`WAITING_DEPOSIT` 주문은 만료 타이머가 PG 사실 없이 풀지 않으므로 정상 흐름에서는 생기지 않는다. 그래도 생기면 `unsettlable`로 망취소(카드)·`MANUAL_REVIEW`(입금)로 간다. catalog에 자동 해제를 더하려면 order와 함께 바꾼다 |
| `C-11`·`C-14` | 미확정 | 환불 계좌의 실명 확인을 하지 않는다. 틀린 계좌면 PG 환불이 `PG_REJECTED`로 끝나 `MANUAL_REVIEW`로 빠진다 | 상위 §9.5, `JF-6` | 실명 확인 수단(PG 부가 서비스 등)이 정해지면 `CancelService`의 계좌 검사에 더한다 |
| `C-11` | 미확정 | 마감 뒤 입금·PG 거절의 환불은 운영자가 PG 콘솔에서 하고 `resolve`로 닫는다. 콘솔 절차와 고객 연락(환불 계좌 받기)은 이 설계 밖이다 | `JF-9`·`JF-13` | 운영 절차서가 필요하다. 건수가 늘면 운영 화면에 「환불 계좌 받아 환불」 라우트를 더한다 |
| `C-14` | 미확정 | 상품 준비(`PREPARING`)가 시작된 주문은 고객이 취소하지 못한다(잠정) | `JF-6`, 상위 §9.5 | 고객은 고객센터 문의 또는 배송 뒤 반품. 준비 중 취소를 받으려면 운영자 취소 라우트가 필요하다 |
| `C-11`·`C-12` | 위험 | payment는 은행을 바꾼 재발급에 새 키를 쓴다([payment 상세 §2](payment.md#2-공개-계약)). 앞 시도가 결과 불명으로 PG에서 실제 발급됐으면 한 주문에 계좌가 둘일 수 있다 | `JF-5` | 앞 계좌에 입금되면 payment가 같은 `orderRef`로 통보해 `JF-9`가 받는다. 두 계좌 모두 입금되면 둘째는 `PAID` 주문에 대한 `deposited`라 지금 판단표로는 `.noop`이다 — payment가 계좌별 입금을 구분해 주거나 결과 불명 뒤 은행 변경을 막아야 order가 둘째 입금을 `MANUAL_REVIEW`로 뺄 수 있다 |
| `C-13` | 위험 | 비회원 조회 잠금은 주문번호마다라서, 여러 주문번호를 돌아가며 맞추는 공격은 막지 않는다 | `R-16` | 주문번호 무작위 7자리가 하루 천만 가지라 짐작이 어렵다. mall-api가 비회원 조회에 IP당 분당 10회 제한을 둔다([mall-api 상세 §6](mall-api.md#6-실패-경계)) — 분산된 IP의 시도는 여전히 남는다 |
| `C-15` | 미확정 | 택배 조회가 배송 완료를 끝내 주지 않으면 반품 기한·자동 확정이 시작되지 않는다 | `JF-12` | 14일 `DELIVERY_STALE` 경보까지만. 운영자 「배송 완료 처리」 라우트를 둘지 결정 필요 |
| `C-15`·`C-16` | 미확정 | 교환 완료 품목의 재반품·재교환을 받지 않는다(잠정). `getClaimableLines`는 이 품목을 `why:'ALREADY_RETURNED'`로 준다 | §4.1, `JF-1` | 교환품 불량 시 고객이 반품할 길이 없다. 받으려면 재발송 배송 완료 시각부터 7일 창을 다시 열고, 그때는 `exchange_sku_id`를 반품 기준 SKU로 쓴다 |
| `C-10`·`C-11` | 미확정 | 결론 없는 시도 상한 10회·입금 대기 1시간 주기 조회·틱 시간 예산 3분은 잠정값이다 | §6 | PG 호출 한도·장애 길이가 정해지면 조정한다. 상한이 짧으면 PG 장애 한 번에 `MANUAL_REVIEW`가 몰린다 |
| `R-26`·`C-20` | 미확정 | 배송 중(`SHIPPING`) 주문은 `hasActiveOrders`가 `false`라 탈퇴가 된다(`R-26` 문구대로). 탈퇴 회원 주문의 배송지는 5년 보존 | §4.3 | 배송 중 탈퇴하면 반품 안내 연락이 어렵다. 법무 확인 뒤 범위를 정한다 |
| `C-09` | 미확정 | 배송비 무료 기준을 쿠폰 할인 뒤 금액으로 계산하고, 도서산간 추가는 무료 배송에도 붙인다 | 상위 §9.5 배송비 정책 | 판매자 정책이 다르면 `PricingCalculator`와 claim의 반품 배송비 계산이 함께 바뀐다 |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 모든 계약·수치(30분·72시간·1분·50건·7일·10회·3분 등)는 설계값이고 실행·측정한 것이 없다.
2. PG의 멱등 키 지원, 「이미 입금됨」 폐기 거절, 닫힌 가상계좌의 입금 처리, 웹훅 재전송 정책, 콘솔 취소의 통보 방식은 업체를 정하지 않아 가정이다(상위 §9.5).
3. 택배 조회 API의 응답 형식·배송 완료 시각의 정확도·호출 한도는 확인하지 않았다.
4. 다른 상세(catalog·promotion·cart·payment·notification·claim·review·member·mall-api)의 계약 이름과 결과 값은 각 상세 §2를 따랐다. 계약이 실제로 맞물리는지는 문서 대조로만 확인했고, 실행한 적이 없다.
5. 법정 보존 기간과 파기 대상(특히 탈퇴 회원의 주문 배송지)의 해석은 법무 검토를 거치지 않았다(`C-20`).
