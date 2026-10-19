# promotion (모듈) — TO-BE 상세

> **대상**: promotion 모듈 전체 — 기획전, 쿠폰 정의·다운로드, 회원 쿠폰 상태 기계, 주문 견적(대상 판정·할인 계산·안분), 쿠폰 점유·사용·해제, 운영 라우트, 보존 작업(`C-07`, 관련 `R-02`·`R-09`·`R-13`·`R-20`·`R-21`) · **기준**: 설계 기준 DATE 2026-10-19·커밋 `6ace327`
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·테이블·설정 키가 제안이다 — 그래서 `(제안)` 표시를 생략한다. 심볼 이름은 핵심 §9.5의 잠정 스택(Java 21 + Spring Boot 3) 기준이다. 정하지 못한 정책은 「잠정」, 확인하지 못한 것은 「미확인」으로 적는다. 내부 흐름은 `jobflow`(`job-flow-diagram-guide.md`), 회원 쿠폰 상태는 `state`(`state-diagram-guide.md`)로 그린다. 금액 단위는 모두 원(정수)이다

## 1. 책임 / 비책임

- **책임**: 기획전을 편성하고 노출한다(배치·기간·상품 ID 목록·쿠폰 ID 목록). 쿠폰을 정의한다(정액·정률, 최대 할인, 최소 주문 금액, 대상 전체·카테고리·상품, 발급 수량, 1인 1매, 유효기간 고정 또는 다운로드 후 N일). 회원의 쿠폰 다운로드를 받는다(발급 수량 조건부 증가, 회원·쿠폰 유일). 회원 쿠폰의 상태 기계(`AVAILABLE`·`LOCKED`·`USED`·`EXPIRED`)를 소유한다. 주문 품목에 쿠폰 할인을 계산해 품목별로 안분한다(`quote`). 주문 참조 키로 쿠폰을 점유·사용·해제한다(`lockCoupons`·`useCoupons`·`releaseCoupons` — 모두 멱등). 끝난 쿠폰·기획전을 보존 기한 뒤 지운다(`purgeExpired`).
- **비책임**: 상품 카드 정보와 판매 상태(catalog — 기획전은 상품 ID만 갖고, 화면이 그 ID로 `Catalog.listProducts`를 부른다, 핵심 §5.2). 품목의 가격·상품 ID·카테고리 확인(order가 `Catalog.getSkus`에서 받아 `quote`의 `lines`에 담는다). 배송비와 결제 금액 합산, 화면 금액 대조(order — `C-09`). 주문 트랜잭션을 열고 롤백하는 일(order — promotion의 서비스 계약은 호출자 트랜잭션 안에서만 돈다). 로그인·운영자 권한 검사(mall-api 인증 미들웨어). 부분 반품 환불액(claim이 order의 품목 결제 안분액으로 계산한다 — `C-16`). 기획전 배너 이미지의 업로드 URL 서명(catalog의 운영 이미지 업로드 `POST /api/admin/uploads/product-images`를 함께 쓰고, promotion은 받은 키를 `bannerImageKey`로만 저장한다 — 상위 §5.15). 쿠폰함에서 「이 주문에 적용 가능한지·예상 할인」을 정하는 일(가격을 모른다 — 쿠폰을 고르면 order의 `previewCheckout`이 `quote`의 `evaluations`로 보인다, 상위 §5.6).
- **아무도 하지 않는 것**: 부분 반품 때 쿠폰 환원(잠정 — 핵심 §9.5), 가입 축하 쿠폰 같은 자동 발급, 운영자의 발급 쿠폰 회수, 배송비 쿠폰, 적립금(범위 밖 — 핵심 §9.5), 업로드했지만 기획전에 저장하지 않은 배너 객체 정리(§8).

## 2. 공개 계약

전수 17개 — HTTP 라우트 12개(고객 4·운영 8)와 서비스 메서드 5개(order가 부르는 4개, mall-api 보존 작업이 부르는 1개)다. 라우트는 mall-api 조립 지점이 등록한다. order가 부르는 넷은 모듈 공개 인터페이스 `PromotionApi`에 선언하고 `PromotionService`가 구현한다. 보존 파기 `purgeExpired`는 mall-api 공용 인터페이스 `RetentionTask`(`com.openmall.common.retention`)를 promotion이 구현한 빈 `PromotionRetentionTask`다(`C-21`). 오류 본문은 `{code, message, details}`이고, 입력 검증 실패는 422 `VALIDATION_FAILED`(`details.fields[{field, reason}]`)다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `GET /api/exhibitions` | query `placement`(`home` 등 — 생략하면 진행 중 전체) | 200 `[{exhibitionId, title, bannerImageUrl, placement, startsAt, endsAt}]` — 게시 중이고 기간 안인 것만, 노출 순서대로 | 422 `VALIDATION_FAILED`(알 수 없는 `placement`) | `PromotionPublicController.listExhibitions` → `ExhibitionQuery.listActive` |
| `GET /api/exhibitions/{exhibitionId}` | path | 200 `{exhibitionId, title, bannerImageUrl, startsAt, endsAt, productIds[], coupons[{couponId, name, discountType, value, maxDiscount, minOrderAmount, downloadable, downloaded?}]}` — `productIds`는 노출 순서, `downloaded`는 로그인했을 때만 | 404 `EXHIBITION_NOT_FOUND`(없음·미게시·기간 밖) | `PromotionPublicController.getExhibition` → `ExhibitionQuery.getActive` |
| `POST /api/coupons/{couponId}/download` | path, 회원 세션 | 201 `{memberCouponId, couponId, validFrom, validTo}` | 401(인증 미들웨어), 404 `COUPON_NOT_FOUND`, 409 `ALREADY_DOWNLOADED`·`NOT_STARTED`, 410 `EXHAUSTED`·`EXPIRED` | `PromotionPublicController.downloadCoupon` → `CouponDownloader.download` |
| `GET /api/members/me/coupons` | 회원 세션, query `status`(`AVAILABLE`·`LOCKED`·`USED`·`EXPIRED`, 생략하면 `AVAILABLE`), `usable=true`(지금 쓸 수 있는 것 — `AVAILABLE`이고 유효기간 안) | 200 `[{memberCouponId, couponId, name, kind:'PRODUCT'·'CART', discountType, value, maxDiscount, minOrderAmount, target{type, ids}, validFrom, validTo, status}]` — 유효기간이 지난 `AVAILABLE`은 `EXPIRED`로 보인다 | 401 | `PromotionPublicController.listMyCoupons` → `MemberCouponQuery.listMine` |
| `GET /api/admin/exhibitions` | 운영자 세션, query `status`(`DRAFT`·`PUBLISHED`·`HIDDEN` — `exhibitions.status` 값 그대로, 생략하면 전부)·`period`(`UPCOMING` 시작 전·`ONGOING` 기간 안·`ENDED` 종료 — 지금 시각과 `starts_at`·`ends_at`으로 가른다, 생략하면 전부)·`placement`·`page`·`size`(기본 20, 최대 100) | 200 `{items[{exhibitionId, title, placement, status, startsAt, endsAt, productCount, couponCount, updatedAt}], page, totalCount}` — 미게시·종료 포함, 시작 시각 최신순. 고객 화면에 보이는 것은 `status=PUBLISHED&period=ONGOING`이다 | 403(인증 미들웨어), 422 `VALIDATION_FAILED`(알 수 없는 필터 값) | `AdminPromotionController.listExhibitions` → `ExhibitionRepository.page` |
| `GET /api/admin/exhibitions/{exhibitionId}` | 운영자 세션, path | 200 `{exhibitionId, title, bannerImageKey, bannerImageUrl, placement, status, startsAt, endsAt, productIds[], couponIds[], createdAt, updatedAt}` — 상태·기간과 상관없이 낸다(수정 화면을 주소로 바로 열 때) | 403, 404 `EXHIBITION_NOT_FOUND` | `AdminPromotionController.getExhibition` → `ExhibitionRepository.findById` |
| `POST /api/admin/exhibitions` | `{title, bannerImageKey, placement, productIds[], couponIds[], period{startsAt, endsAt}, status:'DRAFT'·'PUBLISHED'·'HIDDEN'}` | 201 `{exhibitionId}` | 403, 422 `VALIDATION_FAILED {fields[{field, reason}]}` — 기간 시작 ≥ 끝, `productIds` 0개·300개 초과·중복, 없는 `couponId`, `bannerImageKey`가 운영 이미지 업로드 키 형식(`products/` 접두)이 아님 | `AdminPromotionController.saveExhibition` → `ExhibitionEditor.create` |
| `PATCH /api/admin/exhibitions/{exhibitionId}` | 위 필드의 일부 | 200 `{exhibitionId}` | 403, 404 `EXHIBITION_NOT_FOUND`, 422 `VALIDATION_FAILED` | `AdminPromotionController.saveExhibition` → `ExhibitionEditor.update` |
| `GET /api/admin/coupons` | 운영자 세션, query `status`(`ACTIVE`·`STOPPED` — `coupons.status` 값 그대로, 생략하면 전부)·`page`·`size`(기본 20, 최대 100) | 200 `{items[{couponId, name, discountType, value, target{type}, issueLimit, issuedCount, usedCount, downloadFrom, downloadTo, status}], page, totalCount}` | 403, 422 `VALIDATION_FAILED`(알 수 없는 `status`) | `AdminPromotionController.listCoupons` → `CouponRepository.pageWithStats` |
| `GET /api/admin/coupons/{couponId}` | 운영자 세션, path | 200 `{couponId, …POST의 정의 전부, status, issuedCount, memberCouponCounts{AVAILABLE, LOCKED, USED, EXPIRED}, termsLocked, createdAt, updatedAt}` — `termsLocked`는 `issuedCount ≥ 1`(할인 조건·대상·유효기간을 못 바꾼다 — 3.1) | 403, 404 `COUPON_NOT_FOUND` | `AdminPromotionController.getCoupon` → `CouponRepository.findWithStats` |
| `POST /api/admin/coupons` | `{name, discountType:'AMOUNT'·'RATE', value, maxDiscount?, minOrderAmount, target{type:'ALL'·'CATEGORY'·'PRODUCT', ids[]}, issueLimit?, perMemberLimit:1, validFrom·validTo 또는 daysAfterDownload, downloadFrom, downloadTo}` | 201 `{couponId}` | 403, 422 `VALIDATION_FAILED {fields[{field, reason}]}` — 3.1 표의 검사 | `AdminPromotionController.saveCoupon` → `CouponEditor.create` |
| `PATCH /api/admin/coupons/{couponId}` | `name`, `issueLimit`, `downloadTo`, `status:'ACTIVE'·'STOPPED'`, 할인 조건 필드 | 200 | 403, 404, 409 `COUPON_TERMS_LOCKED`(1매라도 발급된 쿠폰의 할인 조건·대상·유효기간 변경), 409 `BELOW_ISSUED`(발급 수보다 작은 `issueLimit`), 422 `VALIDATION_FAILED` | `AdminPromotionController.saveCoupon` → `CouponEditor.update` |
| 서비스 `quote(memberId, couponIds, lines)` | `memberId`(비회원 `null`), `couponIds` = 회원 쿠폰 ID 0~2개, `lines[{lineKey, skuId, productId, categoryIds[], unitPrice, quantity}]` — `categoryIds`는 상품의 카테고리와 그 조상 전부 | `{totalDiscount, applied[{memberCouponId, couponId, kind, discount}], lineDiscounts[{lineKey, discount, byCoupon[{memberCouponId, amount}]}], evaluations[{memberCouponId, applicable, discountAlone}], rejected[{memberCouponId, reason}]}` | 예외 없음 — 적용 불가는 `rejected`의 사유 `NOT_OWNED`·`NOT_AVAILABLE`·`EXPIRED`·`NOT_STARTED`·`NO_ELIGIBLE_LINE`·`BELOW_MIN_ORDER`·`CONFLICT`. 입력 형식 오류(수량 ≤ 0, 단가 < 0, `lineKey` 중복)는 `IllegalArgumentException`(호출자 버그) | `PromotionService.quote` → `CouponQuoter.quote` |
| 서비스 `lockCoupons(ref, memberCouponIds)` | `ref` = `order:<orderId>`, 회원 쿠폰 ID 0~2개 | `locked{memberCouponIds}` 또는 `unavailable{memberCouponIds}` | 호출자 트랜잭션이 없으면 `IllegalTransactionStateException`. `unavailable`은 값이다 — 호출자가 트랜잭션을 롤백하고 409 `COUPON_UNAVAILABLE`을 낸다 | `PromotionService.lockCoupons` → `MemberCouponLedger.lock` |
| 서비스 `useCoupons(ref)` | `ref` | `{used}` — 이번에 `USED`로 바꾼 수. 이미 `USED`이거나 쿠폰 없는 주문이면 0 | 호출자 트랜잭션 없음 | `PromotionService.useCoupons` → `MemberCouponLedger.use` |
| 서비스 `releaseCoupons(ref)` | `ref` | `{restored, expired}` — `AVAILABLE`로 되돌린 수와 `EXPIRED`로 닫은 수. 다시 부르면 둘 다 0 | 호출자 트랜잭션 없음 | `PromotionService.releaseCoupons` → `MemberCouponLedger.release` |
| 서비스 `purgeExpired(now)` | `now` | `PurgeResult{task:'promotion', deleted}` — 지운 회원 쿠폰·쿠폰·기획전 행 수의 합. 같은 실행에서 유효기간이 지난 `AVAILABLE`을 `EXPIRED`로 닫은 수는 로그로만 남긴다 | DB 오류는 그대로 던진다 — 보존 작업이 기록하고 다음 날 다시 부른다 | `RetentionTask.purgeExpired` → `PromotionRetentionTask.purgeExpired` → `PromotionRetention.run` — mall-api 보존 작업이 하루 1회 부른다(핵심 §6.2) |

- **트랜잭션**: 서비스 넷(`quote`·`lockCoupons`·`useCoupons`·`releaseCoupons`)은 호출자 트랜잭션에 참여만 한다(`@Transactional(propagation = MANDATORY)`). 커밋·롤백은 order가 정한다(핵심 [§6.3](../system-design-to-be.md#63-트랜잭션-경계)). 라우트와 `purgeExpired`는 각자 트랜잭션이다(`purgeExpired`는 묶음마다 짧은 트랜잭션).
- **불변조건**: `quote`는 읽기만 한다(쓰기 0). `Σ lineDiscounts.discount = totalDiscount`이고, 품목마다 `0 ≤ discount ≤ unitPrice × quantity`다. `applied`는 상품 쿠폰 1장·장바구니 쿠폰 1장을 넘지 않는다(3.2).
- **멱등**: `lockCoupons`는 같은 `ref`로 다시 불러도 결과가 같다. `useCoupons`·`releaseCoupons`는 두 번째 호출에서 바뀌는 행이 0이다. 그래서 승인·대사·웹훅·만료·취소가 같은 주문으로 겹쳐 불러도 쿠폰 상태가 한 번만 바뀐다(핵심 [§5.8](../system-design-to-be.md#58-결제-승인-결과-불명-회수--대사-타이머)).
- **`couponIds`의 뜻**: `quote`와 `POST /api/orders`·`/api/orders/preview`의 `couponIds`는 쿠폰 정의 ID가 아니라 회원 쿠폰 ID다. 다운로드한 쿠폰 한 장을 가리킨다.
- **호출자 입력을 믿는다**: `quote`는 `lines`의 `unitPrice`·`productId`·`categoryIds`를 다시 확인하지 않는다. order가 `Catalog.getSkus`에서 받은 값을 넣는다(브라우저 값 금지 — §8).

## 3. 내부 Job Flow — 드릴다운

**결론**: 조율자는 진입 종류마다 하나다 — order가 부르는 쿠폰 수명 계약은 `PromotionService`, 고객 라우트는 `PromotionPublicController`, 운영 라우트는 `AdminPromotionController`. 다른 모듈이나 외부로 나가는 클라이언트 객체는 없다(`D-02` 워커). 쓰는 것은 자기 저장소 셋(`ExhibitionRepository`·`CouponRepository`·`MemberCouponRepository`)뿐이다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Promotion.couponLifecycle`(§5.1) 가운데 `Promotion.quote`(§5.6) | [`JF-1` 쿠폰 수명 계약 진입](#jf-1-쿠폰-수명-계약-진입--promotionservice) | [`JF-1.1` 주문 견적](#jf-11-주문-견적--couponquoterquote), 계산 규칙은 [3.2](#32-할인-계산안분중복-규칙) |
| `Promotion.couponLifecycle`(§5.1) 가운데 `Promotion.lockCoupons`(§5.6) | [`JF-1`](#jf-1-쿠폰-수명-계약-진입--promotionservice) | [`JF-1.2` 쿠폰 점유](#jf-12-쿠폰-점유--membercouponledgerlock) |
| `Promotion.couponLifecycle`(§5.1) 가운데 `Promotion.useCoupons`(§5.7·§5.8·§5.9)·`Promotion.releaseCoupons`(§5.7·§5.8·§5.9·§5.10) | [`JF-1`](#jf-1-쿠폰-수명-계약-진입--promotionservice) | [`JF-1.3` 사용 확정과 해제](#jf-13-사용-확정과-해제--membercouponledgeruserelease) |
| `Promotion.operate`(§5.1) 가운데 `Promotion.listExhibitions`·`Promotion.getExhibition`(§5.2) | [`JF-2` 고객 라우트 진입](#jf-2-고객-라우트-진입--promotionpubliccontroller) | — 단순 조회(게시·기간 조건으로 거른 읽기)라 열지 않는다 |
| `Promotion.operate`(§5.1) 가운데 `Promotion.downloadCoupon`·`.unauthorized`(§5.2) | [`JF-2`](#jf-2-고객-라우트-진입--promotionpubliccontroller) | [`JF-2.1` 쿠폰 받기](#jf-21-쿠폰-받기--coupondownloaderdownload). `.unauthorized`(401)는 인증 미들웨어가 내며 이 경계에 대응 코드가 없다 |
| `Promotion.operate`(§5.1) 가운데 `Promotion.listMyCoupons`(§5.6) | [`JF-2`](#jf-2-고객-라우트-진입--promotionpubliccontroller) | — 단순 조회. 상위 §5.6과 같이 `skuIds`를 받지 않고 적용 판정을 주지 않는다 — 판정은 [`JF-1.1`](#jf-11-주문-견적--couponquoterquote)의 `evaluations` |
| `Promotion.adminPromotion`(§5.1) = `Promotion.saveCoupon`·`Promotion.saveExhibition`(§5.15), 운영 목록·단건 조회 | 그림 없음 — 검사 뒤 저장하는 단순 CRUD라 [3.1 운영 라우트 처리](#31-운영-라우트-처리) 표로 대신한다 | — |
| `Promotion.purgeExpired`(§5.17 — mall-api 보존 작업의 `RetentionTask.purgeExpired`) | 그림 없음 — `PromotionRetentionTask.purgeExpired` → `PromotionRetention.run`은 [§4](#4-소유-상태데이터)의 보존 행과 상태 기계로 대신한다 | — |

**표기** 노드는 제안 클래스·메서드다. `…Repository`는 그 표 하나를 읽고 쓰는 저장소, `…Policy`·`…Rule`·`…Calculator`·`…Allocator`는 DB를 보지 않는 순수 계산 객체다. 모든 시각은 주입한 `Clock`(Asia/Seoul)에서 읽는다 — 그림에는 그리지 않았다. 렌더 확인은 이 문서의 jobflow 블록 여섯 개를 `design-doc-check.mjs --renderer`로 SVG로 만들고 PNG로 바꿔 눈으로 본 범위다. 열지 않은 것: `ExhibitionQuery`·`MemberCouponQuery`(조건 읽기), `ValidityPolicy`(날짜 계산 순수 함수 — 3.2 표가 원본), `DiscountAllocator.allocate`(안분 순수 함수 — 3.2 표가 원본).

### JF-1 쿠폰 수명 계약 진입 — PromotionService

```jobflow
orchestrator: PromotionService
Object: PromotionService, CouponQuoter, MemberCouponLedger

PromotionService.quote --> CouponQuoter.quote
PromotionService.lockCoupons --> MemberCouponLedger.lock
PromotionService.useCoupons --> MemberCouponLedger.use
PromotionService.releaseCoupons --> MemberCouponLedger.release
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PromotionService.quote` → `CouponQuoter.quote` | `C-07`·`R-09` | 상위 `Promotion.quote`. order의 `previewCheckout`·`placeOrder`가 부른다. 안쪽은 `JF-1.1` |
| `PromotionService.lockCoupons` → `MemberCouponLedger.lock` | `C-07`·`R-20` | 상위 `Promotion.lockCoupons`. `ref`가 `order:` 또는 `claim:`으로 시작하지 않으면 `IllegalArgumentException`. 안쪽은 `JF-1.2` |
| `PromotionService.useCoupons` → `MemberCouponLedger.use` | `C-07`·`R-10` | 상위 `Promotion.useCoupons`. 안쪽은 `JF-1.3` |
| `PromotionService.releaseCoupons` → `MemberCouponLedger.release` | `C-07`·`R-13`·`R-20` | 상위 `Promotion.releaseCoupons`. 안쪽은 `JF-1.3` |

- **트리거** order의 한 트랜잭션 안의 호출이다 — 주문 생성(§5.6), 결제 확정(§5.7·§5.8·§5.9), 결제 실패·만료·취소(§5.7~§5.10). **완료 사실** 견적 값, 또는 회원 쿠폰 행의 상태 전이. 커밋 여부는 order의 트랜잭션이 정한다.
- 네 메서드 모두 트랜잭션 전파를 `MANDATORY`로 둔다. 호출자 트랜잭션 없이 부르면 바로 예외다 — 점유만 커밋되고 주문이 없는 상태를 막는 최후 방어다(§6).

### JF-1.1 주문 견적 — CouponQuoter.quote

```jobflow
orchestrator: CouponQuoter
Object: CouponQuoter, MemberCouponRepository, EligibilityRule, StackingPolicy, DiscountCalculator, DiscountAllocator

CouponQuoter.quote --> MemberCouponRepository.findWithCoupons
MemberCouponRepository.findWithCoupons.result --> EligibilityRule.evaluate
EligibilityRule.evaluate.rejected
EligibilityRule.evaluate.eligible --> StackingPolicy.select
StackingPolicy.select.conflict
StackingPolicy.select.result --> DiscountCalculator.compute
DiscountCalculator.compute --> DiscountAllocator.allocate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `MemberCouponRepository.findWithCoupons` | `C-07` | `couponIds`의 회원 쿠폰 행과 쿠폰 정의를 함께 읽는다(잠금 없음). `couponIds`가 비면 부르지 않고 할인 0을 돌려준다 |
| `EligibilityRule.evaluate`·`.rejected` | `C-07`·`R-09` | 쿠폰마다 판정한다 — 소유(`member_id = memberId`, 비회원이면 모두 `NOT_OWNED`), 상태(`AVAILABLE`만 — `LOCKED`·`USED`는 `NOT_AVAILABLE`), 유효기간(`EXPIRED`·`NOT_STARTED`), 대상 품목(없으면 `NO_ELIGIBLE_LINE`), 최소 주문 금액(`BELOW_MIN_ORDER`). `.rejected`는 그 쿠폰을 `rejected`에 담고 더 계산하지 않는 분기다. 통과한 쿠폰마다 단독 할인액(`discountAlone`)을 `evaluations`에 담는다 |
| `StackingPolicy.select`·`.conflict` | `C-07` | 상품 쿠폰 1장 + 장바구니 쿠폰 1장까지(3.2, 잠정). 같은 종류가 둘이면 둘 다 `CONFLICT`로 `rejected`에 담는다 — 어느 쪽을 고를지 서버가 대신 정하지 않는다 |
| `DiscountCalculator.compute` → `DiscountAllocator.allocate` | `C-07`·`R-09` | 상품 쿠폰을 먼저 계산·안분하고, 그 뒤 금액으로 장바구니 쿠폰을 계산·안분한다. `allocate` 화살표 하나가 적용 쿠폰마다의 **실제 재호출**이다(최대 2회, 정해진 순서). 규칙은 3.2 |

- **트리거** 상위 `Order.previewCheckout`·`Order.placeOrder`의 `Promotion.quote`(§5.6). **완료 사실** 견적 값 하나 — 쓰기 없음.
- **실패 분기** 쿠폰 문제는 예외가 아니라 `rejected` 값이다. 미리보기는 그대로 화면에 보이고, `placeOrder`는 `rejected`가 하나라도 있으면 409 `COUPON_UNAVAILABLE`로 끝낸다 — 그 판단은 order 쪽이다([order 상세 §2](order.md#2-공개-계약)).
- `placeOrder`가 `quote` 직후 같은 트랜잭션에서 `lockCoupons`를 부르므로, 견적과 점유 사이에 다른 주문이 같은 쿠폰을 점유하면 `lock`의 조건부 갱신이 걸러 낸다(`JF-1.2`). 견적은 잠그지 않는다.
- **적용 판정의 자리**(상위 §5.6): 쿠폰함 `GET /api/members/me/coupons?usable=true`는 보유 쿠폰과 조건만 주고, 「이 주문에 적용 가능한지·할인액」은 쿠폰을 고를 때 order의 `previewCheckout`이 부르는 이 `quote`가 정한다. 후보 쿠폰을 여럿 넣으면 `evaluations`로 쿠폰별 적용 가능 여부와 단독 할인액을 한 번에 얻고, order가 미리보기 응답의 `coupons[{couponId, discount, unavailableReason?}]`로 옮긴다([order 상세 §2](order.md#2-공개-계약)).

### JF-1.2 쿠폰 점유 — MemberCouponLedger.lock

```jobflow
orchestrator: MemberCouponLedger
Object: MemberCouponLedger, MemberCouponRepository

MemberCouponLedger.lock --> MemberCouponRepository.lockIfAvailable
MemberCouponRepository.lockIfAvailable.missed --> MemberCouponRepository.findById
MemberCouponRepository.findById.sameRef
MemberCouponRepository.findById.unavailable
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `MemberCouponRepository.lockIfAvailable` | `C-07`·`R-20` | 쿠폰마다 조건부 갱신 `UPDATE member_coupons SET status='LOCKED', lock_ref=?, locked_at=? WHERE id=? AND status='AVAILABLE' AND valid_from <= now AND valid_to >= now`. 1행이 바뀌면 점유됐다 |
| `.missed` → `MemberCouponRepository.findById` | `C-07` | 0행이면 그 행을 다시 읽어 까닭을 가른다 |
| `findById.sameRef` | `C-07` | 이미 `LOCKED`이고 `lock_ref`가 같다 — 같은 주문의 재호출이다. 점유된 것으로 센다(멱등) |
| `findById.unavailable` | `C-07`·`R-09` | 다른 `ref`가 점유 중, `USED`, 유효기간 밖, 행 없음 — 모두 `unavailable`에 담는다. 하나라도 있으면 `lock`은 `unavailable{ids}`를 돌려준다. 앞서 바꾼 행은 호출자의 롤백으로 되돌아간다 |

- **트리거** 상위 `Order.placeOrder`의 `Promotion.lockCoupons`(§5.6). **완료 사실** 쿠폰 전부 `LOCKED`(`lock_ref = ref`) 또는 `unavailable` 값. 부분 점유를 커밋하는 길은 없다 — order가 `unavailable`이면 롤백한다.
- **동시성** 두 주문이 같은 쿠폰을 동시에 점유하면 InnoDB 행 잠금으로 조건부 갱신이 차례로 돈다. 둘째는 0행 → `findById`에서 `unavailable`이 된다(첫째가 커밋했으면) 또는 첫째 트랜잭션이 끝날 때까지 기다린다(§6 잠금 대기).
- `sameRef`·`unavailable` 두 줄 뒤로는 이 그림의 객체를 더 부르지 않는다. 결과를 모아 돌려주는 것은 `lock`이다.

### JF-1.3 사용 확정과 해제 — MemberCouponLedger.use·release

```jobflow
orchestrator: MemberCouponLedger
Object: MemberCouponLedger, MemberCouponRepository, ValidityPolicy

MemberCouponLedger.use --> MemberCouponRepository.markUsedByRef
MemberCouponLedger.release --> MemberCouponRepository.findByRef
MemberCouponRepository.findByRef.locked --> MemberCouponRepository.unlock
MemberCouponRepository.findByRef.used --> ValidityPolicy.isValidAt
ValidityPolicy.isValidAt.true --> MemberCouponRepository.restore
ValidityPolicy.isValidAt.false --> MemberCouponRepository.expire
MemberCouponRepository.findByRef.none
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `MemberCouponRepository.markUsedByRef` | `C-07`·`R-10` | `UPDATE … SET status='USED', used_at=? WHERE lock_ref=? AND status='LOCKED'`. `lock_ref`는 남긴다(사용한 주문의 기록). 두 번째 호출은 0행이고 `{used:0}` — 오류가 아니다. 점유 중에 유효기간이 지난 쿠폰도 `USED`가 된다 — 점유가 그 주문의 사용권을 지킨다 |
| `MemberCouponRepository.findByRef` | `C-07`·`R-13`·`R-20` | `lock_ref = ref`인 행을 `FOR UPDATE`로 읽는다. 값 셋으로 가른다 |
| `.locked` → `unlock` | `C-07`·`R-20` | 결제 실패·만료·결제 전 취소. `LOCKED → AVAILABLE`, `lock_ref`·`locked_at`를 비운다 |
| `.used` → `ValidityPolicy.isValidAt` → `restore`·`expire` | `C-07`·`R-13` | 결제 후 취소. 지금이 `valid_to` 안이면 `USED → AVAILABLE`(`restore` — `lock_ref`·`used_at`를 비우고 `released_at` 기록), 지났으면 `USED → EXPIRED`(`expire`) |
| `.none` | `C-07` | `ref`로 점유·사용된 행이 없다 — 쿠폰 없는 주문이거나 이미 해제했다. `{restored:0, expired:0}`로 끝난다 |

- **트리거** 상위 §5.7~§5.10의 결제 확정·해제 트리거(승인·대사·웹훅·만료·취소)가 order 안에서 확정 트랜잭션 `OrderSettlement.settlePaid`와 해제 트랜잭션 `OrderSettlement.release`로 모인다([order 상세 `JF-4.1`·`JF-4.2`](order.md#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid)). `use`는 `settlePaid`, `release`는 `release`와 결제 후 취소가 부른다. **완료 사실** 그 주문의 회원 쿠폰이 `USED`, 또는 `AVAILABLE`·`EXPIRED`.
- 상위에서 `useCoupons`·`releaseCoupons`로 화살표가 여럿 들어오는 것은 서로 다른 트리거가 같은 계약을 부르는 **합류**다. 같은 주문으로 두 트리거가 함께 올 수 있다(승인 응답과 대사 등). 첫 번째 진입은 order의 조건부 상태 전이가, 두 번째 진입은 여기의 「바뀌는 행 0」이 막는다.
- `restore`·`expire`로 들어오는 화살표는 `isValidAt` 참·거짓 택일의 결과라 행마다 한 번이다. 쿠폰이 두 장이면 `findByRef`의 값 분기는 행마다 따로 돈다.
- 해제 뒤 같은 `ref`로 `use`가 오면 0행이다 — 해제한 쿠폰을 그 주문이 다시 쓰지 않는다. 만료 경합(가예약이 해제된 뒤 대사가 `paid`를 확인)은 order가 확정 대신 환불로 처리하므로 `use`를 부르지 않는다(핵심 §5.8).

### JF-2 고객 라우트 진입 — PromotionPublicController

```jobflow
orchestrator: PromotionPublicController
Object: PromotionPublicController, ExhibitionQuery, CouponDownloader, MemberCouponQuery

PromotionPublicController.listExhibitions --> ExhibitionQuery.listActive
PromotionPublicController.getExhibition --> ExhibitionQuery.getActive
ExhibitionQuery.getActive.notFound
PromotionPublicController.downloadCoupon --> CouponDownloader.download
PromotionPublicController.listMyCoupons --> MemberCouponQuery.listMine
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `listExhibitions` → `ExhibitionQuery.listActive` | `C-07`·`R-01` | 상위 `Promotion.listExhibitions`. `status='PUBLISHED' AND starts_at <= now < ends_at`, `placement` 조건, `sort_order` 순 |
| `getExhibition` → `ExhibitionQuery.getActive`·`.notFound` | `C-07`·`R-01`·`R-02` | 상위 `Promotion.getExhibition`. 같은 조건으로 한 건 + 상품 ID 목록 + 쿠폰 요약을 읽는다. 쿠폰의 `downloadable`은 다운로드 기간 안·`ACTIVE`·수량 남음이다. `.notFound`는 404 `EXHIBITION_NOT_FOUND`로 끝난다 |
| `downloadCoupon` → `CouponDownloader.download` | `C-07`·`R-02` | 상위 `Promotion.downloadCoupon`. 라우트 하나 = 트랜잭션 하나. 안쪽은 `JF-2.1` |
| `listMyCoupons` → `MemberCouponQuery.listMine` | `C-07` | 상위 `Promotion.listMyCoupons`. 세션의 회원 ID로만 읽는다. 유효기간이 지난 `AVAILABLE`은 읽을 때 `EXPIRED`로 바꿔 보인다(DB 갱신은 보존 작업이 한다). 상위 §5.6과 같이 `skuIds`를 받지 않고 적용 판정을 주지 않는다 — 가격·카테고리를 모르는 promotion이 정할 수 없어서다. 판정은 `JF-1.1`의 `evaluations` |

- **트리거** 고객 화면의 `Home`·`EventPage`·쿠폰함·`CouponSelectModal`. 쿠폰 받기의 401은 인증 미들웨어가 컨트롤러 앞에서 낸다 — 상위 `Promotion.downloadCoupon.unauthorized`에 대응하는 코드는 이 경계에 없다.
- 기획전 상품 카드는 화면이 `productIds`로 `Catalog.listProducts?ids=`를 따로 부른다. 판매중지 상품은 catalog가 거르므로 promotion은 상품 ID의 유효성을 보지 않는다(핵심 §5.2).

### JF-2.1 쿠폰 받기 — CouponDownloader.download

```jobflow
orchestrator: CouponDownloader
Object: CouponDownloader, CouponRepository, MemberCouponRepository, ValidityPolicy

CouponDownloader.download --> CouponRepository.findForDownload
CouponRepository.findForDownload.notFound
CouponRepository.findForDownload.closed
CouponRepository.findForDownload.open --> MemberCouponRepository.existsFor
MemberCouponRepository.existsFor.true
CouponDownloader.download --> CouponRepository.incrementIssued
CouponRepository.incrementIssued.exhausted
CouponDownloader.download --> ValidityPolicy.periodFor
ValidityPolicy.periodFor.result --> MemberCouponRepository.insert
MemberCouponRepository.insert.duplicate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CouponRepository.findForDownload`·`.notFound`·`.closed` | `C-07`·`R-02` | 쿠폰 정의를 읽는다. 없음 → 404 `COUPON_NOT_FOUND`. `.closed`는 다운로드할 수 없는 기간 — `downloadFrom` 전이면 409 `NOT_STARTED`, `downloadTo`가 지났거나 `STOPPED`이거나 고정 유효기간 `validTo`가 지났으면 410 `EXPIRED` |
| `.open` → `MemberCouponRepository.existsFor`·`.true` | `C-07`·`R-02` | 이미 받은 회원은 수량을 건드리지 않고 409 `ALREADY_DOWNLOADED`로 끝낸다(빠른 길). 최종 방어는 아래 유일 제약이다 |
| `CouponRepository.incrementIssued`·`.exhausted` | `C-07`·`R-02` | 조건부 증가 `UPDATE coupons SET issued_count = issued_count + 1 WHERE id=? AND (issue_limit IS NULL OR issued_count < issue_limit)`. 0행이면 410 `EXHAUSTED` |
| `ValidityPolicy.periodFor` | `C-07` | 회원 쿠폰의 유효기간을 정한다 — 고정형은 정의의 `validFrom`~`validTo`, 상대형은 받은 시각 ~ 받은 날 + N일의 23:59:59(Asia/Seoul, 잠정). 상대형도 `downloadTo`와 상관없이 N일을 준다 |
| `MemberCouponRepository.insert`·`.duplicate` | `C-07`·`R-02` | `member_coupons` 한 행(`AVAILABLE`). `UNIQUE(member_id, coupon_id)` 위반이면 같은 회원의 동시 요청이 먼저 넣은 것이다 — 트랜잭션을 롤백해 앞의 수량 증가도 되돌리고 409 `ALREADY_DOWNLOADED` |

- **트리거** 상위 `Browser.downloadCoupon --> Promotion.downloadCoupon`(§5.2). **완료 사실** 201 — `issued_count` +1과 회원 쿠폰 1행이 한 트랜잭션으로 함께 남는다. 오류 응답은 모두 화면에 머물며 토스트만 띄운다(N1).
- **실패 분기** `.notFound`·`.closed`·`existsFor.true`·`.exhausted`·`.duplicate` 다섯 줄은 오류 응답으로 끝나는 분기다. 줄 순서는 판정 순서와 같다 — 기간 → 이미 받음 → 수량 → 저장.
- `incrementIssued`·`periodFor`는 `existsFor.false`일 때만 부른다. 그림에서는 같은 `download`의 다음 단계로 그렸다(거짓 값은 후속이 같아 따로 적지 않았다).
- 선착순 쿠폰은 `coupons` 한 행에 갱신이 몰린다(§8 위험). 수량 초과 발급은 조건부 증가가 막고, 1인 2매는 유일 제약이 막는다.

### 3.1 운영 라우트 처리

상위 `Promotion.adminPromotion`(§5.1) = `Promotion.saveCoupon`·`Promotion.saveExhibition`(§5.15)은 「검사 → 저장」 두 단계뿐이라 그림 대신 이 표로 연다. 모든 라우트는 운영자 세션만 받는다(403 — 인증 미들웨어).

| 진입 | 검사(422 `VALIDATION_FAILED` 또는 409) | 저장 | 근거 |
|---|---|---|---|
| `AdminPromotionController.saveCoupon` → `CouponEditor.create` | `discountType` `AMOUNT`면 `value ≥ 1`, `RATE`면 1~90(핵심 §6.1). `RATE`이고 `maxDiscount`가 없으면 경고 없이 상한 없음(잠정). `minOrderAmount ≥ 0`. `target.type`이 `CATEGORY`·`PRODUCT`면 `ids` 1~100개. `validTo`와 `daysAfterDownload` 중 정확히 하나(`daysAfterDownload` 1~365, 고정형은 `validFrom < validTo`). `downloadFrom < downloadTo`, 고정형은 `downloadTo ≤ validTo`. `issueLimit`은 없거나 ≥ 1. `perMemberLimit`은 1만 받는다 | `coupons` 한 행 `ACTIVE`, `issued_count = 0`. 쿠폰 종류(`kind`)는 저장하지 않고 대상에서 정한다 — 전체 = 장바구니 쿠폰, 카테고리·상품 = 상품 쿠폰(3.2) | `C-07`·`R-21` |
| `AdminPromotionController.saveCoupon` → `CouponEditor.update` | 발급 1매 이상이면 할인 조건·대상·유효기간을 못 바꾼다(409 `COUPON_TERMS_LOCKED`). `issueLimit < issued_count`면 409 `BELOW_ISSUED`. 이름·`downloadTo`·`status`(`STOPPED` — 다운로드만 막고 받은 쿠폰은 그대로 쓴다)는 바꿀 수 있다 | 같은 행 갱신 | `C-07`·`R-21` |
| `AdminPromotionController.saveExhibition` → `ExhibitionEditor.create`·`update` | 기간 `startsAt < endsAt`, `placement`는 정한 목록(`home`·`event_list`, 잠정), `productIds` 1~300개·중복 없음, `couponIds`는 존재하는 쿠폰만. 상품 ID의 존재·판매 상태는 보지 않는다(catalog를 부르지 않는다) | `exhibitions` 한 행 + `exhibition_products`를 통째로 바꿔 쓴다(삭제 후 삽입, 같은 트랜잭션) | `C-07`·`R-21` |
| `listExhibitions`·`listCoupons`(운영) | 필터 값이 소유 상태 값과 다르면 422 `VALIDATION_FAILED` | 읽기. 기획전 `period`는 상태 열이 아니라 지금 시각과 기간으로 가르는 조건이다(`UPCOMING` `now < starts_at`, `ONGOING` `starts_at ≤ now < ends_at`, `ENDED` `ends_at ≤ now`). 쿠폰 목록은 `issued_count`와 사용 수(`usedCount`)를 함께 낸다 | `C-07`·`R-21` |
| `getExhibition`·`getCoupon`(운영 단건) | 없으면 404 | 읽기. 기획전은 `exhibition_products`의 순서대로 `productIds`와 `bannerImageUrl`(설정의 기본 주소 + 키)을, 쿠폰은 상태별 회원 쿠폰 수와 `termsLocked`를 함께 낸다 | `C-07`·`R-21` |

### 3.2 할인 계산·안분·중복 규칙

`DiscountCalculator`·`DiscountAllocator`·`StackingPolicy`·`EligibilityRule`의 원본 규칙이다. 「잠정」은 운영 정책이 정해지면 바뀔 수 있는 값이다.

| 항목 | 규칙 | 상태 |
|---|---|---|
| 쿠폰 종류 | 대상이 전체(`ALL`)면 **장바구니 쿠폰**, 카테고리·상품이면 **상품 쿠폰** | 잠정 |
| 중복 사용 | 주문당 상품 쿠폰 최대 1장 + 장바구니 쿠폰 최대 1장. 같은 종류 2장은 둘 다 `CONFLICT`. 3장 이상은 넘친 것이 모두 `CONFLICT` | 잠정 |
| 대상 품목 | 상품 쿠폰: `productId ∈ target.ids`(상품) 또는 `categoryIds ∩ target.ids ≠ ∅`(카테고리 — 조상 카테고리를 겨눈 쿠폰은 하위 카테고리 상품에도 맞는다). 장바구니 쿠폰: 모든 품목 | 확정 |
| 기준 금액 | 상품 쿠폰: 대상 품목의 `unitPrice × quantity` 합. 장바구니 쿠폰: 모든 품목의 (`unitPrice × quantity` − 상품 쿠폰 안분액) 합. 배송비는 넣지 않는다 | 잠정(장바구니 쿠폰 기준) |
| 최소 주문 금액 | 그 쿠폰의 기준 금액 ≥ `minOrderAmount` | 잠정 |
| 할인액 | 정액: `min(value, 기준 금액)`. 정률: `floor(기준 금액 × value / 100)`(원 미만 버림), `maxDiscount`가 있으면 그 값 이하 | 확정 |
| 계산 순서 | 상품 쿠폰 → 안분 → 장바구니 쿠폰 → 안분 | 잠정 |
| 안분 | 쿠폰 할인액을 대상 품목에 기준 금액 비율로 나눈다. 품목 몫 = `floor(할인액 × 품목 기준 금액 / 기준 금액 합)` | 확정 |
| 끝전 | 몫의 합과 할인액의 차이(끝전, 품목 수 − 1원 이하)를 기준 금액이 가장 큰 품목에 더한다. 같으면 `lines`의 앞 품목 | 확정 |
| 안분 단위 | 주문 줄(`lineKey`) 단위. 수량 1개 단위의 나눔(부분 반품용)은 order가 한다 | 미확정(§8) |

계산 예 — 품목 A 30,000원 × 1(의류), B 20,000원 × 2(의류), C 15,000원 × 1(잡화). 상품 쿠폰 「의류 15%, 최대 10,000원, 최소 30,000원」과 장바구니 쿠폰 「3,000원, 최소 50,000원」.

| 단계 | A | B | C | 합 |
|---|---|---|---|---|
| 품목 금액 | 30,000 | 40,000 | 15,000 | 85,000 |
| 상품 쿠폰 — 기준 70,000 × 15% = 10,500 → 상한 10,000 | 4,285 | 5,714 + 끝전 1 = 5,715 | — | 10,000 |
| 장바구니 쿠폰 기준(상품 쿠폰 뒤) | 25,715 | 34,285 | 15,000 | 75,000 ≥ 50,000 |
| 장바구니 쿠폰 3,000 | 1,028 | 1,371 + 끝전 1 = 1,372 | 600 | 3,000 |
| 품목 할인(`lineDiscounts`) | 5,313 | 7,087 | 600 | 13,000 |

## 4. 소유 상태·데이터

표 넷 — 핵심 §6.2의 「기획전·쿠폰·회원 쿠폰 4표」다. 다른 모듈의 ID(`member_id`·`product_id`·주문 참조)는 논리 참조이고 모듈을 넘는 외래 키를 두지 않는다(`D-01`).

| 표 | 주요 열 | 비고 |
|---|---|---|
| `exhibitions` | `id`, `title`, `banner_image_key`, `placement`, `sort_order`, `starts_at`, `ends_at`, `status`(`DRAFT`·`PUBLISHED`·`HIDDEN`), `coupon_ids`(JSON 배열), `created_at`, `updated_at` | 색인 `(placement, status, starts_at)`. 쿠폰 ID는 노출용 목록이라 따로 표를 두지 않았다. 종료 1년 뒤 보존 작업이 지운다 |
| `exhibition_products` | `exhibition_id`, `product_id`, `sort_order` | PK `(exhibition_id, product_id)`. 상품 ID의 존재는 보지 않는다(catalog 소유) |
| `coupons` | `id`, `name`, `discount_type`(`AMOUNT`·`RATE`), `value`, `max_discount`, `min_order_amount`, `target_type`(`ALL`·`CATEGORY`·`PRODUCT`), `target_ids`(JSON), `issue_limit`(NULL = 무제한), `issued_count`, `per_member_limit`(1), `valid_from`, `valid_to`, `days_after_download`, `download_from`, `download_to`, `status`(`ACTIVE`·`STOPPED`), `created_at`, `updated_at` | CHECK `valid_to`와 `days_after_download` 중 하나만, `issued_count ≤ issue_limit`(조건부 증가가 지키고 CHECK가 최후 방어). 다운로드 기간·모든 회원 쿠폰이 끝나고 1년 뒤 지운다 |
| `member_coupons` | `id`, `member_id`, `coupon_id`, `status`(`AVAILABLE`·`LOCKED`·`USED`·`EXPIRED`), `valid_from`, `valid_to`(받을 때 정한 값), `lock_ref`, `locked_at`, `used_at`, `released_at`, `downloaded_at` | `UNIQUE(member_id, coupon_id)` — 1인 1매(사용한 뒤에도 다시 받지 못한다). 색인 `(lock_ref)`, `(member_id, status)`, `(status, valid_to)`. `EXPIRED`·`USED`가 된 지 1년 뒤 지운다 — 주문의 할인 기록은 order 품목 스냅숏에 남는다 |

### 4.1 회원 쿠폰 상태 기계

상태 소유자는 promotion(`member_coupons.status`)이다. 다른 모듈은 이 열에 쓰지 않고 `lockCoupons`·`useCoupons`·`releaseCoupons`로만 바꾼다. 초기화는 다운로드 성공 때 `AVAILABLE` 한 행이다.

```state
<s> --> (AVAILABLE) : downloadCoupon — 수량 조건부 증가 성공
(AVAILABLE) --> (LOCKED) : lockCoupons(ref) — 유효기간 안
(LOCKED) --> (USED) : useCoupons(ref)
(LOCKED) --> (AVAILABLE) : releaseCoupons(ref)
(USED) --> (AVAILABLE) : releaseCoupons(ref) — 유효기간 남음
(USED) --> (EXPIRED) : releaseCoupons(ref) — 유효기간 지남
(AVAILABLE) --> (EXPIRED) : purgeExpired — valid_to 지남
(EXPIRED) --> <e> : purgeExpired — 1년 경과
(USED) --> <e> : purgeExpired — 사용 1년 경과
```

**기호**: `<s>` 시작점, `(…)` 상태, `<e>` 행이 지워져 수명이 끝나는 곳, `A --> B : 글` A에서 B로 가는 전이와 그 입력·조건(`state-diagram-guide.md` 「구성 요소」).

- **불변조건**: `LOCKED`·`USED`이면 `lock_ref`가 있고, `AVAILABLE`·`EXPIRED`이면 없다. 한 `lock_ref`에 묶인 행은 상품 쿠폰 1장·장바구니 쿠폰 1장을 넘지 않는다(`quote`가 걸러 낸 쿠폰만 order가 점유한다).
- **`LOCKED`는 만료되지 않는다**: 점유 중에 `valid_to`가 지나도 보존 작업은 `LOCKED`를 건드리지 않는다. 그 주문이 결제되면 `USED`, 실패·만료·취소되면 `release`가 `AVAILABLE`로 돌렸다가 — 그 시점에 이미 유효기간 밖이면 다음 보존 작업이 `EXPIRED`로 닫는다. 읽기(`listMine`·`quote`)는 `valid_to`로 바로 판정하므로 보존 작업이 늦어도 지난 쿠폰을 쓸 수 없다.
- **같은 `ref` 재점유**: `LOCKED`이고 `lock_ref`가 같으면 `lockCoupons`는 상태를 바꾸지 않고 성공으로 센다(그림에 자기 전이를 그리지 않았다).
- **무시하는 입력**: `USED`·`EXPIRED`에 대한 `lockCoupons`는 `unavailable`, 묶인 행이 없는 `ref`의 `useCoupons`·`releaseCoupons`는 0행으로 끝난다.
- 주문 하나의 쿠폰 상태가 다른 모듈의 기록과 어떻게 맞물리는지는 [상위 §5.18](../system-design-to-be.md#518-주문-상태--여러-경계가-나눠-가진-기록)에 있다. 부분 반품은 `USED`를 그대로 둔다(잠정 — 핵심 §9.5).

## 5. 의존 — 나가는 방향

다른 모듈과 외부 서비스를 부르지 않는다(핵심 §3 「나가는 의존 0개」, `D-02`). 아래는 이 모듈이 기대는 실행 기반과, 호출자 입력에 대한 결합이다.

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| MySQL(자기 표 넷) | SQL — 조건부 갱신·유일 제약·`FOR UPDATE` | mall-api의 데이터소스와 트랜잭션 관리자를 주입받는다 | 잠금 대기 3s(§6) | 다른 모듈 표를 조인·갱신하지 않는다 — 경계 검사 시험이 지킨다(`C-21`) |
| mall-api 조립 지점 | 라우트 등록, 인증 주체(회원 ID·운영자 역할), `Clock`, 보존 작업 스케줄 | `PromotionModule` 설정 클래스 하나로 등록 | — | 들어오는 배선이다. promotion은 mall-api의 업무 규칙을 부르지 않는다 |
| (호출자 입력) order | `quote`의 `lines[].unitPrice`·`productId`·`categoryIds` | — | — | 이 값이 맞다고 믿는다. order가 `CatalogApi.getSkus`의 `SkuView`(`productId`·`categoryIds` — 조상 포함)에서 받아 넣는다([catalog 상세 §2](catalog.md#2-공개-계약)) |

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 서비스 트랜잭션 | 호출자 트랜잭션 필수(`MANDATORY`) | — | `PromotionService` |
| 행 잠금 대기 | 3s — 넘으면 다운로드 503 `BUSY`, 서비스는 예외를 호출자에게 던진다(order가 롤백) | `promotion.lock-wait-timeout`(세션 `innodb_lock_wait_timeout`) | `CouponDownloader`, `MemberCouponLedger` |
| 주문당 쿠폰 수 | 상품 1 + 장바구니 1 | `promotion.stacking.product-max`=1, `promotion.stacking.cart-max`=1 | `StackingPolicy` |
| 정률 범위 | 1~90% | — | `CouponEditor` |
| 상대 유효기간 | 1~365일, 끝은 그날 23:59:59 | — | `ValidityPolicy` |
| 시간대 | Asia/Seoul | `promotion.zone` | `ValidityPolicy`, 기간 비교 전부 |
| 기획전 상품 수 | 300개 | `promotion.exhibition.max-products` | `ExhibitionEditor` |
| 보존 기한 | 끝난 쿠폰·종료 기획전 1년 | `promotion.retention.days`=365 | `PromotionRetention` |

- **인증** 쿠폰 받기·쿠폰함은 회원 세션, 운영 라우트는 운영자 역할이 있어야 한다 — 둘 다 컨트롤러 앞의 인증 미들웨어가 401·403을 낸다(`C-21`). 쿠폰함은 세션의 회원 ID만 쓰고 경로·쿼리로 회원을 받지 않는다. `quote`는 `memberId`와 회원 쿠폰의 소유자를 대조한다 — 남의 쿠폰 ID를 넣어도 `NOT_OWNED`다.
- **동시성** 수량은 조건부 증가, 1인 1매는 `UNIQUE(member_id, coupon_id)`, 점유는 `status='AVAILABLE'` 조건부 갱신, 해제는 `FOR UPDATE` 읽기 뒤 갱신이다. 잠금 순서는 항상 `coupons` → `member_coupons`, 여러 회원 쿠폰은 ID 오름차순으로 잠가 교착을 피한다.
- **최후 방어** `issued_count ≤ issue_limit` CHECK, 유일 제약, 서비스의 `MANDATORY` 전파. 이 셋이 깨지면 예외로 트랜잭션이 롤백되어 반쪽 상태가 남지 않는다.
- **부분 실패 규칙** 견적의 쿠폰 문제 = `rejected` 값(예외 아님), 점유 실패 = `unavailable` 값 + 호출자 롤백, 사용·해제의 0행 = 성공(멱등), DB 오류 = 예외 → 호출자 롤백.

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 선착순 수량 | `POST /api/coupons/{couponId}/download`, `R-02` | 시험 DB(Testcontainers MySQL 8)에서 `issueLimit` 100 쿠폰에 회원 500명 동시 요청 → 201 정확히 100, `issued_count` 100, 나머지 410 `EXHAUSTED` | 핵심 §9.1 순서 2 promotion 작업 |
| 1인 1매 경합 | 같은 회원 동시 2회 다운로드 | 201 1건 + 409 1건, `issued_count` 1(유일 위반 롤백이 증가도 되돌린다) | 순서 2 |
| 다운로드 기간·만료 | `.closed` 분기 | 고정 시계로 `downloadFrom` 전 → 409 `NOT_STARTED`, `downloadTo` 뒤·`STOPPED` → 410 `EXPIRED`, 상대형 유효기간 끝이 받은 날 + N일 23:59:59 | 순서 2 |
| 견적 계산 표 | `quote`, 3.2 | 3.2 계산 예를 포함한 표 기반 단위 시험 — 정률 버림, 최대 할인, 최소 주문 금액, 조상 카테고리 매칭, 상품 2장 `CONFLICT`, 비회원 `NOT_OWNED`, `LOCKED` 쿠폰 `NOT_AVAILABLE` | 순서 2 |
| 안분 성질 | `DiscountAllocator.allocate` | 속성 기반 시험(jqwik) — 무작위 품목·쿠폰 1만 건에서 `Σ 몫 = 할인액`, `0 ≤ 몫 ≤ 품목 금액`, 끝전 ≤ 품목 수 − 1 | 순서 2 |
| 점유 멱등·경합 | `lockCoupons` | 같은 `ref` 2회 → 둘 다 `locked`. 다른 `ref` → `unavailable`. 두 트랜잭션이 같은 쿠폰 동시 점유 → 하나만 `locked`. 호출자 트랜잭션 없이 호출 → 예외 | 순서 2 |
| 사용·해제 멱등과 기한 경계 | `useCoupons`·`releaseCoupons`, 4.1 | `use` 2회 → `{used:1}`·`{used:0}`. `LOCKED` 해제 → `AVAILABLE`. `USED` 해제를 `valid_to` 1초 전·1초 뒤 시계로 → `AVAILABLE`·`EXPIRED`. 해제 2회 → 둘째 0. 해제 뒤 `use` → 0 | 순서 2 |
| 주문 경로 끝단 | §5.6·§5.7·§5.10, `R-13`·`R-20` | 핵심 §9.2 「결제 끝단」·「취소 끝단」에서 쿠폰 상태를 함께 단언 — 결제 실패 → `AVAILABLE`, 결제 완료 → `USED`, 취소 → `AVAILABLE` | 핵심 §9.1 순서 3·4 뒤 |
| 모듈 경계 | `D-02` | ArchUnit — promotion 패키지가 다른 업무 모듈 패키지를 참조하지 않는다, 다른 모듈이 promotion 내부 패키지·표를 참조하지 않는다 | 매 빌드 |
| 운영 조회와 필터 | `GET /api/admin/exhibitions`·`/{exhibitionId}`, `GET /api/admin/coupons`·`/{couponId}` | 고정 시계로 기간을 나눈 기획전 셋 → `period=UPCOMING`·`ONGOING`·`ENDED` 각 1건, `status=HIDDEN` → 숨김만, `status=RUNNING` 같은 모르는 값 → 422 `VALIDATION_FAILED`. 미게시 기획전 단건 → 200, 없는 ID → 404. 1매 발급된 쿠폰 단건 → `termsLocked:true`·상태별 회원 쿠폰 수 | 순서 2 |
| 보존 작업 | `purgeExpired` | 시계를 옮긴 시험 DB — 지난 `AVAILABLE` → `EXPIRED`, `LOCKED`는 그대로, 1년 지난 `EXPIRED`·`USED`만 삭제 | 핵심 §9.1 순서 6 |

`./gradlew :promotion:test`(잠정 스택 기준)로 돈다. 작업 순서는 [상위 §9.1](../system-design-to-be.md#91-독립-작업-순서)의 순서 2 「쿠폰·기획전」 행이다.

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-07` | 미확정 | 쿠폰 중복 사용 규칙 — 주문당 상품 쿠폰 1장 + 장바구니 쿠폰 1장, 종류는 대상으로 정한다(전체 = 장바구니) | 3.2 | 국내몰마다 다르다(상품 쿠폰을 품목마다 1장씩 허용하는 곳도 있다). 바꾸면 `StackingPolicy`와 설정 값만 바뀌고 계약은 그대로다 |
| `C-07` | 미확정 | 부분 반품 때 쿠폰을 돌려주지 않는다. 남은 품목이 최소 주문 금액 아래로 떨어져도 할인이 유지된다 | 핵심 [§9.5](../system-design-to-be.md#95-미확정필요-입력) | 운영 정책이 정해지면 claim이 `releaseCoupons`류 계약을 새로 부르거나 환불액에서 할인을 회수해야 한다 — promotion에 부분 해제 계약이 늘 수 있다 |
| `C-07`·`R-09` | 위험 | `quote`는 호출자가 준 가격·카테고리를 믿는다 | §2, §5 | order가 브라우저 값을 넘기면 할인 조작이 된다. order 상세 계약과 시험으로 「`Catalog.getSkus` 값만 넣는다」를 지킨다 |
| `C-07` | 위험 | 선착순 쿠폰은 `coupons` 한 행에 갱신이 몰린다 | `JF-2.1` | 동시 요청이 많으면 잠금 대기가 늘어 503 `BUSY`가 날 수 있다. 측정하지 않았다(미확인). 교육용 규모에서는 그대로 두고, 필요하면 발급 수 칸 분할이나 캐시 카운터로 바꾼다 |
| `C-07`·`R-20` | 위험 | 결제창을 연 채 새 주문을 만들면 앞 주문이 쿠폰을 최대 30분(가상계좌는 입금기한까지) 잡는다 | 4.1, 핵심 §5.9 | 새 주문서에서 그 쿠폰이 `NOT_AVAILABLE`로 보인다. 결제창 닫기는 즉시 취소되므로(핵심 §5.10) 대부분 풀린다. 화면이 사유를 「다른 주문에서 사용 중」으로 보인다 |
| `C-07` | 미확정 | 상대형 쿠폰의 유효기간 끝을 받은 날 + N일 23:59:59로 둔다 | `JF-2.1` | 「받은 시각 + N×24시간」을 고르면 `ValidityPolicy`만 바뀐다 |
| `C-07` | 미확정 | 장바구니 쿠폰의 기준 금액과 최소 주문 금액을 상품 쿠폰 할인 뒤 금액으로 본다 | 3.2 | 할인 전 금액으로 보는 몰도 있다. 바꾸면 `DiscountCalculator`만 바뀐다 |
| `C-07`·`C-16` | 미확정 | 안분은 주문 줄 단위다. 수량 2개 중 1개 반품의 환불 안분은 order·claim이 정한다 | 3.2 | order의 `getClaimableLines`가 주는 「결제 안분 금액」의 수량 단위 나눔 규칙이 필요하다([order 상세 §2](order.md#2-공개-계약)) |
| `C-07`·`R-21` | 미확정 | 발급된 쿠폰의 할인 조건은 바꾸지 못하게 했다(409 `COUPON_TERMS_LOCKED`) | 3.1 | 잘못 만든 쿠폰은 `STOPPED`로 막고 새로 만든다. 받은 회원의 쿠폰은 그대로 쓸 수 있다 — 회수 기능은 없다 |
| `C-07`·`R-21` | 미확정 | 기획전 배너는 catalog의 운영 이미지 업로드를 함께 써서(상위 §5.15, 잠정) 키 접두가 상품 이미지와 같고, 업로드했지만 저장하지 않은 배너 객체를 아무도 지우지 않는다 | 3.1, 상위 §5.15 | promotion이 저장소 서명을 하면 나가는 의존이 생겨 이렇게 두었다. 배너 전용 접두나 크기 규칙이 필요해지면 catalog 업로드 계약에 용도 인자를 더한다. 객체 정리는 catalog의 미저장 이미지 정리(catalog 상세 §8)와 함께 정한다 |
| `C-20`·`R-26` | 미확정 | 탈퇴 회원의 회원 쿠폰 처리 | 핵심 §6.2 | promotion은 탈퇴를 모른다. 잠정으로 그대로 두고 보존 작업의 1년 삭제에 맡긴다. 즉시 지워야 하면 member의 탈퇴 흐름이 promotion 계약을 부르거나 보존 작업이 탈퇴 목록을 넘겨야 한다 |
| `C-07`·`R-01` | 위험 | 기획전의 상품 ID는 존재·판매 상태를 확인하지 않는다 | `JF-2`, 3.1 | 판매중지 상품은 화면에서 빠져 기획전 상품 수가 운영자가 넣은 수보다 적게 보일 수 있다. 운영 화면이 catalog로 확인해 보인다(admin-web 몫) |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 계약·수치(잠금 대기 3s, 상품 300개, 보존 1년)는 설계값이고 실행으로 확인하지 않았다.
2. 선착순 다운로드의 처리량과 `coupons` 행 경합의 실제 영향은 측정하지 않았다(미확인).
3. 중복 사용·기준 금액·유효기간 끝 시각은 국내몰의 흔한 형태에서 하나를 고른 잠정안이고, 운영 주체의 확인을 받지 않았다.
4. 잠정 스택(Spring·MySQL·ArchUnit·jqwik)이 바뀌면 심볼·설정 키·명령의 이름이 바뀐다. 경계·계약·상태 기계는 스택과 무관하다.
5. `quote`의 `lines` 필드와 `getSkus` 출력(`SkuView`)의 맞물림은 catalog 상세 §2와 order 상세 §2·`JF-3`의 계약 이름·필드로만 대조했다 — 실행으로 확인하지 않았다.
