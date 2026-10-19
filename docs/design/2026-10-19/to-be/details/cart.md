# cart (모듈) — TO-BE 상세

> **대상**: cart 모듈 전체 — 회원·비회원 장바구니와 `cartKey` 쿠키 수명, 로그인 병합, 주문 상품 삭제, 찜, 버려진 비회원 장바구니 정리(`C-08`·`D-07`·`R-02`·`R-07`·`R-23`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(신규 설계 — 코드 없음)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·테이블·설정이 제안이다 — 그래서 `(제안)` 표시는 생략한다. 다른 경계가 정할 것은 「가정」, 확인하지 못한 것은 「미확인」이다. 그림 근거 열은 `R`·`C`·`D` ID다. 심볼 이름은 상위 §9.5의 잠정 스택(Java 21 + Spring Boot 3, MySQL 8) 기준이다

## 1. 책임 / 비책임

- **책임**: 요청마다 장바구니 소유자를 정한다 — 회원이면 회원 ID, 아니면 `cartKey` 쿠키(`D-07`). `cartKey`의 발급·연장·만료 지시도 이 모듈이 한다. 품목 담기·조회·수량 변경·삭제(`R-07`), 조회 때 catalog의 현재 가격·판매 상태 표시, 로그인 직후 비회원 장바구니 병합(멱등 — `R-23`), 주문 확정 때 주문한 품목 삭제(호출자 트랜잭션 안 — `R-10`·`R-11`), 찜 설정·해제·목록(`R-02`), 30일 동안 쓰지 않은 비회원 장바구니 정리(`purgeExpired` — `D-07`), 탈퇴 회원의 장바구니·찜 삭제(`purgeMembers` — `C-20`)가 이 모듈의 일이다.
- **비책임**: 가격·재고·판매 상태의 원본(catalog — 이 모듈은 담은 시각의 가격을 저장하지 않는다), 재고 점유(주문 생성 때 order가 catalog에 맡긴다 — `D-03`의 C안 기각), 쿠폰·할인·배송비 계산(order 견적·promotion), 어느 품목을 주문할지 고르는 일과 주문서(storefront-web·order), 로그인·세션·요청 주체 판별(member·mall-api 인증 미들웨어), CSRF 검사와 쿠키 읽기·쓰기 기반(mall-api), 찜 목록의 상품 카드(storefront-web이 `GET /api/products?ids=`로 catalog에 묻는다), 정리 작업을 언제 돌릴지와 탈퇴 회원 ID를 모으는 일(mall-api 스케줄러의 보존 작업·탈퇴 정리 작업 — 탈퇴 목록은 `Member.listWithdrawnSince`).
- **아무도 하지 않는 것**: 담은 뒤 가격이 바뀌었다는 알림(조회 때 현재 가격만 보이고, 주문 때 order가 `PRICE_CHANGED`로 막는다), 재입고 알림, 담은 수량이 재고보다 많은지 담을 때 확인하는 일(주문 생성 때 order가 가예약으로 확인한다), 다른 기기 사이의 비회원 장바구니 이어 쓰기.

## 2. 공개 계약

계약 열한 개 — 고객 HTTP 라우트 여덟(장바구니 다섯·찜 셋)과 서비스 셋(order가 부르는 `removeItems`, mall-api 탈퇴 정리 작업이 부르는 `purgeMembers`, mall-api 보존 작업이 부르는 `purgeExpired`). `removeItems`·`purgeMembers`는 모듈 공개 인터페이스 `CartApi`에 선언하고 `CartService`가 구현한다. `purgeExpired`는 mall-api 공용 인터페이스 `RetentionTask`(`com.openmall.common.retention`)를 cart가 구현한 빈 `CartRetentionTask`다. 라우트는 mall-api 라우터가 `/api/cart*`·`/api/wishlist*` 접두로 붙인다. 오류 본문은 mall-api 공통 형식 `{code, message, details}`다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `POST /api/cart/items` | `{skuId, quantity}` — 수량 1~99. 회원 세션 또는 쿠키 `cartKey`(없어도 된다) | 201 `{cartItemId, quantity, itemCount}` — 같은 SKU가 있으면 그 행의 수량을 더한 값. 비회원이 쓸 장바구니가 없었으면 `Set-Cookie: cartKey` 발급 | 404 `NOT_ON_SALE`(판매중지·없는 SKU), 409 `SOLD_OUT`, 409 `MAX_QUANTITY {maxQuantity, currentQuantity}`(합산이 SKU 최대 수량 초과), 409 `CART_FULL {maxItems}`(새 SKU인데 품목 100개), 422 `INVALID_QUANTITY` | `CartRoutes.addItem` → `CartService.addItem` — `JF-2`·`JF-2.2` |
| `GET /api/cart` | 회원 세션 또는 쿠키 `cartKey` | 200 `{items[{cartItemId, skuId, productId, productName, optionName, thumbnailUrl, quantity, maxQuantity, unitPrice, lineAmount, saleStatus, addedAt}], summary{orderableItemCount, orderableAmount}}` — `saleStatus`는 `ON_SALE`·`SOLD_OUT`·`DISCONTINUED`. 장바구니가 없으면 빈 `items`. 비회원은 쿠키 연장 또는 만료 지시 | 없음(장바구니가 없어도 200) | `CartRoutes.getCart` → `CartService.getCart` — `JF-2`·`JF-2.3` |
| `PATCH /api/cart/items/{itemId}` | path, `{quantity}` — 1~99(바꿀 값, 더할 값 아님) | 200 `{cartItemId, quantity}` | 404 `CART_ITEM_NOT_FOUND`(내 장바구니의 품목이 아님), 409 `MAX_QUANTITY {maxQuantity}`, 422 `INVALID_QUANTITY` | `CartRoutes.changeQuantity` → `CartService.changeQuantity` — `JF-2` |
| `DELETE /api/cart/items/{itemId}` | path | 204 — 없는 품목이어도 204(멱등) | 없음 | `CartRoutes.deleteItem` → `CartService.deleteItem` — `JF-2` |
| `POST /api/cart/merge` | 회원 세션(필수) + 쿠키 `cartKey` | 200 `{itemCount, mergedSkuCount, clampedSkuIds[], droppedItemCount}` + `Set-Cookie: cartKey=; Max-Age=0`. 쿠키가 없거나, 쿠키의 장바구니가 이미 없으면(병합됨·정리됨) 204 — 쿠키가 있었으면 만료 지시도 같이 | 401(미로그인 — 인증 미들웨어) | `CartRoutes.merge` → `CartService.mergeGuestCart` — `JF-2`·`JF-2.1` |
| `PUT /api/wishlist/{productId}` | path, 회원 세션 | 204 — 이미 찜했어도 204 | 401(미로그인 — 인증 미들웨어) | `WishlistRoutes.put` → `WishlistService.addWish` — `JF-3` |
| `DELETE /api/wishlist/{productId}` | path, 회원 세션 | 204 — 없어도 204 | 401 | `WishlistRoutes.delete` → `WishlistService.removeWish` — `JF-3` |
| `GET /api/wishlist` | `?page=&size=`(기본 20, 최대 100), 회원 세션 | 200 `{items[{productId, addedAt}], page, totalCount}` — 찜한 순서 최신순 | 401 | `WishlistRoutes.list` → `WishlistService.listWishes` — `JF-3` |
| 서비스 `removeItems(owner, cartItemIds)` | `owner` = `CartOwner.member(memberId)` 또는 `CartOwner.guest(cartKey)`, `cartItemIds` = 주문 품목에 저장된 장바구니 품목 ID 목록(비어도 된다) | 지운 품목 수(`int`). 그 소유자의 장바구니에 없는 ID는 조용히 무시한다 | 호출자 트랜잭션이 없으면 `IllegalTransactionStateException`(프로그래밍 오류). 품목·장바구니가 없다는 오류는 없다 | `CartApi.removeItems` → `CartService.removeItems` — `JF-1` |
| 서비스 `purgeMembers(memberIds)` | 탈퇴한 회원 ID 목록(최대 500) | 지운 장바구니·찜 행 수 | 없음(없는 ID는 무시, 같은 ID로 다시 불러도 결과가 같다) | `CartApi.purgeMembers` → `CartService.purgeMembers` — mall-api 탈퇴 정리 작업이 부른다([mall-api 상세 `JF-3`](mall-api.md#jf-3-주기-작업--mallscheduler)) — `C-20`·`R-26` |
| 서비스 `purgeExpired(now)` | 기준 시각 | `PurgeResult{task:'cart', deleted}` — 지운 비회원 장바구니 수(품목은 함께 지워져 세지 않는다) | DB 오류는 그대로 던진다 — 보존 작업이 기록하고 다음 날 다시 부른다 | `RetentionTask.purgeExpired` → `CartRetentionTask.purgeExpired` → `CartRepository.deleteIdleGuestCarts` — §4.2 |

- **소유자 식별 규칙**: 인증 미들웨어가 회원 주체를 주면 소유자는 그 회원이고 `cartKey` 쿠키는 무시한다(병합만 예외 — 둘을 함께 쓴다). 회원이 아니면 쿠키 `cartKey`가 형식(base64url 22자)에 맞을 때 비회원 소유자다. 형식이 틀리면 쿠키가 없는 것과 같다. 운영자 세션은 장바구니를 쓰지 않는다 — 회원이 아닌 주체로 본다.
- **`cartKey` 쿠키**: 값은 `SecureRandom` 16바이트(128비트)를 base64url로 쓴 22자다. 속성은 `HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=2592000`(30일)이다. `Path=/api`인 것은 order의 `POST /api/orders`도 이 쿠키를 받아야 해서다(아래 「비회원 주문의 소유자」). 서버가 모르는 키를 브라우저가 보내면 그 키를 쓰지 않고 새 키를 발급한다 — 클라이언트가 고른 키로 장바구니를 만들지 않는다.
- **쿠키 발급 계층**: 쿠키는 이 모듈의 라우트 계층(`CartRoutes`가 `CartKeyCookie`로)이 쓴다. 서비스는 HTTP를 모르고 결과에 쿠키 지시(`ISSUE`·`REFRESH`·`EXPIRE`·`NONE`)만 담는다. mall-api는 요청 쿠키를 읽고 응답 헤더를 쓰는 기반만 준다. 키의 수명이 `carts` 행의 수명과 같이 움직여야 해서 이 모듈에 둔다(`D-07`). 화면(storefront-web)은 `HttpOnly`라 키를 읽지도 쓰지도 못한다.
- **비회원 주문의 소유자**: order는 비회원 주문의 `POST /api/orders` 요청에서 쿠키 `cartKey`를 읽어 주문에 저장하고(품목별 `cartItemId`와 함께), 결제 확정 때 `removeItems(CartOwner.guest(cartKey), cartItemIds)`로 넘긴다. 결제 확정은 대사 타이머(§5.8)나 입금 웹훅(§5.9)에서도 일어나 요청 쿠키가 없기 때문이다. 회원 주문은 `CartOwner.member(주문의 memberId)`다. 이 저장은 order의 일이다 — `POST /api/orders`의 `lines[].cartItemId`와 비회원 쿠키 `cartKey`를 받아([order 상세 §2](order.md#2-공개-계약), 상위 §5.6) `orders.cart_owner`·`cart_item_ids`에 둔다([order 상세 §4](order.md#4-소유-상태데이터)). 「바로구매」는 장바구니를 거치지 않아 `cartItemIds`가 비고, `removeItems`는 0을 돌려준다.
- **SKU 최대 수량**: catalog `getSkus`의 `maxQuantity`(catalog 상세 — 운영자가 SKU마다 정하고 기본 10)와 이 모듈의 상한 99 가운데 작은 값이다. 담기·수량 변경은 넘으면 거절하고, 병합은 그 값에서 자른다. 운영자가 나중에 한도를 낮추면 이미 담긴 수량은 그대로 두고 조회에 `maxQuantity`로 알린다 — 주문 때 막는 것은 order다(가정).
- **불변조건**: 소유자 하나에 장바구니 하나(`carts.member_id`·`carts.cart_key` 유일), 장바구니 하나에 SKU 하나당 행 하나(`(cart_id, sku_id)` 유일), 수량 1~SKU 최대(= `min(catalog maxQuantity, 99)` — catalog 기본 10), 장바구니 하나에 품목 100개 이하. 담은 시각의 가격은 어디에도 없다.
- **부작용**: 모든 쓰기는 이 모듈의 세 표에만 한다. 외부 HTTP 호출은 없다. catalog 호출은 같은 프로세스 안의 공개 서비스 호출(DB 읽기)이다.
- **재시도·멱등**: `DELETE`·`PUT`·`DELETE /api/wishlist`·`merge`·`removeItems`·`purgeMembers`·`purgeExpired`는 두 번 불러도 결과가 같다. `POST /api/cart/items`는 멱등이 아니다 — 두 번 보내면 수량이 두 번 더해진다. 화면이 「장바구니 담기」 버튼을 응답 전까지 막는다(storefront-web 몫, 가정).
- **호환성**: 첫 버전이다. 응답에는 필드만 더하고, `saleStatus` 값을 늘릴 때는 화면이 모르는 값을 「구매 불가」로 보이게 한다(가정).

## 3. 내부 Job Flow — 드릴다운

**결론**: 이 모듈의 조율자는 `CartService`(장바구니 계약 전부)와 `WishlistService`(찜) 둘이다. HTTP 쪽은 `CartRoutes`가 소유자 식별(`CartOwnerResolver`) → 서비스 → 쿠키 지시 반영(`CartKeyCookie`)을 잇는다. 바깥으로 나가는 클라이언트 객체는 catalog 공개 계약을 감싼 `CatalogApi` 하나다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Cart.removeItems`(§5.1·§5.7·§5.8·§5.9) | [`JF-1` 주문 상품 삭제](#jf-1-주문-상품-삭제--cartserviceremoveitems) | — |
| `Cart.operate`(§5.1 — 고객 라우트 묶음) | [`JF-2` 고객 라우트 진입](#jf-2-고객-라우트-진입--cartroutes) | 아래 행들 |
| `Cart.toggleWish`(§5.2) — 찜 라우트는 `Cart.operate` 묶음에 들지만 진입이 `WishlistRoutes`라 따로 연다 | [`JF-3` 찜](#jf-3-찜--wishlistservice) | — |
| `Cart.mergeGuestCart`(§5.3) | [`JF-2`](#jf-2-고객-라우트-진입--cartroutes)의 `merge` | [`JF-2.1` 비회원 장바구니 병합](#jf-21-비회원-장바구니-병합--cartservicemergeguestcart) |
| `Cart.addItem`·`Cart.getCart`(§5.5) | [`JF-2`](#jf-2-고객-라우트-진입--cartroutes)의 `addItem`·`getCart` | [`JF-2.2` 담기](#jf-22-담기--cartserviceadditem), [`JF-2.3` 조회](#jf-23-조회--cartservicegetcart) |
| `Cart.purgeMembers`·`Cart.purgeExpired`(§5.17 — mall-api 탈퇴 정리 작업의 `CartApi.purgeMembers`, 보존 작업의 `RetentionTask.purgeExpired`) | 그림 없음 — 둘 다 조건부 `DELETE`를 묶음으로 반복할 뿐이라 [§4.2](#42-버려진-비회원-장바구니-정리)에 적었다 | — |

상위 바깥 노드 ↔ 이 경계의 클라이언트 — `Catalog.getSkus` = `CatalogApi.getSkus`(catalog 모듈의 공개 서비스 인터페이스를 주입받은 것). order가 부르는 `Cart.removeItems`와 mall-api가 부르는 `Cart.purgeMembers`는 들어오는 방향(`CartApi`)이라 이 경계 쪽 클라이언트가 없다.

**표기** 노드는 제안 클래스·메서드다. `CartRepository`·`WishlistRepository`는 이 모듈의 표만 다루는 저장소, `CartRules`·`CartView`는 DB를 보지 않는 순수 규칙·변환이다. 렌더는 확인했다(design-doc-check `--renderer`로 SVG를 만들고 PNG로 봄). 열지 않은 것: `CartService.changeQuantity`(품목 읽기 → `maxQuantity` 확인 → `UPDATE`의 직선 흐름)·`deleteItem`(소유자 조건을 건 `DELETE` 한 문장) — 둘 다 `JF-2` 표에 적었다, `CartOwnerResolver.resolve`(주체와 쿠키 형식만 보는 순수 판별 — §2 「소유자 식별 규칙」), `WishlistRoutes`(서비스로 넘기기만 한다).

### JF-1 주문 상품 삭제 — CartService.removeItems

```jobflow
orchestrator: CartService
Object: CartService, CartRepository

CartService.removeItems --> CartRepository.deleteOwnedItems
CartRepository.deleteOwnedItems.result --> CartService.removeItems.result
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CartService.removeItems` | `C-08`·`R-10`·`R-11` | 트랜잭션 전파 `MANDATORY` — order가 연 확정 트랜잭션(주문 `PAID`·`WAITING_DEPOSIT` 전이와 같은 트랜잭션 — 상위 §6.3의 원자 구간 3)에 들어가고, 트랜잭션이 없으면 거절한다. `cartItemIds`가 비면 DB에 가지 않고 0을 돌려준다 |
| `CartRepository.deleteOwnedItems` | `C-08`·`D-07` | ① 소유자의 `carts` 행을 `SELECT … FOR UPDATE`로 잠근다(없으면 0) ② `DELETE FROM cart_items WHERE cart_id = ? AND cart_item_id IN (…)`. 다른 소유자의 ID와 이미 지운 ID는 조건에서 빠져 조용히 무시된다. 잠금 순서는 다른 쓰기와 같은 「`carts` 행 → `cart_items` 행」이다(§6) |
| `.result` → `removeItems.result` | `C-08` | 지운 수를 order에 돌려준다. order는 이 값으로 판정하지 않는다(0이어도 확정은 계속) — 로그용이다 |

- **트리거** order의 결제 확정 트랜잭션 `OrderSettlement.settlePaid`(승인·대사가 모이는 곳, `APPROVING`에서 온 확정만 — [order 상세 `JF-4.1`](order.md#jf-41-결제-확정-트랜잭션--ordersettlementsettlepaid))과 가상계좌 발급 트랜잭션(§5.9, order 상세 `JF-5`). 서로 다른 트리거가 같은 계약을 부르는 합류이고, 한 주문에 두 번 오면 두 번째는 지울 행이 없어 0이다. 두 번 오는 것 자체는 order의 조건부 전이가 막는다.
- **완료 사실** 주문한 장바구니 품목 행이 사라진다. 수량과 상관없이 행을 통째로 지운다 — 주문 수량이 장바구니 수량보다 적어도 그 행은 없어진다.
- **실패 분기** 이 계약은 업무 오류를 던지지 않는다. DB 오류(잠금 대기 초과 등)는 던져서 order의 확정 트랜잭션을 롤백시킨다 — 장바구니 정리 때문에 결제 확정이 실패할 수 있다는 뜻이다. 그 대신 장바구니가 반쯤 지워진 채 주문만 확정되는 일은 없다. 롤백 뒤 처리는 order의 몫이다 — 잠금 대기 초과 같은 일시 오류면 order는 망취소하지 않고 주문을 `APPROVING`으로 둬 대사가 다시 확정한다(상위 §5.7·§5.8).

### JF-2 고객 라우트 진입 — CartRoutes

```jobflow
orchestrator: CartRoutes
Object: CartRoutes, CartOwnerResolver, CartService, CartKeyCookie

CartRoutes.addItem --> CartOwnerResolver.resolve
CartRoutes.addItem --> CartService.addItem
CartRoutes.addItem --> CartKeyCookie.apply
CartRoutes.getCart --> CartOwnerResolver.resolve
CartRoutes.getCart --> CartService.getCart
CartRoutes.getCart --> CartKeyCookie.apply
CartRoutes.changeQuantity --> CartOwnerResolver.resolve
CartRoutes.changeQuantity --> CartService.changeQuantity
CartRoutes.deleteItem --> CartOwnerResolver.resolve
CartRoutes.deleteItem --> CartService.deleteItem
CartRoutes.merge --> CartOwnerResolver.resolve
CartRoutes.merge --> CartService.mergeGuestCart
CartRoutes.merge --> CartKeyCookie.apply
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CartOwnerResolver.resolve` | `D-07`·`R-07` | 요청 주체(인증 미들웨어가 만든 회원 문맥)와 쿠키 `cartKey`로 `CartOwner`(회원·비회원·없음)와 형식이 맞는 쿠키 키를 돌려준다. DB를 보지 않는다 — 키가 실제로 있는지는 서비스가 본다 |
| `addItem` → `CartService.addItem` → `CartKeyCookie.apply` | `R-07` | 상위 `Cart.addItem`. 결과의 쿠키 지시가 `ISSUE`면 새 키로 `Set-Cookie`. 안쪽은 `JF-2.2` |
| `getCart` → `CartService.getCart` → `CartKeyCookie.apply` | `R-07` | 상위 `Cart.getCart`. 비회원 장바구니를 찾았으면 `REFRESH`(쿠키 30일을 다시 센다), 쿠키는 있는데 장바구니가 없으면 `EXPIRE`. 안쪽은 `JF-2.3` |
| `changeQuantity` → `CartService.changeQuantity` | `R-07` | 소유자 장바구니의 그 품목을 `FOR UPDATE`로 읽고(없으면 404) → `CatalogApi.getSkus([skuId])`로 `maxQuantity`만 확인(넘으면 409 `MAX_QUANTITY`) → `UPDATE`. 판매 상태로는 막지 않는다 — 품절 표시는 다음 조회가 한다. 1~99 범위는 라우트 입력 검사(422). 쿠키는 건드리지 않는다. 상위 `Cart.operate --> Catalog.getSkus`(§5.1)에 든 호출이다 |
| `deleteItem` → `CartService.deleteItem` | `R-07` | 같은 소유자 조건의 `DELETE`. 지운 행이 0이어도 204. 쿠키는 건드리지 않는다 |
| `merge` → `CartService.mergeGuestCart` → `CartKeyCookie.apply` | `R-23` | 상위 `Cart.mergeGuestCart`. 회원 전용 라우트라 미로그인은 인증 미들웨어가 401로 막는다. 쿠키가 있었으면 결과(200·204)와 상관없이 `EXPIRE`. 안쪽은 `JF-2.1` |
| `CartKeyCookie.apply` | `D-07` | 지시 넷 — `ISSUE(key)`·`REFRESH(key)`는 §2의 속성으로 `Set-Cookie`, `EXPIRE`는 `Max-Age=0`, `NONE`은 아무것도 안 쓴다 |

- **트리거** 상위 `Browser.addToCart`·`openCart`(§5.5), 장바구니 화면의 수량·삭제(§5.1 `Cart.operate`), `Browser.restoreReturnUrl`(§5.3). **완료 사실** 서비스 결과의 HTTP 응답과 쿠키 지시.
- `CartOwnerResolver.resolve`로 들어오는 화살표 다섯은 서로 다른 라우트의 실제 호출이다(재호출이나 합류가 아니다). 한 요청에 한 번씩 부른다.
- 서비스 메서드가 트랜잭션 경계다. 라우트는 트랜잭션 밖에서 쿠키를 쓴다 — 서비스가 롤백되면 쿠키 지시도 없다(예외가 라우트까지 올라와 오류 응답이 된다).

### JF-2.1 비회원 장바구니 병합 — CartService.mergeGuestCart

```jobflow
orchestrator: CartService
Object: CartService, CartRepository, CatalogApi, CartRules

CartService.mergeGuestCart --> CartRepository.lockForMerge
CartRepository.lockForMerge.noGuestCart
CartRepository.lockForMerge.locked --> CatalogApi.getSkus
CatalogApi.getSkus.result --> CartRules.merge
CartRules.merge.result --> CartRepository.applyMerge
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CartService.mergeGuestCart(memberId, cookieCartKey)` | `R-23`·`D-07` | 한 트랜잭션. 쿠키 키가 없으면 DB에 가지 않고 `noGuestCart`와 같은 204 |
| `CartRepository.lockForMerge` | `R-23` | 정해진 순서로 잠근다 — ① 비회원 장바구니 `SELECT … WHERE cart_key = ? AND member_id IS NULL FOR UPDATE` ② 회원 장바구니 `FOR UPDATE`(없으면 만든다 — `member_id` 유일 제약이 동시 생성을 하나로 줄이고, 진 쪽은 다시 읽는다) ③ 두 장바구니의 품목. ①이 없으면 `.noGuestCart` |
| `.noGuestCart` | `R-23` | 오류가 아니라 「이미 병합됐거나 정리됐다」로 끝나는 분기 — 204 + 쿠키 만료. 이 그림의 객체를 더 부르지 않는다 |
| `.locked` → `CatalogApi.getSkus(비회원 품목 SKU)` | `R-23`·`C-05` | SKU별 `maxQuantity`를 얻으려고 부른다(같은 SKU 겹침의 상한과, 옮기는 품목이 낮아진 한도를 넘는지). 같은 프로세스의 DB 읽기라 잠금을 쥔 채 불러도 외부 대기가 없다. 비회원 품목은 100개 이하라 한 번에 묻는다. 상위 §5.3의 `Cart.mergeGuestCart --> Catalog.getSkus`다 |
| `CartRules.merge` | `R-23`·`R-07` | 순수 함수. 같은 SKU는 `min(회원 수량 + 비회원 수량, SKU 최대)`(잘렸으면 `clampedSkuIds`에 넣는다). 새 SKU는 회원 장바구니로 옮기고, 수량이 SKU 최대를 넘으면 거기서 자른다. 응답에 없는 SKU(잘못된 ID)는 상한 99를 쓴다. 옮긴 뒤 품목이 100개를 넘으면 비회원 품목을 담은 시각 최신순으로 남기고 나머지를 버린다(`droppedItemCount` — §8 미확정). 판매 상태로는 거르지 않는다 — 품절·판매중지 품목도 그대로 옮기고 다음 조회가 표시한다 |
| `CartRepository.applyMerge` | `R-23` | 같은 SKU는 회원 행의 수량만 바꾸고 비회원 행은 지운다. 새 SKU는 행을 지우고 새로 만들지 않고 `cart_id`만 바꿔 옮긴다 — `cart_item_id`가 그대로 남는다. 마지막에 비회원 `carts` 행을 지운다. 회원 장바구니 `last_used_at` 갱신 |

- **트리거** 상위 `Browser.restoreReturnUrl`(§5.3) — 일반·소셜 로그인 세 경로의 합류 뒤 한 번. 병합이 실패해도 로그인은 성공이고, 화면이 다음 장바구니 열기 때 다시 부른다(상위 §5.3 실패 분기).
- **완료 사실** 비회원 품목이 회원 장바구니에 들어가고 비회원 장바구니가 없어진다. 응답이 200이든 204든 브라우저의 `cartKey` 쿠키는 만료된다.
- **멱등** 두 번째 호출은 ①에서 비회원 장바구니를 찾지 못해 `.noGuestCart`(204)로 끝난다. 수량은 한 번만 더해진다.
- **동시 두 번 호출**(두 탭, 또는 복귀 화면과 장바구니 화면이 함께 부름) 두 트랜잭션이 ①의 같은 행 잠금에서 줄을 선다. 먼저 잡은 쪽이 병합하고 비회원 행을 지운 뒤 커밋하면, 기다리던 쪽은 잠금을 얻은 뒤 행이 없음을 보고 204로 끝난다. 잠금 순서가 언제나 「비회원 → 회원」이라 같은 회원의 병합 둘이 서로 다른 비회원 장바구니를 가져와도 교착이 없다.
- `CartRules.merge.result --> CartRepository.applyMerge`가 왼쪽 `CartRepository` 열로 가는 화살표는 같은 저장소의 다른 메서드를 부르는 것이고 round-trip이 아니다.

### JF-2.2 담기 — CartService.addItem

```jobflow
orchestrator: CartService
Object: CartService, CatalogApi, CartRepository, CartRules

CartService.addItem --> CatalogApi.getSkus
CatalogApi.getSkus.notOnSale
CatalogApi.getSkus.soldOut
CatalogApi.getSkus.available --> CartRepository.lockOrCreateCart
CartRepository.lockOrCreateCart.result --> CartRules.checkAdd
CartRules.checkAdd.overMax
CartRules.checkAdd.cartFull
CartRules.checkAdd.ok --> CartRepository.upsertItem
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CartService.addItem(owner, cookieCartKey, skuId, quantity)` | `R-07` | catalog 조회는 잠금 전에 하고, `lockOrCreateCart`부터 한 트랜잭션이다 — 잠금을 잡은 채 다른 모듈을 부르지 않으려는 순서다 |
| `CatalogApi.getSkus([skuId])` | `R-07`·`C-05` | 상위 `Catalog.getSkus`. 판매중지이거나 없는 SKU는 `.notOnSale` → 404 `NOT_ON_SALE`, 판매중인데 재고가 없으면 `.soldOut` → 409 `SOLD_OUT`, 판매중이고 재고가 있으면 `.available`(렌더러가 `on…` 이름을 이벤트로 그려 `onSale` 대신 이 이름을 쓴다). 재고 수량과 담을 수량은 견주지 않는다 — 재고 여부만 본다 |
| `CartRepository.lockOrCreateCart` | `D-07` | 회원은 `member_id`로, 비회원은 쿠키 키로 `carts` 행을 `FOR UPDATE`로 잠근다. 없으면 만든다 — 비회원이면 새 키를 `SecureRandom`으로 만들고 결과 쿠키 지시가 `ISSUE`가 된다. 쿠키 키가 있었는데 행이 없으면(정리됨·위조) 그 키를 쓰지 않고 새 키를 만든다. `last_used_at` 갱신 |
| `CartRules.checkAdd` | `R-07` | 순수 함수. 담을 수량(같은 SKU 행이 있으면 합산)이 SKU 최대(`min(getSkus의 maxQuantity, 99)`)를 넘으면 `.overMax` → 409 `MAX_QUANTITY`. 새 SKU인데 품목이 이미 100개면 `.cartFull` → 409 `CART_FULL`. 거절이면 트랜잭션이 롤백되어 방금 만든 장바구니·키도 남지 않는다 |
| `CartRepository.upsertItem` | `R-07` | `INSERT … ON DUPLICATE KEY UPDATE quantity = quantity + ?` — `(cart_id, sku_id)` 유일 제약이 같은 SKU를 한 행으로 지킨다. `cartItemId`와 합산 수량을 돌려준다 → 201 |

- **트리거** 상위 `Browser.addToCart`(§5.5) — 화면이 옵션 선택을 먼저 확인한다(N4 `check_option_for_cart`).
- **완료 사실** 품목 1행(새 행이거나 수량을 더한 행), 비회원이면 장바구니와 `cartKey` 쿠키. 같은 장바구니에 동시에 두 번 담아도 `carts` 행 잠금이 순서를 세워 개수·수량 검사가 어긋나지 않는다.
- **실패 분기** `.notOnSale`·`.soldOut`·`.overMax`·`.cartFull` 네 줄은 오류 응답으로 끝나는 분기다 — 화면은 상세에 머물며 오류를 보인다(N4 `(/cart/add) --> ProductDetail : error`).

### JF-2.3 조회 — CartService.getCart

```jobflow
orchestrator: CartService
Object: CartService, CartRepository, CatalogApi, CartView

CartService.getCart --> CartRepository.loadAndTouch
CartRepository.loadAndTouch.none
CartRepository.loadAndTouch.found --> CatalogApi.getSkus
CatalogApi.getSkus.result --> CartView.compose
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CartRepository.loadAndTouch` | `R-07`·`D-07` | 소유자의 장바구니와 품목을 읽는다. `last_used_at`이 하루보다 오래됐을 때만 지금으로 바꾼다 — 조회마다 쓰기가 생기지 않게 한 잠정 규칙이다. 바꿨으면 비회원 쿠키 지시가 `REFRESH`다. 없으면 `.none` |
| `.none` | `R-07` | 빈 장바구니 200으로 끝나는 분기. 쿠키가 있었는데 행이 없으면 지시 `EXPIRE`, 쿠키가 없었으면 `NONE` — 조회만으로는 장바구니도 키도 만들지 않는다 |
| `CatalogApi.getSkus(skuIds)` | `R-07`·`C-05` | 상위 `Catalog.getSkus`. 장바구니 품목 SKU 전부(100개 이하)를 한 번에 묻는다. 가격·판매 상태(`ON_SALE`·`STOPPED`)·재고 여부·상품명·옵션명·`maxQuantity`·`thumbnailUrl`·`productId`를 받는다. 판매중지 SKU도 `STOPPED`로 이름과 함께 온다 — catalog는 SKU를 지우지 않는다([catalog 상세 §2](catalog.md#2-공개-계약)). 응답에서 빠지는 것은 처음부터 없는 ID뿐이다 |
| `CartView.compose` | `R-07` | 순수 변환. 품목마다 현재 단가 × 수량, `saleStatus` — 판매중이고 재고 있음 `ON_SALE`, 재고 없음 `SOLD_OUT`, `STOPPED`·응답에 없음 `DISCONTINUED`(응답에 없으면 이름도 없어 「판매가 끝난 상품」으로 보인다). `summary`는 `ON_SALE` 품목만 더한다. 품절·판매중지 품목도 지우지 않고 보여 준다 |

- **트리거** 상위 `Browser.openCart`(§5.5). 상위 §5.3 실패 분기의 「다음 장바구니 열기 때 병합 재시도」는 화면이 `merge`를 먼저 부르는 것이고, 이 계약이 대신 병합하지 않는다 — 회원 조회는 남은 `cartKey` 쿠키를 보지 않는다.
- **완료 사실** 현재 가격·판매 상태가 붙은 품목 목록. 담은 시각의 가격이 없어 「가격이 바뀌었다」는 표시는 없다 — 바뀐 가격은 주문 때 order의 `PRICE_CHANGED`가 잡는다(`R-09`).
- 읽기 트랜잭션이다(`last_used_at` 갱신만 쓴다). catalog 조회 실패(DB 오류)는 500이다 — 가격 없는 장바구니를 보여 주지 않는다.

### JF-3 찜 — WishlistService

```jobflow
orchestrator: WishlistService
Object: WishlistService, WishlistRepository

WishlistService.addWish --> WishlistRepository.insertIfAbsent
WishlistService.removeWish --> WishlistRepository.deleteIfPresent
WishlistService.listWishes --> WishlistRepository.findPage
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `WishlistService.addWish(memberId, productId)` → `insertIfAbsent` | `R-02` | `INSERT IGNORE INTO wishlist_items (member_id, product_id, created_at)` — 유일 키 `(member_id, product_id)`가 두 번째 찜을 없는 일로 만든다 → 204. 상품이 있는지·판매중인지 catalog에 묻지 않는다(아래) |
| `WishlistService.removeWish` → `deleteIfPresent` | `R-02` | 없어도 204 |
| `WishlistService.listWishes` → `findPage` | `R-02` | `created_at` 최신순 페이지. 상품 카드는 화면이 받은 `productId`로 `GET /api/products?ids=`를 부른다 — 기획전 상품 카드와 같은 방식(상위 §5.2)이다. 판매중지 상품은 catalog 목록에서 빠지므로 화면에 안 보이고 찜 행은 남는다 |

- **트리거** 상위 `Browser.toggleWish`(§5.2), 마이페이지 찜 목록(`/mypage/wishlist` — 상위 §7). 상위의 「토글」은 화면이 현재 찜 여부를 보고 `PUT`과 `DELETE` 중 하나를 고르는 것이다. 서버 계약은 설정·해제 둘이고 둘 다 멱등이라, 빠르게 두 번 눌러도 마지막 요청의 상태로 끝난다.
- **실패 분기** 미로그인 401은 인증 미들웨어가 `/api/wishlist*`를 회원 전용으로 막아 이 서비스까지 오지 않는다. 화면은 복귀 주소를 저장하고 `LoginForm`으로 간다(상위 §5.2).
- 없는 `productId`를 찜하면 행이 생긴다 — catalog를 부르지 않아 상위 §5.2에 `Cart.toggleWish`의 하류가 없는 것과 맞다. 목록에서 보이지 않을 뿐 해는 없다(§8).

## 4. 소유 상태·데이터

표 셋. 모두 이 모듈만 쓴다. 다른 모듈 표로 가는 외래 키는 두지 않는다 — `member_id`·`sku_id`·`product_id`는 값으로만 담는다(상위 §3.1의 「다른 모듈 테이블을 직접 조인·갱신하지 않는」 규칙).

| 표 | 주요 열 | 비고 |
|---|---|---|
| `carts` | `cart_id` BIGINT PK, `member_id` BIGINT NULL, `cart_key` CHAR(22) NULL, `created_at`, `last_used_at` | `member_id` 유일, `cart_key` 유일, 둘 중 정확히 하나만 값이 있다(CHECK). 색인 `(member_id, last_used_at)` — 정리 작업이 `member_id IS NULL AND last_used_at < ?`로 찾는다. 회원 장바구니는 처음 담거나 병합할 때 만든다 |
| `cart_items` | `cart_item_id` BIGINT PK, `cart_id` FK → `carts` ON DELETE CASCADE, `sku_id` BIGINT, `quantity` SMALLINT, `added_at`, `updated_at` | `(cart_id, sku_id)` 유일, CHECK `quantity BETWEEN 1 AND 99`. 가격 열이 없다 — 조회 때 catalog의 현재 가격을 쓴다. `cart_item_id`는 order가 주문 품목에 저장하는 값이고, 병합 때 옮긴 행은 ID가 그대로다 |
| `wishlist_items` | `member_id` BIGINT, `product_id` BIGINT, `created_at` | PK `(member_id, product_id)`. 색인 `(member_id, created_at)` — 목록 최신순 |

- 쿠키 `cartKey`는 브라우저에 있고 원본은 `carts.cart_key`다. 원문 그대로 저장한다 — 키가 담는 것이 장바구니 품목뿐이고, 비회원 주문의 소유자 확인에 order가 같은 원문을 넘기기 때문이다(§8 위험).
- **상태 기계를 두지 않는 이유** 장바구니·품목·찜에 상태 열이 없다. 수명은 「있다/없다」와 `last_used_at`뿐이다 — 비회원 장바구니는 처음 담을 때 생겨 병합(`JF-2.1`)이나 30일 정리(§4.2)로 사라지고, 회원 장바구니는 탈퇴 전까지 남는다. 품목의 품절·판매중지는 cart의 상태가 아니라 조회 때 catalog에서 받아 붙이는 값이다.

### 4.1 생명주기와 보존

| 데이터 | 생기는 때 | 사라지는 때 | 보존 |
|---|---|---|---|
| 비회원 장바구니·품목 | 비회원의 첫 담기 | 병합(즉시), 30일 동안 쓰지 않음(정리 작업) | 30일 미사용(상위 §6.2) |
| 회원 장바구니·품목 | 회원의 첫 담기 또는 병합 | 품목: 삭제·주문 확정. 장바구니 행: 탈퇴 다음 날 탈퇴 정리(`purgeMembers`) | 탈퇴 전까지 |
| 찜 | `PUT /api/wishlist/{productId}` | `DELETE`, 탈퇴 다음 날 탈퇴 정리(`purgeMembers`) | 탈퇴 전까지 |
| `cartKey` 쿠키 | 비회원 장바구니가 생길 때(`ISSUE`) | 30일(`Max-Age`, 조회·담기가 하루 넘게 지나 `last_used_at`을 바꿀 때마다 다시 센다), 병합 뒤 `EXPIRE`, 장바구니가 없어진 뒤의 첫 조회 `EXPIRE` | 30일 |

「쓰지 않음」의 기준은 `last_used_at`이다. 담기·수량 변경·삭제 때는 바꾸고, 조회는 하루 넘게 지났을 때만 바꾼다(`JF-2.3`).

### 4.2 버려진 비회원 장바구니 정리

- **계약** `purgeExpired(now)`(`RetentionTask` 구현 `CartRetentionTask`) — mall-api 스케줄러의 하루 1회 보존 작업이 `RetentionTask` 구현 전부를 부를 때 불린다(상위 §4.3·§6.2). 비회원 장바구니 정리는 따로 돌던 작업이 아니라 이 보존 작업에 들어 있다. 파기 대상 계산은 이 모듈이 한다.
- **방법** `DELETE FROM carts WHERE member_id IS NULL AND last_used_at < now − 30일 ORDER BY last_used_at LIMIT 500`을 지운 행이 0이 될 때까지 반복한다. 묶음마다 짧은 트랜잭션이고, 품목은 `ON DELETE CASCADE`로 같이 지워진다.
- **경합** 대상 조건을 `DELETE` 문 안에 두고 ID 목록을 먼저 읽어 두지 않는다. 그래서 30일째 되는 날 고객이 담기를 하면 둘 중 하나만 이긴다 — 담기가 먼저 `carts` 행을 잠그고 `last_used_at`을 바꾸면 정리 조건에서 빠지고, 정리가 먼저 지우면 담기는 행을 찾지 못해 새 장바구니와 새 키를 만든다(`JF-2.2`).
- 이 계약은 회원 장바구니를 건드리지 않는다.
- **탈퇴 정리** `purgeMembers(memberIds)` — mall-api 탈퇴 정리 작업이 `Member.listWithdrawnSince`의 ID를 쪽(500개) 단위로 넘긴다(상위 §3.1·§5.17). `DELETE FROM carts WHERE member_id IN (…)`(품목은 `ON DELETE CASCADE`)와 `DELETE FROM wishlist_items WHERE member_id IN (…)`를 한 트랜잭션에서 하고 지운 행 수의 합을 돌려준다. 이미 지웠으면 0이다.

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| catalog | 서비스 `getSkus(skuIds)`(최대 100) → `SkuView{skuId, productId, categoryIds[], productName, optionName, price, saleStatus, inStock, maxQuantity, thumbnailUrl}`([catalog 상세 §2](catalog.md#2-공개-계약)) | mall-api 조립 지점이 catalog의 공개 인터페이스를 `CatalogApi`로 주입한다 | 별도 타임아웃 없음 — 같은 프로세스·같은 DB의 읽기다. DB 쿼리 타임아웃은 mall-api 공통 설정 | 담기·조회·수량 변경·병합 네 곳. cart는 `categoryIds`(쿠폰 대상 판정용)를 뺀 필드를 쓴다 — 상위 §5.5 표의 `getSkus` 출력과 같다. 한 번에 100개까지라 cart 품목 상한 100과 맞물린다 — 둘 중 하나를 바꾸면 다른 쪽도 본다 |
| mall-api | 요청 주체(인증 미들웨어), 요청 쿠키 읽기·응답 쿠키 쓰기, CSRF 검사, 트랜잭션 관리, 보존 작업 스케줄러([mall-api 상세 §2](mall-api.md#2-공개-계약)) | 라우트 등록 때 `/api/cart/merge`·`/api/wishlist*`를 회원 전용으로, 나머지 `/api/cart*`를 익명 허용으로 표시한다 | — | 익명 요청의 `POST`·`PATCH`·`DELETE`도 CSRF 토큰이 필요하다 — 익명 주체에게도 CSRF 토큰을 주는지는 mall-api 몫이다(미확인) |

들어오는 방향(참고): storefront-web이 HTTP 라우트 여덟을, order가 `CartApi.removeItems`를([order 상세 §2](order.md#2-공개-계약)), mall-api 탈퇴 정리 작업이 `CartApi.purgeMembers`를, mall-api 보존 작업이 `RetentionTask.purgeExpired`를 부른다([mall-api 상세 `JF-3`](mall-api.md#jf-3-주기-작업--mallscheduler)). cart는 order·member를 부르지 않는다.

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| SKU당 최대 수량 | `min(catalog maxQuantity, 99)` — catalog 기본 10, cart 상한 99(잠정) | `cart.max-quantity-per-sku`(상한 99) | `CartRules`, `cart_items` CHECK(99) |
| 장바구니당 최대 품목 | 100(잠정) | `cart.max-items` | `CartRules` |
| `cartKey` 쿠키 수명 | 30일 | `cart.guest-key-max-age` | `CartKeyCookie` |
| 비회원 장바구니 미사용 정리 | 30일 | `cart.guest-idle-days` | `CartRetentionTask.purgeExpired` |
| 정리 묶음 크기 | 500행 | `cart.purge-batch-size` | `CartRepository` |
| `last_used_at` 조회 갱신 간격 | 1일 | `cart.touch-interval` | `CartRepository.loadAndTouch` |
| 찜 목록 페이지 | 기본 20, 최대 100 | — | `WishlistService` |
| 행 잠금 대기 | mall-api 공통(MySQL `innodb_lock_wait_timeout` — 값은 mall-api 상세) | — | 모든 쓰기 |

- **인증** 장바구니 라우트는 익명도 쓴다 — 소유는 128비트 무작위 키의 소지로 증명한다(맞혀 볼 수 없는 크기). 키는 `HttpOnly`라 화면 스크립트(XSS)가 읽지 못한다. 병합과 찜은 회원 전용이다. 남의 `cartItemId`를 보내도 모든 쓰기·삭제가 소유자 장바구니 조건을 걸어 0행이다.
- **동시성** 쓰기는 모두 「`carts` 행 → `cart_items` 행」 순서로 잠근다. 병합만 장바구니 둘을 잠그고 언제나 「비회원 → 회원」 순서다. `removeItems`는 order의 확정 트랜잭션 안에서 이 순서를 따른다 — 고객이 같은 장바구니의 수량을 바꾸는 중이면 그 짧은 트랜잭션이 끝날 때까지 기다린다.
- **멱등** `POST /api/cart/items` 하나만 멱등이 아니다(§2). 나머지는 같은 요청을 두 번 받아도 결과가 같다.
- **최후 방어** 규칙 검사(`CartRules`)를 비껴간 경합이 있어도 DB 제약 — `carts.member_id`·`carts.cart_key` 유일, `(cart_id, sku_id)` 유일, `quantity` CHECK — 이 장바구니 둘·같은 SKU 두 행·범위 밖 수량을 막는다. 품목 100개 한도만 DB 제약이 없고 `carts` 행 잠금이 지킨다.

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 비회원 담기·쿠키 | `POST /api/cart/items`, `GET /api/cart` | 쿠키 없이 담기 → 201 + `Set-Cookie`(속성 `HttpOnly`·`Secure`·`SameSite=Lax`·`Path=/api`·30일) → 같은 쿠키로 조회. 서버가 모르는 키로 담기 → 새 키 발급, 보낸 키로는 행이 없음 | 상위 §9.1 순서 3 cart 작업 |
| 합산·한도 | `CartRules.checkAdd` | 같은 SKU 2회 → 행 1·수량 합. `maxQuantity` 10인 SKU에 9 + 2 → 409 `MAX_QUANTITY`, 수량 변경 11 → 409. 품목 100개에서 새 SKU → 409 `CART_FULL`. 거절 뒤 새 장바구니·키가 남지 않음 | 같음 |
| 판매 상태 | `addItem`·`getCart` × catalog | 가짜 `CatalogApi`로 판매중지 → 404, 재고 없음 → 409 `SOLD_OUT`. 담은 뒤 가격·상태를 바꾸면 조회에 현재 가격과 `SOLD_OUT`·`DISCONTINUED`, `summary`는 `ON_SALE`만 | 같음 |
| 병합 멱등 | `POST /api/cart/merge`, `R-23` | 같은 SKU(`maxQuantity` 10 — 회원 6 + 비회원 7 → 10, `clampedSkuIds`)와 새 SKU를 섞어 병합 → 200. 같은 요청 다시 → 204, 수량 변화 없음. 두 응답 모두 쿠키 만료. 새 SKU 행의 `cart_item_id`가 병합 전과 같음 | 같음 |
| 병합 동시 2건 | `JF-2.1` 잠금 순서 | 실제 MySQL 8(Testcontainers 잠정)에서 두 스레드가 같은 회원·같은 쿠키로 동시에 병합 → 하나 200·하나 204, 수량은 한 번만 더해짐. 같은 회원·다른 비회원 장바구니 둘을 동시에 병합 → 교착 없이 둘 다 반영 | 같음 |
| 주문 상품 삭제 | `removeItems`, 상위 §6.3 원자 구간 3 | 트랜잭션 밖 호출 → 거절. 바깥 트랜잭션을 롤백하면 품목이 남음. 남의 ID·없는 ID 섞어 호출 → 내 것만 지움, 오류 없음. 같은 호출 2회 → 두 번째 0 | 같음, 상위 §9.2 「결제 끝단」에서 다시 |
| 정리 작업 | `purgeExpired` | 시계를 옮긴 시험 DB — 31일 전 비회원 장바구니만 지워지고 회원 장바구니는 남음. 정리와 30일째 담기를 동시에 → 둘 중 하나만 이김(지워졌으면 새 키 발급) | 같음, 상위 §9.2 「보존 작업」 |
| 탈퇴 정리 | `purgeMembers` | 회원 둘의 장바구니·품목·찜을 만들고 하나만 넘김 → 그 회원 행만 사라지고 지운 수 반환, 같은 ID 다시 → 0, 없는 ID → 0·오류 없음 | 같음 |
| 찜 | `PUT`·`DELETE`·`GET /api/wishlist` | 같은 상품 `PUT` 2회 → 행 1, `DELETE` 2회 → 204 둘. 미로그인 401 | 같음 |
| 로그인 복귀 끝단 | 상위 §5.3·§5.5, `R-23` | 비회원 담기 → 선택 상품 주문 → 로그인 → 주문서 복귀 + 병합 → 주문·결제 → 장바구니에서 주문 품목이 사라짐 | 상위 §9.2 「로그인 복귀 끝단」 |
| 모듈 경계 | `D-01`, `C-21` | 경계 검사 시험 — cart가 catalog의 공개 인터페이스 밖을 참조하지 않고, 다른 모듈이 `carts`·`cart_items`·`wishlist_items`를 직접 읽거나 쓰지 않음 | 매 빌드 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `R-23`·`C-08` | 위험 | 병합 때 같은 SKU는 회원 행만 남고 비회원 행은 지워진다. 화면이 병합 전에 들고 있던 비회원 `cartItemId`로 주문하면 `removeItems`가 그 ID를 찾지 못해, 주문한 품목이 회원 장바구니에 남는다 | `JF-2.1`·`JF-1` | 새 SKU는 행을 옮겨 ID가 남으므로 같은 SKU 겹침에서만 생긴다. 대응: storefront-web이 로그인 복귀 뒤 주문서에 들어가기 전에 `GET /api/cart`를 다시 읽어 `cartItemId`를 새로 받는다(storefront-web 상세에 요청) |
| `D-07`·`C-08` | 위험 | 비회원이 주문을 만든 뒤 결제 확정 전에 같은 브라우저로 로그인하면 병합이 비회원 장바구니를 지운다. 확정 때 `removeItems(guest(cartKey), …)`는 장바구니를 찾지 못해 0이고 품목은 회원 장바구니에 남는다 | `JF-1`·`JF-2.1` | 드문 경로다(비회원 결제창에서 로그인하지 않는다). 남은 품목은 고객이 지울 수 있다 — 잠정 수용 |
| `D-07` | 위험 | order가 비회원 주문에 `cartKey` 원문을 결제 확정까지(가상계좌는 입금기한 72시간까지) 저장한다. DB를 읽을 수 있는 사람은 그 비회원 장바구니를 열 수 있다 | §2 「비회원 주문의 소유자」 | 장바구니에는 개인정보가 없어 영향이 작다. 대응: order가 확정·만료·취소 뒤 그 열을 지운다(order 상세에 요청) |
| `D-07` | 위험 | 공용 PC에서 비회원 쿠키가 남으면 다음 사람이 그 장바구니를 보고, 로그인하면 남의 품목이 자기 장바구니에 병합된다 | §2 `cartKey` 쿠키 | 국내몰의 비회원 장바구니가 대개 같은 성질이다. 쿠키는 병합 뒤 만료되므로 한 번만 생긴다 — 잠정 수용 |
| `C-08` | 미확정 | 운영자가 SKU 한도(`maxQuantity`)를 낮추면 이미 담긴 수량은 한도를 넘은 채 남는다 | §2 「SKU 최대 수량」 | 조회가 `maxQuantity`를 알려 화면이 고치게 하고, 주문 때 order가 막는다(가정 — order 상세). cart가 조회 때 자동으로 줄이지 않는 것은 읽기에서 쓰기를 만들지 않으려는 선택이다 |
| `R-07` | 미확정 | 품목 100개·cart 수량 상한 99는 잠정값이다 | §6 | 설정 키로 바꾼다. 줄이면 이미 넘은 장바구니는 그대로 두고 새 담기만 막는다 |
| `R-23` | 미확정 | 병합 뒤 품목이 100개를 넘을 때 비회원 품목을 최신순으로 남기고 나머지를 버린다 | `JF-2.1` | 버린 수를 `droppedItemCount`로 알린다. 화면이 「일부 상품을 담지 못했다」를 보일지는 storefront-web 몫이다 |
| `C-08`·`R-26` | 위험 | 탈퇴 회원의 장바구니·찜은 탈퇴 즉시가 아니라 다음 날 정리 작업 때 지워진다. member는 cart를 부르지 않는다(상위 §3) | §4.1 | mall-api 탈퇴 정리 작업이 `Member.listWithdrawnSince`로 받은 ID를 `purgeMembers`에 넘긴다(상위 §6.2). 그 사이 행은 회원 ID만 담고 연락처가 없어 개인정보 영향이 작다 |
| `R-02` | 미확정 | 찜 개수 상한이 없고, 없는 상품도 찜할 수 있다 | `JF-3` | 해는 행이 느는 것뿐이다. 남용이 보이면 상한(예: 500)과 409를 더한다 |
| `R-23` | 미확정 | 병합 200 응답을 가격이 붙은 장바구니가 아니라 요약으로 둔다(상위 §5.3과 같다) | §2 | 가격을 붙이려면 병합이 catalog를 불러야 한다. 화면이 장바구니를 보여 줄 때 `GET /api/cart`를 따로 부른다 |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 계약·수치·SQL은 설계값이고 실행한 것이 없다. 잠금 동작(다중 표 `DELETE`의 공유 잠금 등)은 MySQL 8 InnoDB 기본 격리 수준(REPEATABLE READ)을 가정했고 시험하지 않았다.
2. catalog `getSkus`의 출력 필드는 catalog 상세 §2와, `removeItems`의 호출 자리(확정·가상계좌 발급)·입력(`lines[].cartItemId`·쿠키 `cartKey`)·소유자 저장 열은 order 상세 §2·§4·`JF-4.1`·`JF-5`와, `purgeMembers`·`purgeExpired`의 호출자는 mall-api 상세 `JF-3`와 계약 이름으로만 대조했다. storefront-web 상세와는 대조하지 않았다.
3. 익명 요청의 CSRF 토큰 발급, 회원 전용 라우트 표시 방식, 행 잠금 대기 값은 mall-api 상세가 정한다 — 이 문서에서 확인하지 않았다.
