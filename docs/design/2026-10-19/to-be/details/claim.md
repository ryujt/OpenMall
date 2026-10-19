# claim (모듈) — TO-BE 상세

> **대상**: 반품·교환의 신청·철회·회수 확인·검수 완료·거절, 환불액 계산과 부분 환불, 재입고, 교환 새 SKU 확보, 클레임 기록 보존(`C-16`·`C-20`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드가 없는 신규 설계의 문서 기준점)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·테이블·설정이 제안이다. 그래서 `(제안)` 표시는 생략한다. 이 설계가 정하지 못하는 외부 동작은 「가정」, 확인하지 못한 것은 「미확인」, 운영 정책이 없어 임시로 정한 값은 「잠정」이다. 그림의 근거 열은 `R`·`C`·`D` ID다. 흐름은 `jobflow`(`job-flow-diagram-guide.md`), 상태 전이는 `state`(`state-diagram-guide.md`)로 그린다

## 1. 책임 / 비책임

- **책임**: 반품·교환 요청 하나를 신청부터 끝까지 조율한다. 신청 때 order가 준 품목 정보로 기한(배송 완료 7일)·구매확정 전·진행 중 클레임 없음을 검사하고, 클레임을 저장하고, order에 품목 표시를 맡기고, 접수 알림을 쌓는다(`R-14`). 운영자의 회수 확인·검수 완료·거절을 받아 환불액(품목 결제 안분액 − 반품 배송비)을 계산하고, payment에 부분 취소를 맡기고, 성공하면 재입고·품목 표시·완료 알림을 한 트랜잭션으로 끝낸다(`R-21`). 교환은 새 SKU를 catalog에서 확보한다. 클레임 기록을 법정 기간 동안 남기고 그 뒤 지운다(`R-25`·`C-20`).
- **비책임**: 품목·주문 상태와 반품 가능 판단의 원자료(order — 배송 완료 시각·구매확정·결제 안분액은 order가 준다), 품목 클레임 표시의 저장과 「품목당 진행 중 클레임 1건」 가드(order `markLineClaim`), PG 부분 취소 호출과 결제 취소 기록(payment), 재고 수량(catalog), 알림톡 발송(notification — claim은 적재만 한다), 교환 재발송 송장(order `registerShipment` — 운영자가 `claimId`를 실어 부른다, 상위 [§5.11](../system-design-to-be.md#511-배송--송장-등록배송-추적배송-완료)), 클레임 화면(storefront-web·admin-web).
- **아무도 하지 않는 것**: 반품 회수 택배 접수(운영자가 택배사에 직접 접수하고 회수 확인만 누른다 — 상위 §9.5), 반품 때 쿠폰 복원(잠정 — 쿠폰은 돌려주지 않는다, 상위 §9.5), 다른 가격 옵션 교환의 차액 정산, 구매자 귀책 교환의 배송비 결제(§8), `REFUND_PENDING` 클레임의 자동 재시도(운영자가 다시 누른다 — §6).

## 2. 공개 계약

계약 11개 — 고객 HTTP 라우트 5, 운영 HTTP 라우트 5(목록·상세는 한 행), 서비스 메서드 1(보존 작업). 라우트는 mall-api 조립 지점이 붙이고, 인증 미들웨어가 요청 주체 `Principal {subjectType, subjectId?, guestOrderIds?, …}`(회원·비회원 조회 토큰·운영자)를 정한다. 오류 본문은 mall-api 공통 형식 `{code, message, details}`이고 입력 형식 오류는 422 `VALIDATION_FAILED`(`details.fields[{field, reason}]`)다. `/api/admin/*`는 운영자만 받는다(그 밖 403 — 미들웨어).

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `POST /api/orders/{orderId}/claims/return` | `{lineIds[], reasonCode, reasonText, pickupAddress{name, phone, zipcode, address1, address2}, refundAccount?{bankCode, accountNumber, holderName}}` — `refundAccount`는 가상계좌로 결제한 주문만 필수. 요청 주체 = 회원 세션 또는 그 주문을 `guestOrderIds`에 담은 비회원 조회 토큰 | 201 `{claimId}` → `ClaimComplete` | 401 주체 없음, 403 `NOT_OWNER`, 404 주문 없음, 409 `NOT_CLAIMABLE {lineId, why}`(`why` = `NOT_DELIVERED`·`WINDOW_EXPIRED`·`CONFIRMED`·`CLAIM_IN_PROGRESS`·`ALREADY_RETURNED` — order가 준 코드 그대로), 422 `VALIDATION_FAILED`·`REFUND_ACCOUNT_REQUIRED` | `ClaimRoutes.requestReturn` → `ClaimService.request` — `C-16` |
| `POST /api/orders/{orderId}/claims/exchange` | `{lines[{lineId, newSkuId}], reasonCode, reasonText, pickupAddress}` | 201 `{claimId}` → `ClaimComplete` | 반품과 같음(422 `REFUND_ACCOUNT_REQUIRED` 제외 — 교환 본문에는 환불 계좌 칸이 없다) + 409 `EXCHANGE_NOT_ALLOWED {lineId, why}`(`why` = `BUYER_FAULT_REASON`·`OTHER_PRODUCT`·`PRICE_DIFFERS`·`SKU_UNAVAILABLE`) | `ClaimRoutes.requestExchange` → `ClaimService.request` — `C-16` |
| `GET /api/claims/{claimId}` | path. 회원 세션 또는 그 클레임의 주문을 `guestOrderIds`에 담은 조회 토큰 | 200 `{claimId, orderId, type, status, lines[{lineId, skuId, newSkuId?, quantity}], reasonCode, faultParty, estimatedRefund, refund?{amount, returnFee, refundedAt}, history[]}` | 401, 404(남의 클레임도 404 — 있는지 알리지 않는다) | `ClaimRoutes.getClaim` → `ClaimRepository.findForRequester` — `C-16` |
| `GET /api/members/me/claims` | `?page=&period=` — 회원 전용 | 200 내 클레임 목록(최신순) | 401 | `ClaimRoutes.listMine` → `ClaimRepository.listByMember` — `C-16` |
| `POST /api/claims/{claimId}/withdraw` | path(본문 없음) | 200 `{status:'WITHDRAWN'}` | 401, 404, 409 `NOT_WITHDRAWABLE {status}`(회수 확인 뒤) | `ClaimRoutes.withdraw` → `ClaimService.withdraw` — `C-16` |
| `GET /api/admin/claims`·`GET /api/admin/claims/{claimId}` | `?status=&type=&from=&to=&page=` / path | 200 목록 / 상세(회수지·환불 계좌는 뒤 4자리만, 환불 시도 기록 포함) | 404 | `ClaimAdminRoutes.search`·`getDetail` → `ClaimRepository` — `C-16`·`R-21` |
| `POST /api/admin/claims/{claimId}/collect` | path(본문 없음) | 200 `{status:'COLLECTED'}` | 404, 409 `INVALID_STATE {status}` | `ClaimAdminRoutes.collect` → `ClaimService.collect` — `C-16` |
| `POST /api/admin/claims/{claimId}/complete` | 반품: `{inspection:'OK'·'DAMAGED', faultParty:'BUYER'·'SELLER'}`, 교환: `{inspection}` | 200 반품 `{status:'COMPLETED', refundAmount, returnFee}`, 교환 `{status:'COMPLETED'}` | 404, 409 `INVALID_STATE {status}`·`REFUND_TERMS_FIXED`(재시도 때 검수·귀책을 바꿈)·`EXCHANGE_OUT_OF_STOCK {skuIds}`, 502 `REFUND_FAILED {result:'failed'·'unknown', code?, pgCode?}`(`code`는 `PaymentApi.cancel`의 `failed.code`) — 클레임은 `REFUND_PENDING`으로 남는다 | `ClaimAdminRoutes.complete` → `ClaimService.completeReturn`·`completeExchange` — `C-16`·`R-21` |
| `POST /api/admin/claims/{claimId}/reject` | `{reasonText}`(필수, 고객에게 보인다) | 200 `{status:'REJECTED'}` | 404, 409 `INVALID_STATE {status}`, 422 `VALIDATION_FAILED` | `ClaimAdminRoutes.reject` → `ClaimService.reject` — `C-16` |
| 서비스 `purgeExpired(now)` | 지금 시각 — mall-api 스케줄러의 하루 1회 보존 작업이 공용 인터페이스 `RetentionTask`로 부른다 | `PurgeResult {task:'claim', deleted}` — 지운 클레임 수 | — (실패하면 다음 날 다시) | `ClaimRetention.purgeExpired`(`RetentionTask` 구현) — `C-20` |

- **불변조건**: 한 품목에 진행 중인 클레임은 하나다. claim이 지키는 것이 아니라 order의 조건부 `markLineClaim`이 두 번째 표시를 거절한다(상위 §6.2). 클레임 종류(`RETURN`·`EXCHANGE`)와 품목 목록은 신청 뒤 바뀌지 않는다.
- **수량 단위**: 품목(주문 품목 한 행) 전량만 신청한다 — 같은 SKU 3개를 산 품목의 1개만 반품하는 것은 받지 않는다(잠정 — §8). `claim_lines.quantity`는 지금은 품목 수량과 같다.
- **환불 조건 고정**: 반품 완료를 처음 누를 때 검수·귀책·환불액이 정해져 저장된다. 다시 누를 때(`REFUND_PENDING` 재시도) 본문이 다르면 409 `REFUND_TERMS_FIXED`다 — 같은 멱등 키에 다른 금액을 보내지 않으려는 것이다(§3 `JF-2.1`).
- **비회원**: 조회 토큰(30분 — 상위 `D-07`)으로 신청·조회·철회를 한다. 한 토큰이 같은 브라우저의 비회원 주문을 최대 5개 가리키므로, 주체는 `GUEST {guestOrderIds[]}`이고 claim은 「요청한 주문(또는 클레임의 주문) ∈ `guestOrderIds`」로 판단한다. `GET /api/members/me/claims`는 회원만이다.
- **재시도**: 고객 라우트는 멱등 키를 받지 않는다. 신청을 두 번 보내면 두 번째는 order 표시 가드에 걸려 409 `NOT_CLAIMABLE {why:'CLAIM_IN_PROGRESS'}`다. 운영 `complete`는 몇 번 눌러도 환불은 한 번이다(조건부 전이 + 멱등 키 `claim:<claimId>`).

### 2.1 사유 코드와 귀책

고객은 사유 코드를 고르고, 귀책은 그 코드로 **잠정** 정한다. 운영자는 반품 검수 때 실제 귀책(`faultParty`)을 확정한다 — 「불량」으로 신청했는데 불량이 아니면 `BUYER`로 바꿔 반품 배송비를 차감한다.

| `reasonCode` | 뜻 | 잠정 귀책 | 반품 | 교환 |
|---|---|---|---|---|
| `CHANGE_OF_MIND` | 단순 변심 | `BUYER` | 받는다 — 반품 배송비 차감 | 받지 않는다(잠정 — §8) |
| `SIZE_COLOR` | 사이즈·색상이 맞지 않음 | `BUYER` | 받는다 — 반품 배송비 차감 | 받지 않는다(잠정 — §8) |
| `DEFECTIVE` | 불량·파손 | `SELLER` | 받는다 — 무료 | 받는다 — 같은 상품·같은 가격 옵션 |
| `WRONG_ITEM` | 오배송(다른 상품·옵션이 옴) | `SELLER` | 받는다 — 무료 | 받는다 — 원래 주문한 옵션도 고를 수 있다 |
| `NOT_AS_DESCRIBED` | 상품 정보와 다름 | `SELLER` | 받는다 — 무료 | 받는다 |

- `reasonText`는 0~500자, `DEFECTIVE`·`NOT_AS_DESCRIBED`는 10자 이상(무엇이 문제인지). 사진 첨부는 받지 않는다(잠정 — 리뷰처럼 업로드 URL을 쓰면 더할 수 있다).
- 교환은 같은 상품의 판매중 SKU 가운데 **단가가 원래 SKU와 같은** 것만 고른다(상위 §9.5 「교환 차액」). 품절 SKU는 신청 때 409 `EXCHANGE_NOT_ALLOWED {why:'SKU_UNAVAILABLE'}`다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 조율자는 `ClaimService` 하나다. 고객·운영 라우트(`ClaimRoutes`·`ClaimAdminRoutes`)는 주체 확인과 응답 변환만 하고, 판단은 순수 객체 `ClaimPolicy`(신청 검사)와 `RefundCalculator`(환불액)에, 저장과 조건부 전이는 `ClaimRepository`에 맡긴다. 다른 모듈은 이 경계 쪽 공개 인터페이스 넷 — `OrderApi`·`PaymentApi`·`CatalogApi`·`NotificationApi` — 으로만 부른다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5.12](../system-design-to-be.md#512-반품교환--신청에서-검수-완료까지)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Claim.request`(§5.1 — 고객 클레임 라우트 묶음) · `Claim.requestReturn`(§5.12) · (그림 밖) 교환 신청 | [`JF-1` 고객 라우트 진입](#jf-1-고객-라우트-진입--claimroutes) | [`JF-1.1` 반품·교환 신청](#jf-11-반품교환-신청--claimservicerequest), [`JF-1.2` 고객 철회](#jf-12-고객-철회--claimservicewithdraw) |
| `Claim.inspect`(§5.1 — 운영 클레임 라우트 묶음) · `Claim.completeReturn`(§5.12) · (그림 밖) 회수 확인·교환 완료·거절 | [`JF-2` 운영 라우트 진입](#jf-2-운영-라우트-진입--claimadminroutes) | `completeReturn` → [`JF-2.1` 반품 완료](#jf-21-반품-완료--claimservicecompletereturn), 교환 완료 → [`JF-2.2` 교환 완료](#jf-22-교환-완료--claimservicecompleteexchange), 회수 확인·거절 → [`JF-2.3` 회수 확인과 거절](#jf-23-회수-확인과-거절--claimservicecollectreject) |
| `Claim.purgeExpired`([§5.17](../system-design-to-be.md#517-주기-정리--보존-파기탈퇴-정리) — mall-api 보존 작업) | [`JF-3` 보존 기한 파기](#jf-3-보존-기한-파기--claimretentionpurgeexpired) | — |

상위의 바깥 노드 ↔ 이 경계의 인터페이스 객체: `Order.claimSupport`·`Order.getClaimableLines`·`Order.markLineClaim` = `OrderApi.getClaimableLines`·`markLineClaim`, `Payment.pay`·`Payment.cancel` = `PaymentApi.cancel`, `Catalog.stockLifecycle`·`Catalog.releaseStock` = `CatalogApi.reserveStock`·`commitReservation`·`releaseStock`, `Catalog.getSkus`(상위 §5.1 `Claim.request --> Catalog.getSkus` — 교환 신청 검사) = `CatalogApi.getSkus`, `Notification.enqueue` = `NotificationApi.enqueue`. 그림에서 다른 경계는 모두 이 `…Api` 객체로 그린다.

**표기** 노드는 제안 클래스·메서드다(Java 21 + Spring Boot 3 잠정 — 상위 §9.5). `…Api`는 상대 모듈이 공개 패키지에 낸 서비스 인터페이스이고, 같은 프로세스 안의 메서드 호출이다(HTTP 아님). 트랜잭션 경계는 `ClaimService`의 유스케이스 메서드다(상위 §6.3) — 그림에는 그리지 않고 표·불릿에 적는다. 렌더 확인은 이 문서의 jobflow 블록 전부를 대상으로 했다(§7 「이미 실행한 검사」). 열지 않은 것: `ClaimPolicy`·`RefundCalculator`(순수 함수 — 규칙은 §2.1·§3.1), `ClaimRepository`(저장소 — 표는 §4).

### JF-1 고객 라우트 진입 — ClaimRoutes

```jobflow
orchestrator: ClaimRoutes
Object: ClaimRoutes, ClaimService, ClaimRepository

ClaimRoutes.requestReturn --> ClaimService.request
ClaimRoutes.requestExchange --> ClaimService.request
ClaimRoutes.getClaim --> ClaimRepository.findForRequester
ClaimRepository.findForRequester.notVisible
ClaimRoutes.listMine --> ClaimRepository.listByMember
ClaimRoutes.withdraw --> ClaimService.withdraw
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ClaimRoutes.requestReturn`·`requestExchange` → `ClaimService.request` | `C-16`·`R-14` | 상위 `Claim.requestReturn`과 그림 밖 교환 신청. 본문 형식 검사(필수 필드·글자 수·우편번호 5자리)는 라우트에서 하고 422 `VALIDATION_FAILED`. 요청 주체 `Principal`(회원 ID 또는 `guestOrderIds`)을 `request`에 넘긴다. 결과를 201·403·404·409로 바꾼다 — 안쪽은 `JF-1.1` |
| `getClaim` → `ClaimRepository.findForRequester`·`.notVisible` | `C-16`·`D-07` | 회원은 `requester_member_id`가 같을 때, 비회원은 클레임의 `order_id`가 주체의 `guestOrderIds`에 들어 있을 때만 읽는다. 아니면 `.notVisible` → 404(남의 클레임이 있는지 알리지 않는다) |
| `listMine` → `ClaimRepository.listByMember` | `C-16` | 회원 전용. 비회원 토큰은 미들웨어가 401로 막는다 |
| `withdraw` → `ClaimService.withdraw` | `C-16` | 주체 확인은 `getClaim`과 같다. 안쪽은 `JF-1.2` |

- **트리거** 상위 `Claim.request` 묶음 — 고객의 「반품 신청」·「교환 신청」(N6 `ReturnRequestForm`·`ExchangeRequestForm`), `ClaimComplete`·마이페이지의 클레임 조회, 「반품 철회」. **완료 사실** 201 `{claimId}`, 클레임 상세·목록, 철회 확정.
- `ClaimService.request`로 들어오는 두 화살표는 서로 다른 라우트(트리거)의 **합류**다. 요청 하나에 `request`는 한 번 실행되고, 같은 품목의 두 번째 신청은 order 표시 가드가 막는다(`JF-1.1`).

### JF-1.1 반품·교환 신청 — ClaimService.request

```jobflow
orchestrator: ClaimService
Object: ClaimService, ClaimPolicy, OrderApi, CatalogApi, ClaimRepository, NotificationApi

ClaimService.request --> OrderApi.getClaimableLines
OrderApi.getClaimableLines.result --> ClaimPolicy.checkRequest
ClaimPolicy.checkRequest.rejected
ClaimService.request --> CatalogApi.getSkus
CatalogApi.getSkus.result --> ClaimPolicy.checkExchange
ClaimPolicy.checkExchange.rejected
ClaimService.request --> ClaimRepository.insertRequested
ClaimService.request --> OrderApi.markLineClaim
OrderApi.markLineClaim.conflict
ClaimService.request --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OrderApi.getClaimableLines` | `R-14`·`D-02` | 상위 `Order.getClaimableLines`. `getClaimableLines(orderId, requester)` → `claimable {orderId, paymentRef{orderId, orderNo}, paymentMethod, orderer{name, phone}, itemsAmount, discountAmount, shippingFee, freeShippingApplied, lines[{lineId, skuId, status, claimMark, claimId, deliveredAt, allocatedAmount, claimable, why?}]}`. 주체가 주문 소유자가 아니면(비회원은 주문이 `guestOrderIds`에 없으면) `notOwner` → 403, 주문이 없으면 `notFound` → 404 |
| `ClaimPolicy.checkRequest`·`.rejected` | `R-14`·`R-15`·`R-25` | 순수 판단. 신청한 품목마다 order가 준 `claimable`·`why`를 그대로 쓴다 — `why` = `NOT_DELIVERED`·`WINDOW_EXPIRED`(배송 완료 + 7일 경과)·`CONFIRMED`·`CLAIM_IN_PROGRESS`·`ALREADY_RETURNED`. claim이 기한을 따로 계산하지 않는다. 반품이고 가상계좌 결제 주문인데 `refundAccount`가 없으면 거절(교환은 이 검사를 하지 않는다 — 본문에 그 칸이 없다). 하나라도 걸리면 `.rejected` → 409 `NOT_CLAIMABLE {lineId, why}`·422 `REFUND_ACCOUNT_REQUIRED`. 사유 코드가 `BUYER` 귀책인데 교환이면 409 `EXCHANGE_NOT_ALLOWED {why:'BUYER_FAULT_REASON'}`(§2.1) |
| `CatalogApi.getSkus` → `ClaimPolicy.checkExchange`·`.rejected` | `C-16`·`C-05` | 교환일 때만 부른다. `getSkus(newSkuIds)` → 상품·단가·판매 상태·재고 여부. 같은 상품·같은 단가·판매중·재고 있음이 아니면 `.rejected` → 409 `EXCHANGE_NOT_ALLOWED`. 재고는 여기서 잡지 않는다 — 확보는 교환 완료 때(`JF-2.2`) |
| `ClaimRepository.insertRequested` | `C-16` | `claims`(`REQUESTED`, 잠정 귀책, 회수지, 가상계좌 주문의 반품이면 암호화한 환불 계좌)·`claim_lines`·`claim_status_history` 저장 |
| `OrderApi.markLineClaim`·`.conflict` | `R-14`·`D-02` | 상위 `Order.markLineClaim`. `markLineClaim(lineIds, claimId, RETURN_REQUESTED·EXCHANGE_REQUESTED)` → `marked`·`conflict {lineId, why}`. 검사 뒤 다른 신청이 먼저 표시했으면 order가 `conflict`를 준다 → `.conflict` — 트랜잭션 롤백, 409 `NOT_CLAIMABLE {lineId, why}`(order의 `why`를 그대로 — 대개 `CLAIM_IN_PROGRESS`) |
| `NotificationApi.enqueue` | `R-22`·`D-06` | 상위 `Notification.enqueue`. `enqueue('CLAIM_REQUESTED', 주문자 휴대폰, {orderNo, orderId, claimType, productSummary}, 'claim-requested:<claimId>')` — `orderId`·`claimType`은 늘 싣는다(「주문 상세」 버튼 주소와 반품·교환 문구) |

- **트리거** `JF-1`의 두 신청 라우트. **완료 사실** 클레임 `REQUESTED` + 품목 표시 + 접수 알림 1건 — 한 트랜잭션이다(상위 §6.3의 7번). 롤백되면 클레임·표시·알림이 함께 사라진다.
- **실패 분기** 단독 줄 셋(`checkRequest.rejected`·`checkExchange.rejected`·`markLineClaim.conflict`)은 모두 오류 응답으로 끝난다 — 그 뒤 이 그림의 객체를 더 부르지 않는다. 앞의 둘은 저장 전이라 남는 것이 없고, 셋째는 롤백한다.
- 검사(`checkRequest`)와 표시(`markLineClaim`) 사이에 다른 신청이 끼어들 수 있다. 검사는 화면에 이유를 돌려주려는 것이고, 경합의 최종 방어는 order의 조건부 표시다. 그래서 claim 쪽에 품목 잠금을 두지 않는다.
- 반품이면 `getSkus`·`checkExchange` 두 줄을 건너뛰고 `insertRequested`로 간다. 줄 순서는 실행 순서와 같다.
- `Object:` 순서는 손으로 골랐다 — `ClaimPolicy`를 `OrderApi`보다 왼쪽에 두었다. 처음 호출 순서(`OrderApi` 먼저)대로 두면 뒤에 오는 `markLineClaim`이 `getSkus`보다 위 행에 끼어들고 그 결과 점선이 가로선과 교차했다.

### JF-1.2 고객 철회 — ClaimService.withdraw

```jobflow
orchestrator: ClaimService
Object: ClaimService, ClaimRepository, OrderApi

ClaimService.withdraw --> ClaimRepository.transition
ClaimRepository.transition.notRequested
ClaimService.withdraw --> OrderApi.markLineClaim
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ClaimRepository.transition`·`.notRequested` | `C-16` | 조건부 `REQUESTED → WITHDRAWN`(행 하나, 이력 1행, 환불 계좌 즉시 삭제). 회수 확인 뒤면 0행 → `.notRequested` → 409 `NOT_WITHDRAWABLE {status}` |
| `OrderApi.markLineClaim` | `C-16`·`R-24` | `markLineClaim(lineIds, claimId, NONE)` — 품목 표시를 지운다. `conflict`면(표시가 이 클레임의 것이 아님 — 정상 흐름에서는 없다) 트랜잭션을 롤백하고 409. 지우면 그 품목은 다시 자동 구매확정 대상이 되고, 기한 안이면 다시 신청할 수 있다 |

- **트리거** 고객의 「반품 철회」·「교환 철회」(회수 전만). **완료 사실** 클레임 `WITHDRAWN` + 품목 표시 해제 — 한 트랜잭션. 철회 알림은 보내지 않는다(고객이 한 일이라 화면 토스트로 충분 — 잠정).
- 철회는 회수 확인 전까지만이다. 회수 택배가 이미 출발했어도 운영자가 회수 확인을 누르기 전이면 철회된다 — 운영자는 도착한 물건을 클레임 없이 받게 된다(§8).

### JF-2 운영 라우트 진입 — ClaimAdminRoutes

```jobflow
orchestrator: ClaimAdminRoutes
Object: ClaimAdminRoutes, ClaimRepository, ClaimService

ClaimAdminRoutes.search --> ClaimRepository.search
ClaimAdminRoutes.getDetail --> ClaimRepository.findById
ClaimAdminRoutes.collect --> ClaimService.collect
ClaimAdminRoutes.complete --> ClaimRepository.findById
ClaimRepository.findById.returnClaim --> ClaimService.completeReturn
ClaimRepository.findById.exchangeClaim --> ClaimService.completeExchange
ClaimAdminRoutes.reject --> ClaimService.reject
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `search`·`getDetail` → `ClaimRepository` | `R-21` | 운영 목록(상태·종류·기간)과 상세. 회수지·환불 계좌는 가려서 낸다 |
| `collect` → `ClaimService.collect` | `C-16`·`R-21` | 그림 밖 「회수 확인」. 안쪽은 `JF-2.3` |
| `complete` → `ClaimRepository.findById` → `.returnClaim`·`.exchangeClaim` | `C-16`·`R-21` | 상위 `Claim.completeReturn`(반품 클레임)과 그림 밖 「교환 완료」가 같은 라우트다. 클레임 종류(바뀌지 않는 값)를 읽어 갈래를 고른다. 없으면 404(그리지 않음). 반품 본문에 `faultParty`가 없으면 422 |
| `ClaimService.completeReturn` | `C-16`·`R-14`·`R-21` | 안쪽은 `JF-2.1`. 결과를 200·409·502로 바꾼다 |
| `ClaimService.completeExchange` | `C-16` | 안쪽은 `JF-2.2`. 결과를 200·409로 바꾼다 |
| `reject` → `ClaimService.reject` | `C-16` | 그림 밖 「거절」. 안쪽은 `JF-2.3` |

- **트리거** 상위 `Claim.inspect` 묶음 — admin-web 클레임 화면의 조회·「회수 확인」·「검수 완료」·「거절」. **완료 사실** 클레임 `COLLECTED`·`COMPLETED`·`REJECTED` 또는 `REFUND_PENDING`(환불 실패·결과 불명).
- `ClaimRepository.findById`로 들어오는 두 화살표는 서로 다른 라우트(상세 조회·완료)의 각자 요청이다. 같은 계약을 다른 목적으로 부를 뿐이고 서로를 기다리지 않는다. 값 분기 둘은 `complete` 쪽 조회의 값이다.

### JF-2.1 반품 완료 — ClaimService.completeReturn

```jobflow
orchestrator: ClaimService
Object: ClaimService, ClaimRepository, OrderApi, RefundCalculator, PaymentApi, CatalogApi, NotificationApi

ClaimService.completeReturn --> ClaimRepository.lockForRefund
ClaimRepository.lockForRefund.invalidState
ClaimRepository.lockForRefund.termsChanged
ClaimRepository.lockForRefund.firstAttempt --> OrderApi.getClaimableLines
OrderApi.getClaimableLines.result --> RefundCalculator.calculate
RefundCalculator.calculate.result --> ClaimRepository.fixRefundTerms
ClaimService.completeReturn --> PaymentApi.cancel
PaymentApi.cancel.failed
PaymentApi.cancel.unknown
PaymentApi.cancel.cancelled --> ClaimService.finishReturn
ClaimService.finishReturn --> ClaimRepository.markCompleted
ClaimService.finishReturn --> CatalogApi.releaseStock
ClaimService.finishReturn --> OrderApi.markLineClaim
ClaimService.finishReturn --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ClaimRepository.lockForRefund`·`.invalidState`·`.termsChanged` | `C-16`·`R-18` | 트랜잭션 A 시작. **주문 단위로 잠근다** — 같은 `order_id`의 클레임 행을 모두 `SELECT … FOR UPDATE`(id 순)로 잠가, 한 주문의 두 반품 완료 계산이 겹치지 않게 한다. 그 행들에서 이 클레임의 상태와, 같은 주문의 `REFUND_PENDING`·`COMPLETED` 반품 클레임(품목·초기 배송비 차감·환불 내역)을 함께 읽는다. `COLLECTED`면 `.firstAttempt`. `REFUND_PENDING`이면 저장된 조건을 쓰고(재시도) 본문의 검수·귀책이 다르면 `.termsChanged` → 409 `REFUND_TERMS_FIXED`. `COMPLETED`면 200(이미 끝남, 그리지 않음), 그 밖은 `.invalidState` → 409 |
| `.firstAttempt` → `OrderApi.getClaimableLines` | `C-16`·`D-02` | 상위 `Order.claimSupport`. 신청 때와 같은 계약을 금액을 다시 읽으려고 부른다 — 같은 주문의 다른 반품이 먼저 끝났거나 환불 대기면 무료배송 기준 판정이 달라지기 때문이다 |
| `RefundCalculator.calculate` | `C-16`·`C-07` | 순수 계산 — 규칙과 예는 §3.1. 입력은 order의 주문·품목 값, 이번 반품 품목·검수·귀책, 그리고 `lockForRefund`가 읽은 같은 주문의 `REFUND_PENDING`·`COMPLETED` 반품(「이미 반품된 품목」과 초기 배송비를 이미 차감·환불했는지). 출력 `{refundAmount, returnFee, initialShippingCharge, initialShippingRefund}` |
| `ClaimRepository.fixRefundTerms` | `C-16` | 조건부 `COLLECTED → REFUND_PENDING` + 검수·확정 귀책·환불액 저장 + 이력. 트랜잭션 A 커밋 — 여기서부터 금액이 고정이다 |
| `PaymentApi.cancel`·`.failed`·`.unknown` | `C-12`·`C-16`·`D-04` | 상위 `Payment.cancel`. 트랜잭션 밖. `cancel(orderRef, refundAmount, '반품 <claimNo>', 'claim:<claimId>', 'REFUND', refundAccount?)` — `orderRef`는 order가 준 `paymentRef {orderId, orderNo}`, 가상계좌 결제 주문이면 신청 때 받은 환불 계좌를 복호화해 넘긴다. `.failed {code}`·`.unknown`은 예외가 아닌 결과다 — 모두 `REFUND_PENDING`을 유지하고 시도 횟수·`last_refund_error`(결과·코드·PG 코드)만 기록한 뒤 502 `REFUND_FAILED {result, code?, pgCode?}`. 코드별 다음 동작은 아래 표 |
| `.cancelled` → `ClaimService.finishReturn` | `C-16` | 트랜잭션 B를 여는 같은 객체 안 메서드. 환불액이 0원이면 `cancel`을 부르지 않고 바로 `finishReturn`으로 간다(그리지 않음) |
| `ClaimRepository.markCompleted` | `C-16` | 조건부 `REFUND_PENDING → COMPLETED` + 환불 시각 + 환불 계좌 삭제. 0행(동시에 누른 다른 요청이 먼저 끝냄)이면 나머지를 부르지 않고 200 |
| `CatalogApi.releaseStock` | `C-06`·`D-03` | 상위 `Catalog.releaseStock`. `releaseStock('order:<orderId>', 검수 OK 품목)` — 재입고. 검수 `DAMAGED`면 부르지 않는다(재입고 없이 기록) |
| `OrderApi.markLineClaim` | `C-16`·`D-02` | `markLineClaim(lineIds, claimId, RETURNED)` → `marked`(`conflict`는 이 클레임의 표시가 아니라는 뜻이라 트랜잭션 B를 롤백하고 500 + 경보 — 정상 흐름에서는 없다). 주문 상태(`PARTIALLY_RETURNED`·`RETURNED`)는 order가 품목 표시로 정한다(상위 [§5.18](../system-design-to-be.md#518-주문-상태--여러-경계가-나눠-가진-기록)) |
| `NotificationApi.enqueue` | `R-22` | `enqueue('CLAIM_COMPLETED', 주문자 휴대폰, {orderNo, orderId, claimType:'RETURN', refundAmount, returnFee}, 'claim-completed:<claimId>')` |


**`PaymentApi.cancel` 결과별 처리** — 어느 결과든 환불 조건(금액·멱등 키)은 바꾸지 않는다. `failed`는 PG에서 돈이 움직이지 않았다는 사실이라, 원인을 고친 뒤 같은 키로 다시 부르면 payment가 시도 번호를 올려 새로 요청한다.

| 결과 | 클레임 | 운영자에게 보이는 사유·다음 동작 |
|---|---|---|
| `cancelled` | 트랜잭션 B → `COMPLETED` | — |
| `unknown` | `REFUND_PENDING` 유지, 사유 `PG_UNKNOWN` | 다시 누른다 — 같은 키라 PG가 원래 결과를 돌려준다 |
| `failed CANCEL_IN_PROGRESS` | 유지, 사유 기록 | 같은 결제의 다른 취소(다른 반품의 환불 결과 불명 등)가 걸려 있다 — 그 클레임을 먼저 닫고 다시 누른다 |
| `failed PG_REJECTED {pgCode}` | 유지, 사유·PG 코드 기록 | PG 거절(계좌 오류 등). 원인을 확인하고 다시 누르거나 고객과 통화한다 — 계좌를 고치는 계약은 없다(§8) |
| `failed REFUND_ACCOUNT_REQUIRED` | 유지, 사유 기록 + 경보 | 신청 검사에서 막았어야 하는 경우(계좌가 지워짐 등) — 데이터 이상이라 경보를 남긴다 |
| `failed NOT_CANCELLABLE {status}` | 유지, 사유 기록 + 경보 | 결제가 이미 전액 취소됨(PG 콘솔 취소 등)·결제 기록 이상 — PG 콘솔에서 사실을 확인한 뒤 처리한다 |
| `failed ALREADY_DEPOSITED` | 유지, 사유 기록 + 경보 | `REFUND` 모드에서는 나오지 않는 코드다 — 나오면 호출 이상으로 본다 |

- **트리거** 운영자의 「검수 완료」(반품 클레임) — 상위 `AdminBrowser.completeClaim --> Claim.completeReturn`. **완료 사실** 클레임 `COMPLETED` + PG 부분 취소 1건 + 재입고(검수 OK) + 품목 `RETURNED` + 완료 알림 — 끝의 넷은 트랜잭션 B 하나다(상위 §6.3의 9번 「반품 완료 확정」 — 트랜잭션 A는 8번 「반품 완료 시작」).
- **대표 실패 흐름(부분 실패)** 트랜잭션은 둘이고 그 사이에 PG 호출이 있다. 트랜잭션 A가 환불 조건을 `REFUND_PENDING`으로 고정한 뒤 PG가 거절·결과 불명이면 클레임은 거기 머문다. 운영자가 다시 누르면 `lockForRefund`가 저장된 금액을 꺼내 **같은 금액·같은 멱등 키** `claim:<claimId>`로 다시 부른다 — 첫 시도가 실제로는 성공했으면 PG가 같은 결과를 돌려준다(가정 — 업체 멱등 지원, 상위 §9.5). 재입고·품목 표시는 트랜잭션 B에만 있어 환불 없이 재입고되는 일이 없다(`R-21`).
- **두 번 누름·동시 처리** 두 운영자가 함께 누르면 `lockForRefund`의 주문 단위 잠금이 트랜잭션 A를 줄 세운다. 같은 주문의 **다른** 반품 클레임 둘을 함께 눌러도 같은 잠금으로 줄을 서고, 둘째는 첫째가 `REFUND_PENDING`으로 고정한 품목을 「이미 반품됨」으로 세어 계산한다 — 무료배송 회수·초기 배송비 환불이 두 번 일어나지 않는다(§3.1). 둘째는 `REFUND_PENDING`을 보고 같은 조건으로 PG를 부르고(같은 멱등 키 — PG 취소 1건), `markCompleted`의 조건부 전이가 트랜잭션 B를 하나만 통과시킨다.
- 트랜잭션 B가 실패하면(DB 오류) PG 환불은 끝났는데 클레임은 `REFUND_PENDING`이다. 다시 누르면 PG가 멱등 응답으로 `cancelled`를 주고 B를 다시 한다 — 이중 환불이 없다. 망취소 같은 되돌림은 두지 않는다(환불은 고객에게 유리한 방향이라 되돌릴 이유가 없다).
- `ClaimService.finishReturn`은 같은 객체 안 화살표로 그렸다 — 트랜잭션 A와 B를 가르는 자리를 보이려는 것이고 round-trip이 아니다(`completeReturn`이 `finishReturn`에 책임을 넘긴다).

### JF-2.2 교환 완료 — ClaimService.completeExchange

```jobflow
orchestrator: ClaimService
Object: ClaimService, ClaimRepository, CatalogApi, OrderApi, NotificationApi

ClaimService.completeExchange --> ClaimRepository.markCompleted
ClaimRepository.markCompleted.invalidState
ClaimService.completeExchange --> CatalogApi.reserveStock
CatalogApi.reserveStock.outOfStock
ClaimService.completeExchange --> CatalogApi.commitReservation
ClaimService.completeExchange --> CatalogApi.releaseStock
ClaimService.completeExchange --> OrderApi.markLineClaim
ClaimService.completeExchange --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ClaimRepository.markCompleted`·`.invalidState` | `C-16` | 조건부 `COLLECTED → COMPLETED` + 검수 결과 + 이력. 0행이면 `.invalidState` → 409(이미 완료면 200) |
| `CatalogApi.reserveStock`·`.outOfStock` | `C-06`·`D-03` | `reserveStock('claim:<claimId>', [{newSkuId, quantity}], holdUntil = 지금+30분)`. 신청 뒤 품절됐으면 `.outOfStock` → 트랜잭션 롤백, 409 `EXCHANGE_OUT_OF_STOCK {skuIds}` — 클레임은 `COLLECTED`로 남는다 |
| `CatalogApi.commitReservation` | `C-06` | `commitReservation('claim:<claimId>')` — 같은 트랜잭션에서 바로 확정한다. 재발송은 운영자가 이 뒤에 한다 |
| `CatalogApi.releaseStock` | `C-06` | 회수한 원래 품목의 재입고 — `releaseStock('order:<orderId>', 회수 품목)`. 검수 `OK`일 때만. 교환 사유가 불량이라 대개 `DAMAGED`이고 그때는 부르지 않는다 |
| `OrderApi.markLineClaim` | `C-16`·`D-02` | `markLineClaim(lineIds, claimId, EXCHANGED, exchangeSkuIds)` — `exchangeSkuIds`는 `lineIds`와 같은 순서의 새 SKU 목록이고, order가 품목의 `exchange_sku_id`에 저장한다. order는 이 표시를 보고 그 품목에 `claimId`가 실린 재발송 송장을 받는다. `conflict`면 트랜잭션 롤백, 409 |
| `NotificationApi.enqueue` | `R-22` | `enqueue('CLAIM_COMPLETED', 주문자 휴대폰, {orderNo, orderId, claimType:'EXCHANGE'}, 'claim-completed:<claimId>')` — 「교환 상품을 보낼 준비를 한다」. 배송 시작 알림은 송장 등록 때 order가 보낸다 |

- **트리거** 운영자의 「검수 완료」(교환 클레임). **완료 사실** 클레임 `COMPLETED` + 새 SKU 재고 확정 + 회수 품목 재입고(검수 OK) + 품목 `EXCHANGED` + 완료 알림 — 한 트랜잭션. PG 호출이 없어 결과 불명 상태가 없다.
- **실패 분기** 품절(`.outOfStock`)이면 운영자는 입고를 기다려 다시 누르거나, 고객과 통화한 뒤 거절한다(§8 — 교환 대신 반품으로 바꾸는 계약은 두지 않았다).
- 재발송: 운영자가 admin-web에서 order `registerShipment {lineIds, carrierCode, trackingNumber, claimId}`를 부른다(상위 [§5.11](../system-design-to-be.md#511-배송--송장-등록배송-추적배송-완료)). claim은 송장을 모른다 — 클레임 `COMPLETED`는 「새 상품 확보와 품목 표시」까지다.
- 줄 순서는 실행 순서다. `markCompleted`를 먼저 두어 동시에 누른 두 번째 요청이 재고를 잡기 전에 멈춘다.

### JF-2.3 회수 확인과 거절 — ClaimService.collect·reject

```jobflow
orchestrator: ClaimService
Object: ClaimService, ClaimRepository, OrderApi, NotificationApi

ClaimService.collect --> ClaimRepository.transition
ClaimRepository.transition.invalidState
ClaimService.reject --> ClaimRepository.transition
ClaimService.reject --> OrderApi.markLineClaim
ClaimService.reject --> NotificationApi.enqueue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `collect` → `ClaimRepository.transition`·`.invalidState` | `C-16`·`R-21` | 조건부 `REQUESTED → COLLECTED` + 회수 시각 + 이력. 다른 상태면 `.invalidState` → 409. 다른 모듈을 부르지 않는다 |
| `reject` → `ClaimRepository.transition` | `C-16` | 조건부 `REQUESTED·COLLECTED → REJECTED` + 거절 사유 + 환불 계좌 삭제. `REFUND_PENDING`·`COMPLETED`는 거절할 수 없다 → 409(`.invalidState`와 같은 뜻) |
| `OrderApi.markLineClaim` | `C-16`·`D-02` | `markLineClaim(lineIds, claimId, CLAIM_REJECTED)` → `marked`(`conflict`면 롤백, 409). 진행 중 클레임이 아니므로 기한 안이면 다시 신청할 수 있고, 자동 구매확정 대상으로 돌아간다 |
| `NotificationApi.enqueue` | `R-22` | `enqueue('CLAIM_REJECTED', 주문자 휴대폰, {orderNo, orderId, claimType, reasonText}, 'claim-rejected:<claimId>')` — 템플릿은 상위 §9.5의 8종 가운데 하나다 |

- **트리거** 운영자의 「회수 확인」·「거절」. **완료 사실** `COLLECTED`, 또는 `REJECTED` + 품목 표시 + 거절 알림(한 트랜잭션).
- `ClaimRepository.transition`으로 들어오는 화살표 둘은 서로 다른 라우트의 각자 요청이다. 단독 줄 `.invalidState`는 두 요청에 공통인 거절 값이다 — 렌더러는 첫 칸 아래에 그린다.
- 회수 뒤 거절(검수에서 구매자 훼손 확인 등)이면 회수한 물건을 고객에게 다시 보내야 한다. 그 발송은 이 시스템 밖이다(운영자가 택배로 직접 — §8).

### JF-3 보존 기한 파기 — ClaimRetention.purgeExpired

```jobflow
orchestrator: ClaimRetention
Object: ClaimRetention, ClaimRepository

ClaimRetention.purgeExpired --> ClaimRepository.findExpired
ClaimRepository.findExpired.result --> ClaimRepository.deleteClaims
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ClaimRepository.findExpired` | `C-20`·`R-25` | 끝난 클레임 가운데 보존 기한이 지난 것을 최대 1,000건 — 환불이 있는 반품 완료는 완료 뒤 5년, 그 밖(교환·거절·철회)은 끝난 뒤 3년(§4.3) |
| `.result` → `ClaimRepository.deleteClaims` | `C-20` | 세 테이블의 행을 지운다. 진행 중 클레임은 대상이 아니다 |

- **트리거** mall-api 스케줄러의 하루 1회 보존 작업이 `RetentionTask.purgeExpired(now)`로 부른다(상위 §5.17·§6.2). **완료 사실** 기한이 지난 클레임 행 삭제, `PurgeResult {task:'claim', deleted}`. 1,000건이 넘으면 다음 날 이어서 지운다.
- 같은 객체 안 화살표(`findExpired.result --> deleteClaims`)는 조율자가 조회 결과를 삭제에 넘기는 뜻이다. 결제 취소 기록(`payment_cancels`)은 payment가 따로 5년 보존한다.

### 3.1 환불액·반품 배송비 규칙

**잠정** — 상위 §9.5 「배송비 정책」(5만 원 이상 무료, 미만 3,000원)을 따른다. 금액은 원 단위 정수다.

```text
환불액 = Σ 반품 품목의 결제 안분액          ← order가 준 값. 쿠폰 할인을 품목에 나눈 뒤 금액
       − 반품 배송비                          ← 귀책이 BUYER일 때만
       + 초기 배송비 환불                     ← 귀책이 SELLER이고 이 반품으로 주문의 모든 품목이 반품될 때만
환불액 < 0 이면 0

무료배송 회수분·초기 배송비 환불은 주문당 한 번만 — 같은 주문의 REFUND_PENDING·COMPLETED 반품이
이미 차감(initial_shipping_charge > 0)했거나 환불(initial_shipping_refund > 0)했으면 0
```

| 경우(귀책 `BUYER`) | 반품 배송비 |
|---|---|
| 주문 때 배송비를 냈다 | 회수 편도 3,000원. 낸 초기 배송비는 돌려주지 않는다 — 고객 부담은 왕복 6,000원 |
| 무료배송 주문이고, 반품 뒤 남는 품목이 무료배송 기준(5만 원)을 넘는다 | 회수 편도 3,000원 |
| 무료배송 주문이고, 반품 뒤 남는 품목이 기준 미만이다(전체 반품 포함) | 왕복 6,000원 — 회수 3,000원 + 무료로 해 준 초기 배송비 3,000원. 같은 주문의 앞 반품이 회수분을 이미 차감했으면 회수 편도 3,000원만 |

| 예 | 계산 | 환불액 |
|---|---|---|
| 30,000원 품목 둘(무료배송), 쿠폰 6,000원 → 품목당 안분 27,000원. 단순 변심으로 하나 반품 | 남는 품목 30,000원 < 50,000원 → 27,000 − 6,000 | 21,000원 |
| 같은 주문, 불량으로 하나 반품 | 판매자 귀책 → 차감 없음 | 27,000원 |
| 20,000원 품목 하나 + 배송비 3,000원. 단순 변심 전체 반품 | 20,000 − 3,000 | 17,000원 |
| 같은 주문, 오배송 전체 반품 | 20,000 + 초기 배송비 3,000 | 23,000원 |
| 30,000원 품목 셋(무료배송, 쿠폰 없음). 단순 변심으로 하나 반품(남는 60,000원 ≥ 기준) 뒤, 또 하나 반품 | 첫째: 30,000 − 3,000. 둘째: 남는 30,000원 < 기준 → 30,000 − (3,000 + 회수분 3,000) | 27,000원, 24,000원 |
| 위 주문에서 마지막 하나를 불량으로 반품 | 판매자 귀책, 무료배송이라 초기 배송비 환불 0원. 앞서 차감한 회수분은 돌려주지 않는다(잠정 — §8) | 30,000원 |
| 위 주문에서 마지막 하나를 (불량 대신) 단순 변심으로 반품 | 남는 품목 0원 < 기준이지만 회수분은 둘째가 이미 차감 → 30,000 − 3,000 | 27,000원 |

- **「이미 반품됨」**: 같은 주문의 `REFUND_PENDING`·`COMPLETED` 반품 클레임의 품목이다(주문 단위 잠금 안에서 읽는다 — `JF-2.1`). 「남는 품목」은 이 품목과 이번에 반품하는 품목을 뺀 나머지이고, 그 결제 안분액 합(Σ `allocatedAmount` — order의 무료배송 판정 금액 `itemsAmount − discountAmount`와 같은 기준)을 무료배송 기준과 견준다. 기준 금액은 order가 주문 때 쓴 값을 `getClaimableLines` 출력의 `freeShippingThreshold`로 받는다(§8). 그래서 claim은 5만 원이라는 숫자를 직접 갖지 않는다.
- **주문당 한 번**: 무료배송 회수분(3,000원)과 초기 배송비 환불은 주문 하나에 한 번만 일어난다. 먼저 차감·환불한 클레임이 `initial_shipping_charge`·`initial_shipping_refund`에 그 값을 남기고, 뒤 클레임의 계산은 그 값을 입력으로 받아 다시 차감·환불하지 않는다. 그래서 무료배송 주문을 두 번에 나눠 단순 변심 반품해도 고객 부담은 회수 편도 둘 + 무료배송 회수분 하나다.
- 제주·도서산간 회수 추가 배송비는 받지 않는다(잠정 — §8).
- 쿠폰은 돌려주지 않는다. 쿠폰 최소 주문 금액 아래로 떨어진 부분 반품도 할인이 유지된다(상위 §9.5).
- 신청 때 `ClaimComplete`·클레임 상세에 보이는 `estimatedRefund`는 잠정 귀책으로 같은 규칙을 돌린 값이다. 실제 금액은 검수 때 확정한다.

## 4. 소유 상태·데이터

테이블 셋이다. 모두 claim만 쓰고, 다른 모듈은 claim의 공개 계약으로만 읽는다(상위 §6.2).

| 표 | 주요 열 | 비고 |
|---|---|---|
| `claims` | `id`, `claim_no`(화면용 번호), `order_id`, `type`(`RETURN`·`EXCHANGE`), `status`, `requester_member_id`(비회원이면 NULL), `reason_code`, `reason_text`, `fault_party`(신청 때 잠정, 검수 때 확정), `pickup_name`·`pickup_phone`·`pickup_zipcode`·`pickup_address`, `refund_account_enc`(가상계좌 주문의 반품만, 암호화), `inspection`(`OK`·`DAMAGED`), `refund_amount`·`return_fee`(회수 편도 + 무료배송 회수분)·`initial_shipping_charge`(무료배송 회수분 — 주문당 한 클레임만 0보다 크다)·`initial_shipping_refund`(주문당 한 클레임만), `refund_attempts`·`last_refund_error`(결과·`failed.code`·PG 코드·시각), `requested_at`·`collected_at`·`completed_at`·`closed_at`, `retain_until` | 상태 전이는 모두 조건부 갱신(`WHERE status = …`). 반품 완료 계산은 같은 `order_id`의 행을 모두 잠근 뒤 한다(`JF-2.1`). 색인 `(order_id)`, `(requester_member_id, requested_at)`, `(status, requested_at)`, `(retain_until)` |
| `claim_lines` | `claim_id`, `order_line_id`, `sku_id`, `quantity`, `paid_amount`(완료 때 order 값을 옮겨 적음), `new_sku_id`(교환), `restocked` | 유일 `(claim_id, order_line_id)`. 품목당 진행 중 클레임 1건은 order 표시가 지킨다 — 여기에는 유일 제약을 두지 않는다(거절·철회 뒤 같은 품목의 새 클레임이 생기므로) |
| `claim_status_history` | `claim_id`, `from_status`, `to_status`, `actor_type`(`MEMBER`·`GUEST`·`ADMIN`·`SYSTEM` — `Principal.subjectType`), `actor_id`, `note`, `at` | 분쟁 대비 기록. 클레임과 함께 지운다 |

### 4.1 클레임 상태 기계

상태 소유자는 claim(`claims.status`)이다. 초기화: 신청 트랜잭션이 커밋될 때 `REQUESTED`로 생긴다(품목 표시가 거절되면 행이 남지 않는다). 전이를 일으키는 입력은 고객의 철회, 운영자의 회수 확인·검수 완료·거절, PG 부분 취소 결과다.

```state
<s> --> (REQUESTED) : 신청 — 품목 표시 성공
(REQUESTED) --> (WITHDRAWN) : 고객 철회 — 회수 확인 전
(REQUESTED) --> (COLLECTED) : 운영자 회수 확인
(REQUESTED) --> (REJECTED) : 운영자 거절 — 회수 전
(COLLECTED) --> (REJECTED) : 운영자 거절 — 검수 불합격
(COLLECTED) --> (REFUND_PENDING) : 반품 검수 완료 — 환불 조건 고정
(REFUND_PENDING) --> (REFUND_PENDING) : 부분 취소 failed {code}·unknown — 사유 기록, 운영자 재시도
(REFUND_PENDING) --> (COMPLETED) : 부분 취소 성공 또는 환불액 0원
(COLLECTED) --> (COMPLETED) : 교환 검수 완료 — 새 SKU 확보
(COMPLETED) --> <e>
(REJECTED) --> <e>
(WITHDRAWN) --> <e>
```

**기호**: `<s>` 시작점, `(…)` 상태, `<e>` 클레임이 끝나는 곳(행은 보존 기한까지 남는다 — §4.3), `A --> B : 글` A에서 B로 가는 전이와 그 조건(`state-diagram-guide.md` 「구성 요소」).

- **불변조건**: `REFUND_PENDING`에 들어간 뒤 `refund_amount`·`inspection`·`fault_party`는 바뀌지 않는다. 한 주문의 `REFUND_PENDING`·`COMPLETED` 반품 가운데 `initial_shipping_charge > 0`인 것과 `initial_shipping_refund > 0`인 것은 각각 많아야 하나다. `COMPLETED` 반품에는 PG 부분 취소 1건(또는 환불액 0원)이 있다. `COMPLETED`·`REJECTED`·`WITHDRAWN`에서 나가는 전이는 없다 — 같은 품목을 다시 클레임하려면 새 클레임이다.
- **`REFUND_PENDING`의 뜻**: 「환불 조건은 정해졌고 PG 부분 취소가 아직 성공으로 확인되지 않았다」. PG 호출 중인 짧은 순간과 거절·결과 불명 뒤 머무는 상태를 한 값으로 쓴다 — 어느 쪽이든 다음 동작은 같은 멱등 키로 다시 부르는 것이다.
- **`COLLECTING`은 두지 않는다**: 회수 택배 연동이 범위 밖이라(상위 §9.5) 「회수 중」을 시스템이 알 수 없다. `REQUESTED`가 「회수 대기」다.
- 거부되는 입력: `REFUND_PENDING`·`COMPLETED`의 거절·철회, `COLLECTED` 뒤 철회, `REQUESTED`의 검수 완료 — 모두 409.

### 4.2 품목 클레임 표시와의 대응

품목 표시는 order가 소유한다([order 상세 §4](order.md#4-소유-상태데이터)). claim은 전이할 때 같은 트랜잭션에서 `markLineClaim`을 부른다.

| 클레임 전이 | order 품목 표시 | 그 뒤 order가 하는 일 |
|---|---|---|
| 신청 → `REQUESTED` | `RETURN_REQUESTED`·`EXCHANGE_REQUESTED` | 자동 구매확정·구매확정·`hasActiveOrders`(탈퇴 확인)에서 진행 중 클레임으로 본다 |
| `COLLECTED`·`REFUND_PENDING` | 그대로 | 같음 |
| 반품 `COMPLETED` | `RETURNED` | 주문 `PARTIALLY_RETURNED`·`RETURNED` |
| 교환 `COMPLETED` | `EXCHANGED` + 새 SKU(`exchangeSkuIds` → `order_lines.exchange_sku_id`) | `claimId`가 실린 재발송 송장을 받는다 |
| `REJECTED` | `CLAIM_REJECTED` | 진행 중이 아님 — 자동 구매확정 대상으로 돌아간다 |
| `WITHDRAWN` | 표시 해제(`NONE`) | 같음 |

### 4.3 보존·파기

| 데이터 | 보존 | 파기 방법 |
|---|---|---|
| 반품 완료 클레임(환불 있음) | 완료 뒤 5년 — 대금결제·청약철회 기록(`R-25`) | `retain_until`이 지나면 `JF-3`이 행을 지운다 |
| 그 밖의 끝난 클레임(교환 완료·거절·철회, 환불 0원 반품) | 끝난 뒤 3년 — 소비자 불만·분쟁 기록(`R-25`) | 같음 |
| 환불 계좌 | 클레임이 끝나는 트랜잭션에서 즉시 삭제 | `markCompleted`·`reject`·`withdraw`가 `refund_account_enc`를 NULL로 |
| 회수지 이름·연락처·주소 | 클레임 행과 같이 | 행 삭제와 함께 |

- 기간 해석은 잠정이다 — 법무 검토 전이다(`C-20`, 상위 §9.5). 교환 완료를 「재화 공급 기록」으로 보면 5년이어야 할 수 있다(§8).
- 회원이 탈퇴해도 클레임 행은 남는다. `requester_member_id`는 남지만 회원 쪽 식별 정보가 파기되어 사람을 가리키지 못한다(상위 `R-26`).

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| order | `getClaimableLines(orderId, requester)` → `claimable {…}`·`notOwner`·`notFound`, `markLineClaim(lineIds, claimId, mark, exchangeSkuIds?)` → `marked`·`conflict {lineId, why}` — [order 상세 §2](order.md#2-공개-계약) | `OrderApi` 주입(같은 프로세스) | 없음 — 같은 DB 트랜잭션 안의 메서드 호출 | 클레임 상태와 품목 표시가 한 트랜잭션으로 묶인다. order는 claim을 부르지 않는다(`D-02`). 품목 `why` 코드는 order 것을 그대로 응답에 싣는다. 무료배송 기준 금액은 출력 필드가 더 필요하다(§8) |
| payment | `cancel(orderRef, amount, reason, idemKey, 'REFUND', refundAccount?)` — [payment 상세 §2](payment.md#2-공개-계약) | `PaymentApi` 주입 | payment가 정한다 — PG 취소 읽기 30s(payment 상세 §6) | 트랜잭션 밖에서 부른다. 결과 `cancelled`·`failed {code}`·`unknown` — 업무 결과는 예외가 아니다(코드별 처리는 `JF-2.1` 표). 멱등 키 `claim:<claimId>`가 재시도 안전의 근거다 |
| catalog | `getSkus(skuIds)`, `reserveStock(ref, lines, holdUntil)`, `commitReservation(ref)`, `releaseStock(ref, lines)` — [catalog 상세 §2](catalog.md#2-공개-계약) | `CatalogApi` 주입 | 없음 — 같은 트랜잭션 | 참조 키 `order:<orderId>`(재입고)와 `claim:<claimId>`(교환 새 SKU)로 멱등 |
| notification | `enqueue(template, recipient, vars, dedupKey)` — [notification 상세 §2](notification.md#2-공개-계약) | `NotificationApi` 주입 | 없음 — 같은 트랜잭션에 적재만 | 발송 결과를 모른다. 템플릿 `CLAIM_REQUESTED`·`CLAIM_COMPLETED`·`CLAIM_REJECTED` — 변수에 `orderNo`·`orderId`·`claimType`을 늘 싣고, 반품 완료는 `refundAmount`, 거절은 `reasonText`를 더한다([notification 상세 §2.1](notification.md#21-템플릿-목록)) |
| mall-api | 트랜잭션 경계, 인증 주체, 보존 작업 스케줄 | 유스케이스 메서드에 트랜잭션 표시(Spring `@Transactional` — 잠정) | — | 업무 규칙은 주지 않는다 |

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 반품·교환 신청 기한 | 배송 완료 + 7일(168시간) | `claim.request-window-days`(7) | `ClaimPolicy.checkRequest` |
| 반품 회수 배송비(편도) | 3,000원 — 잠정 | `claim.return-fee-one-way`(3000) | `RefundCalculator` |
| 초기 배송비 | 주문이 실제로 낸·면제한 값 — order가 준다 | — | `RefundCalculator` |
| 환불 재시도 | 자동 없음 — 운영자가 다시 누른다. 같은 멱등 키 | — | `ClaimService.completeReturn` |
| `REFUND_PENDING` 경보 | 24시간 넘게 머문 클레임을 운영 경보 로그·운영 목록 상단에 | `claim.refund-pending-alert-hours`(24) | 운영 목록 조회(`ClaimRepository.search`) |
| 교환 새 SKU 가예약 | 지금+30분(같은 트랜잭션에서 바로 확정하므로 실제로 쓰이지 않는 값) | — | `ClaimService.completeExchange` |
| 반품 완료 주문 단위 잠금 대기 | 5s — 넘으면 409 `INVALID_STATE {status:'BUSY'}`, 다시 누른다 | `claim.refund-lock-timeout` | `ClaimRepository.lockForRefund` |
| 보존 작업 한 번 처리량 | 1,000건 | `claim.purge-batch-size`(1000) | `ClaimRetention` |

- **인증** 신청·조회·철회는 회원 세션이나 그 주문을 담은 비회원 조회 토큰만 받는다. 주문 소유 판단은 order가 `getClaimableLines(orderId, requester)`로 한다 — claim은 그 결과의 `notOwner`를 403으로 바꾼다. 클레임 조회·철회는 claim 행과 비교한다 — 회원은 `requester_member_id`, 비회원은 「클레임의 `order_id` ∈ `Principal.guestOrderIds`」. 운영 라우트는 미들웨어가 운영자 역할을 확인한다.
- **동시성** 같은 품목 두 신청 → order의 조건부 표시가 하나만 통과시킨다. 같은 클레임의 검수 완료 동시 두 건 → 주문 단위 잠금(트랜잭션 A) + 조건부 전이(트랜잭션 B) + PG 멱등 키. 같은 주문의 다른 클레임 둘의 검수 완료 → 같은 주문 단위 잠금으로 계산이 줄을 서고, 뒤 계산은 앞 클레임(`REFUND_PENDING`)의 품목·배송비 처리를 입력으로 받는다. PG 호출이 겹치면 payment가 뒤의 것을 `failed CANCEL_IN_PROGRESS`로 돌려준다. 철회와 회수 확인이 겹치면 조건부 `REQUESTED → …`가 먼저 커밋한 쪽만 통과시키고 다른 쪽은 409다.
- **부분 실패 규칙** 신청: 표시 실패 = 전부 롤백. 반품 완료: PG 실패·불명 = `REFUND_PENDING`에 머묾, 트랜잭션 B 실패 = 같은 상태에 머묾(재시도로 회수). 교환 완료: 품절 = 전부 롤백, `COLLECTED` 유지.
- **최후 방어** PG가 멱등 키를 지원하지 않으면 재시도가 이중 환불을 낼 수 있다. 그때는 payment가 재호출 전에 PG 취소 내역을 먼저 확인하도록 바뀐다(payment 상세 §8 — 공개 계약은 그대로). claim 쪽은 같은 키·같은 금액만 보낸다는 규칙(환불 조건 고정)을 지킨다.

## 7. 검증 계획

**이미 실행한 검사** — `design-doc-check.mjs`(가이드 사본의 도구)로 이 문서의 정적 검사와 jobflow 렌더를 돌리고(FAIL 0·WARN 0) 바꾼 그림을 PNG로 확인했다.

**구현 후 실행할 검증**

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 신청 기한·상태 | `POST …/claims/return`, `R-14`·`R-15`·`R-25` | 가짜 `OrderApi`로 배송 완료 6일 23시간 → 201, 7일 1분 → 409 `WINDOW_EXPIRED`, 배송 전 → `NOT_DELIVERED`, 구매확정 → `CONFIRMED` | claim 작업(상위 §9.1 순서 5) |
| 신청 경합 | 같은 품목 동시 신청 2건 | 실제 order 모듈 + 시험 DB로 두 요청 동시 실행 → 201 하나, 409 `CLAIM_IN_PROGRESS` 하나, `claims` 1행·알림 1건 | claim 작업 |
| 교환 옵션 규칙 | `POST …/claims/exchange` | 다른 단가 SKU → `PRICE_DIFFERS`, 다른 상품 → `OTHER_PRODUCT`, 품절 → `SKU_UNAVAILABLE`, `CHANGE_OF_MIND` → `BUYER_FAULT_REASON` | claim 작업 |
| 환불액 계산 | `RefundCalculator`, §3.1 | 표의 예 전부 + 환불액이 음수가 되는 경우(0원) + 이미 다른 품목이 반품된(또는 `REFUND_PENDING`인) 무료배송 주문 + 회수분·초기 배송비 환불을 앞 클레임이 이미 한 경우(다시 하지 않음) — 순수 단위 시험 | claim 작업 |
| 반품 완료 정상 | `JF-2.1` | 가짜 `PaymentApi`가 `cancelled` → 클레임 `COMPLETED`, 재입고는 검수 OK 품목만, 품목 `RETURNED`, 알림 1건 | claim 작업 |
| 환불 실패·불명 재시도 | `JF-2.1` 대표 실패 흐름 | 가짜 PG가 첫 시도 `unknown`(실제로는 성공으로 기록) → 502·`REFUND_PENDING`, 재고·표시 변화 없음 → 재시도 → 같은 멱등 키·같은 금액으로 1회 → `COMPLETED`, PG 취소 1건. 재시도 본문 귀책 변경 → 409 `REFUND_TERMS_FIXED` | claim 작업 |
| 완료 동시 두 건 | `JF-2.1` | 같은 클레임 `complete` 동시 2건 → PG 호출 멱등 키 같음, `COMPLETED` 전이 1회, 재입고 1회. 같은 무료배송 주문의 다른 클레임 둘 `complete` 동시 → 계산이 줄을 서고 무료배송 회수분은 한 클레임에만 | claim 작업 |
| 환불 실패 코드별 | `JF-2.1` 결과별 처리 표 | 가짜 `PaymentApi`가 `failed` 코드 다섯과 `unknown`을 차례로 → 모두 예외 없이 502 `REFUND_FAILED {result, code}`·`REFUND_PENDING` 유지·`last_refund_error` 기록, 경보 대상 코드는 경보 로그 | claim 작업 |
| 트랜잭션 B 실패 | `JF-2.1` | `markLineClaim`에 예외 주입 → `REFUND_PENDING` 유지, 재입고 없음 → 재시도로 `COMPLETED` | claim 작업 |
| 교환 완료 | `JF-2.2` | 새 SKU 재고 있음 → 확정·`EXCHANGED`·`exchangeSkuIds` 전달, 재고 0 → 409 `EXCHANGE_OUT_OF_STOCK`·`COLLECTED` 유지·재고 변화 없음 | claim 작업 |
| 철회·거절 | `JF-1.2`·`JF-2.3` | `REQUESTED` 철회 → 표시 해제, `COLLECTED` 철회 → 409, `REFUND_PENDING` 거절 → 409, 거절 → `CLAIM_REJECTED`·알림 | claim 작업 |
| 비회원 | 조회 토큰 주체 | 주문 둘을 담은 토큰으로 두 주문 모두 신청·조회·철회 성공, 담지 않은 주문 → 403·404, 토큰으로 `GET /api/members/me/claims` → 401 | claim 작업 |
| 알림 변수 | `JF-1.1`·`JF-2.1`·`JF-2.2`·`JF-2.3` | 적재된 변수에 `orderNo`·`orderId`·`claimType`이 늘 있고, 반품 완료는 `refundAmount`, 거절은 `reasonText` | claim 작업 |
| 반품 끝단 | 상위 §9.2 「반품 끝단」 | 상위 표가 원본 — 경계를 넘는 끝단 시험 | 순서 5 뒤 |
| 보존 파기 | `JF-3`, `C-20` | 시계를 옮긴 시험 DB → 5년·3년 기한이 지난 클레임만 삭제, 진행 중 클레임 보존, `PurgeResult.deleted` = 지운 클레임 수 | 상위 §9.1 순서 6 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-16` | 미확정 | 수량 일부 반품(같은 품목 3개 중 1개)을 받지 않는다(잠정) | order 품목 표시가 품목 한 행에 하나다 | 고객은 품목 전량만 반품한다 — 국내몰은 수량 일부를 받는 곳이 많다. 받으려면 order 표시를 수량 단위로 바꾸고 `claim_lines.quantity`를 품목 수량보다 작게 허용한다 |
| `C-16` | 미확정 | 구매자 귀책 교환(사이즈·색상 변경)을 받지 않는다(잠정) | 교환 배송비 6,000원을 결제받는 흐름이 없다(상위 §9.5 「교환 차액」) | 국내 패션몰에서 흔한 요청을 반품 + 재주문으로 돌린다. 받으려면 교환 배송비 결제 계약(order·payment)이 필요하다 |
| `C-16`·`R-25` | 위험 | 판매자 귀책(불량)도 신청 기한이 배송 완료 7일이다 | 전자상거래법은 표시·광고와 다르거나 계약과 다른 경우 수령 3개월·안 날부터 30일까지 청약철회를 허용한다(법무 확인 필요) | 7일 뒤 불량은 고객센터가 시스템 밖에서 처리한다. 법무 검토 뒤 `SELLER` 사유만 기한을 늘리고 구매확정 뒤에도 받을지 정한다(상위 `R-15`와 충돌) |
| `C-16`·`C-07` | 미확정 | 반품 배송비 금액(편도 3,000원, 무료배송 주문 왕복 6,000원)과 도서산간 추가 미적용 | 상위 §9.5 「배송비 정책」 | 판매자 정책이 정해지면 설정값만 바꾼다. 도서산간을 받으려면 회수지 우편번호로 order의 지역 표를 읽는 계약이 더 필요하다 |
| `C-12`·`C-16` | 미확정 | 가상계좌 결제 주문의 환불 계좌 — 신청 때 받아 암호화해 두고 `PaymentApi.cancel`에 넘긴다(가정) | 상위 §9.5 「가상계좌 결제 주문의 환불」 | 업체 환불 API 형식·예금주 실명 확인 여부에 따라 입력이 바뀐다. 계좌가 틀려 환불이 `failed PG_REJECTED`면 `REFUND_PENDING`에 머무는데, 계좌를 고치는 계약이 없다 — 잠정: 운영자가 고객과 통화한 뒤 거절하고 재신청을 받는다. 그런데 `REFUND_PENDING`은 거절할 수 없다(§4.1) — 운영 계좌 수정 라우트(`PATCH /api/admin/claims/{claimId}/refund-account`)를 더할지 정해야 한다 |
| `C-16`·`D-04` | 위험 | 환불 재시도의 안전이 PG 부분 취소 멱등 키 지원에 기댄다 | 상위 §9.5 「PG 업체」 | 지원하지 않으면 재시도 전에 조회를 먼저 한다(§6 최후 방어) — `PaymentApi`에 취소 건 조회가 필요하다 |
| `C-16` | 위험 | `REFUND_PENDING`을 자동으로 닫는 타이머가 없다 | §6 | 운영자가 잊으면 고객 환불이 늦는다. 24시간 경보로 줄인다. 반복되면 order 대사 타이머처럼 PG 취소 조회로 닫는 타이머를 더한다 |
| `C-16` | 미확정 | 교환 새 SKU가 검수 때 품절이면 운영자가 기다리거나 거절한다 | `JF-2.2` | 신청 때 재고를 잡지 않아 생긴다. 거절 뒤 반품 기한이 지났으면 고객이 불리하다 — 신청 때 가예약(`reserveStock('claim:<claimId>', …, 14일)`)으로 바꾸는 안이 있다(5.1에 `Claim.request → Catalog` 선이 필요) |
| `C-16` | 위험 | 회수 뒤 거절하면 물건을 돌려보내는 일이 시스템 밖이고, 회수 택배 출발 뒤 철회도 받는다 | `JF-1.2`·`JF-2.3` | 운영자가 수동으로 처리한다. 회수 택배 연동을 넣으면 `COLLECTING` 상태로 철회를 막는다 |
| `C-16` | 미확정 | 교환받은 품목을 다시 반품·교환할 수 있는가 | `JF-2.2` | 잠정 — 받지 않는다(품목 표시가 `EXCHANGED`면 `getClaimableLines`가 반품 불가로 준다고 가정). 재발송 품목의 배송 완료·구매확정 규칙은 order가 정한다 |
| `C-20` | 미확정 | 보존 기간 — 반품 완료 5년, 그 밖 3년 | 상위 §6.2 | 교환 완료를 재화 공급 기록으로 보면 5년이다. 법무 검토 뒤 `retain_until` 계산만 바꾼다 |
| `R-22` | 미확정 | 클레임 템플릿 셋(`CLAIM_REQUESTED`·`CLAIM_COMPLETED`·`CLAIM_REJECTED`)이 반품·교환을 `claimType` 변수 하나로 가른다 | 상위 §9.5 「알림톡 템플릿」 8종 | 반품·교환 문구를 변수로 바꾸는 템플릿이 대행사 심사를 통과하지 못하면 종류별 템플릿으로 나눈다 — 적재 지점의 템플릿 코드만 바뀐다 |
| `C-16`·`C-07` | 위험 | 무료배송 판정은 order가 주는 `freeShippingThreshold`(주문 때 쓴 기준 금액)로 한다 | §3.1 | claim이 자기 설정에 기준 금액을 따로 두지 않는다 — 정책이 바뀌어도 그 주문의 기준으로 계산한다. 배송비 정책 자체는 미확정(상위 §9.5) |
| `C-16`·`C-07` | 미확정 | 무료배송 회수분을 차감한 뒤 같은 주문의 나머지가 판매자 귀책으로 모두 반품되면 회수분을 돌려줄지 | §3.1 예 | 잠정 — 돌려주지 않는다(먼저 낸 반품은 구매자 귀책이었다). 판매자 정책이 정해지면 `RefundCalculator`의 「주문당 한 번」 입력에 환급 규칙을 더한다 |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 클래스·메서드·테이블·설정 키는 제안이고, 실행·측정한 것이 없다.
2. order·payment·catalog·notification의 계약 형태는 각 상세 §2와 공통 결정(결과 이름·인자)에 맞췄다. 남은 차이(무료배송 기준 금액 필드)는 §8에 있다. 그 상세가 뒤에 바뀌면 다시 대조해야 한다.
3. PG 부분 취소의 멱등 키 지원·가상계좌 환불 API는 업체를 정하지 않아 가정이다(상위 §9.5).
4. 청약철회 기한·보존 기간의 법 해석은 법무 검토를 거치지 않았다(`C-20`).
5. 반품 배송비 금액은 국내 관행에서 가져온 잠정값이고, 판매자 정책으로 확인하지 않았다.
