# catalog (모듈) — TO-BE 상세

> **대상**: catalog 모듈 전체 — 상품·옵션·SKU·카테고리·이미지 메타·검색(`C-05`), 재고와 가예약(`C-06`). 결정 `D-03`(재고 차감 시점)·`D-08`(상품 검색)의 경계 안 구현이다 · **기준**: 설계 기준 DATE 2026-10-19·커밋 `6ace327`
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·테이블·설정이 새 제안이다 — 그래서 `(제안)` 표시를 생략한다. 외부 서비스의 동작은 「가정」, 확인하지 못한 것은 「미확인」으로 적는다. 그림 근거 열은 `R`·`C`·`D` ID다. 심볼 이름은 상위 §9.5의 잠정 스택(Java 21·Spring Boot 3·MySQL 8)을 따른다

## 1. 책임 / 비책임

- **책임**: 상품과 그 옵션·SKU(옵션 축 최대 3, SKU마다 가격·재고·판매 상태), 카테고리 트리(깊이 최대 3), 상품 이미지의 메타와 업로드 URL 서명, 판매중 상품의 목록·상세·전문 검색(`D-08`)을 맡는다(`C-05`). 그리고 SKU 재고의 유일한 쓰기 주체다 — 가예약·확정·연장·해제·반품 재입고·운영 조정을 참조 키(`order:<orderId>`·`claim:<claimId>`)로 멱등하게 처리하고, 어떤 동시 요청에서도 판매 가능 수량이 0 밑으로 내려가지 않게 한다(`C-06`·`D-03`).
- **비책임**: 가예약을 언제 풀지의 판단과 타이머(order의 만료 타이머가 `releaseStock`을 부른다 — [상위 §5.9](../system-design-to-be.md#59-가상계좌-발급과-입금-통보입금기한-만료)), 트랜잭션의 시작과 커밋(조율자 order·claim과 mall-api — [상위 §6.3](../system-design-to-be.md#63-트랜잭션-경계)), 화면 금액과 서버 금액의 대조·`PRICE_CHANGED`(order), 할인과 기획전 편성(promotion — catalog는 받은 상품 ID로 카드만 낸다), 장바구니 수량 상한 적용(cart — catalog는 `maxQuantity`만 알려 준다), 반품 검수 판정과 `DAMAGED` 품목 제외(claim이 빼고 부른다), 이미지 바이트의 저장과 전송(브라우저가 객체 저장소에 직접 `PUT`), 운영자 인증(member와 인증 미들웨어).
- **아무도 하지 않는 것**: 업로드했지만 상품에 저장하지 않은 이미지 객체 정리(§8), order 만료 타이머가 멈췄을 때 남는 `HELD` 가예약의 자동 정리(§8 — 경보만 둔다), 품절 임박·재입고 알림, 검색어 자동완성·오타 교정·동의어, 창고 실물 재고와의 대조.

## 2. 공개 계약

공개 계약 20개 — HTTP 라우트 14개(고객 4·운영 10)와 다른 경계가 부르는 서비스 메서드 6개다. 다른 모듈이 주입받는 다섯(`getSkus`·재고 넷)은 모듈 공개 패키지의 인터페이스 `CatalogApi` 한 곳에 선언하고, 보존 파기 `purgeExpired`는 mall-api 공용 인터페이스 `RetentionTask`(`com.openmall.common.retention`)를 catalog가 구현한 빈 `CatalogRetentionTask`다. 오류 응답은 조립 지점의 한 형식 `{code, message, details}`이고, 입력 검증 실패는 422 `VALIDATION_FAILED`(`details.fields[{field, reason}]`)다. 운영 라우트의 403은 인증 미들웨어가 낸다(표에서 생략).

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `GET /api/categories` | 없음 | 200 `[{categoryId, name, depth, children[]}]` — 노출(`visible`) 카테고리만, 정렬 순서대로 | — | `ProductController.listCategories` → `ProductQueryService.listCategories` |
| `GET /api/products` | `categoryId`·`sort`(`recommended`·`newest`·`priceAsc`·`priceDesc`, 기본 `recommended`)·`page`·`size`(기본 20, 최대 60) 또는 `ids`(최대 100) | 200 `{items[{productId, name, brand, thumbnailUrl, price, listPrice?, soldOut}], page, totalCount}` — 판매중 상품만. `categoryId`는 하위 카테고리를 포함한다. `ids`는 준 순서로 내고, 판매중이 아닌 ID는 뺀다 | 404 `CATEGORY_NOT_FOUND`, 422 `VALIDATION_FAILED`(`categoryId`와 `ids`를 함께 줌, 상한 초과, 알 수 없는 `sort`) | `ProductController.listProducts` → `ProductQueryService.listProducts` |
| `GET /api/products/search` | `q`(앞뒤 공백을 뺀 2~50자)·`sort`·`page`·`size` | 200 목록과 같은 꼴. 결과가 없으면 빈 `items` | 422 `QUERY_TOO_SHORT`(2글자 이상인 낱말이 없음)·`QUERY_TOO_LONG` | `ProductController.search` → `ProductQueryService.search` → `ProductSearchService.search` |
| `GET /api/products/{productId}` | path | 200 `{productId, name, brand, categoryPath[], description, images[{url}], optionAxes[{name, values[]}], skus[{skuId, options[], price, listPrice?, inStock, maxQuantity}]}` — 판매중지 SKU는 빼고, 품절 SKU는 `inStock:false`로 낸다 | 404 `PRODUCT_NOT_FOUND`(없음·`DRAFT`·`STOPPED`) | `ProductController.getProduct` → `ProductQueryService.getProduct` |
| `GET /api/admin/products` | `q`(상품명·브랜드 부분 일치)·`categoryId`(하위 포함)·`status`(`DRAFT`·`ON_SALE`·`STOPPED` — `products.status` 값 그대로, 생략하면 전부)·`stock`(`OUT` 판매중 SKU의 `available` 합이 0·`IN` 그 밖 — 품절은 상품 상태가 아니라 이 재고 필터다, 생략하면 전부)·`page`·`size`(기본 20, 최대 100) | 200 `{items[{productId, name, brand, categoryId, status, thumbnailUrl, skuCount, availableTotal, soldOut, updatedAt}], page, totalCount}` — 모든 상태, 최근 수정순 | 422 `VALIDATION_FAILED`(알 수 없는 `status`·`stock` 값) | `AdminCatalogController.listProducts` → `AdminProductQueryService.list` |
| `GET /api/admin/products/{productId}` | path | 200 운영 상세 — SKU마다 `available`·`reserved`·`saleStatus`, `version` | 404 | `AdminCatalogController.getProduct` → `AdminProductQueryService.get` |
| `POST /api/admin/products` | `{name, brand, categoryId, description, optionAxes[≤3]{name, values[]}, skus[{options[], price, listPrice?, initialStock, maxQuantity?, saleStatus}], imageKeys[], status, searchTags[]}` | 201 `{productId, skuIds[]}` | 422 `VALIDATION_FAILED {fields[{field, reason}]}`·`OPTION_MISMATCH`(SKU 옵션이 축과 안 맞음·조합 중복)·`CATEGORY_NOT_LEAF`·`INVALID_IMAGE_KEY` | `AdminCatalogController.saveProduct` → `ProductCommandService.saveProduct` |
| `PATCH /api/admin/products/{productId}` | 위 필드의 일부 + `version`. 기존 SKU는 `skuId`로 가격·`listPrice`·`maxQuantity`·`saleStatus`만 바꾼다. 새 SKU는 `skuId` 없이 `initialStock`과 함께 준다 | 200 `{productId, skuIds[]}` | 404, 409 `VERSION_CONFLICT`, 422 위와 같음 + `OPTION_IMMUTABLE`(기존 SKU 옵션 변경)·`STOCK_FIELD_NOT_ALLOWED`(기존 SKU에 재고 값) | 같음 |
| `PATCH /api/admin/skus/{skuId}/stock` | `{delta(0이 아닌 정수), reason(1~200자)}` | 200 `{skuId, available, reserved}` | 404, 409 `BELOW_RESERVED {available, reserved}`(조정 뒤 남는 재고가 가예약보다 적다), 422 `VALIDATION_FAILED`(`delta` 0, `reason` 길이) | `AdminCatalogController.adjustStock` → `StockService.adjustStock` |
| `GET /api/admin/categories` | 없음 | 200 전체 트리 — 숨김 포함, 카테고리별 상품 수 | — | `AdminCatalogController.listCategories` → `CategoryCommandService.tree` |
| `POST /api/admin/categories` | `{name, parentId?, sortOrder, visible}` | 201 `{categoryId}` | 404 부모 없음, 422 `DEPTH_EXCEEDED`·`VALIDATION_FAILED` | `AdminCatalogController.saveCategory` → `CategoryCommandService.save` |
| `PATCH /api/admin/categories/{categoryId}` | `{name?, parentId?, sortOrder?, visible?}` | 200 | 404, 422 `DEPTH_EXCEEDED`·`CYCLE`(자기 하위로 옮김) | 같음 |
| `DELETE /api/admin/categories/{categoryId}` | path | 204 | 404, 409 `CATEGORY_IN_USE`(하위 카테고리나 상품이 있음) | `AdminCatalogController.deleteCategory` → `CategoryCommandService.delete` |
| `POST /api/admin/uploads/product-images` | `{contentType('image/jpeg'·'image/png'·'image/webp'), size(바이트)}` | 201 `{objectKey, uploadUrl, headers, expiresAt}` — 10분 동안 쓰는 서명 `PUT` 주소. 상품 이미지와 기획전 배너가 함께 쓰는 운영 이미지 업로드다 — promotion은 받은 `objectKey`를 `bannerImageKey`로 저장할 뿐 서명하지 않는다(상위 §5.15) | 422 `UNSUPPORTED_TYPE`·`TOO_LARGE`(10MB 초과) | `AdminCatalogController.issueUploadUrl` → `ImageUploadService.issue` |
| 서비스 `getSkus(skuIds)` | SKU ID 목록(최대 100, 중복은 하나로) | `List<SkuView{skuId, productId, categoryIds[], productName, optionName, price, saleStatus('ON_SALE'·'STOPPED'), inStock, maxQuantity, thumbnailUrl}>` — `categoryIds`는 상품의 말단 카테고리와 그 조상 전부(말단부터 루트까지 — 쿠폰 대상 판정용), `thumbnailUrl`은 대표 이미지 공개 주소(없으면 `null`). 없는 ID는 목록에서 빠진다. 상품이 판매중이 아니면 `saleStatus:'STOPPED'` | 없음 — 읽기 전용, 잠금 없음 | `CatalogApi.getSkus` → `ProductQueryService.getSkus` |
| 서비스 `reserveStock(ref, lines, holdUntil)` | `ref`(`order:<orderId>`·`claim:<claimId>`), `lines[{skuId, qty≥1}]`(최대 50줄, 같은 SKU는 합친다), `holdUntil` | `reserved` 또는 `outOfStock{skuIds[]}` — `outOfStock`이면 아무것도 쓰지 않는다. 같은 `ref`·같은 줄로 다시 부르면 다시 `reserved`(멱등) | `ReservationConflictException`(같은 `ref`에 다른 줄), 트랜잭션 없이 호출 → `IllegalTransactionStateException` | `CatalogApi.reserveStock` → `StockService.reserveStock` |
| 서비스 `commitReservation(ref)` | `ref` | `committed`(처음 확정이거나 이미 확정) 또는 `notHeld`(가예약이 해제됐거나 없다 — 아무것도 바꾸지 않는다) | 트랜잭션 없이 호출 → 위와 같음 | `CatalogApi.commitReservation` → `StockService.commitReservation` |
| 서비스 `extendReservation(ref, holdUntil)` | `ref`, 새 `holdUntil` | `extended`(지금 값보다 늦으면 바꾸고, 아니면 그대로) 또는 `notHeld` | 같음 | `CatalogApi.extendReservation` → `StockService.extendReservation` |
| 서비스 `releaseStock(ref, lines?)` | `ref`, `lines[{skuId, qty}]`(선택 — 반품 부분 재입고) | `released{restocked[{skuId, qty}]}` — 이미 끝났거나 행이 없으면 `restocked:[]` | `InvalidReleaseException`(`lines`가 확정되지 않은 행을 가리키거나 남은 수량을 넘음 — 호출자 버그), 트랜잭션 없이 호출 → 위와 같음 | `CatalogApi.releaseStock` → `StockService.releaseStock` |
| 서비스 `purgeExpired(now)` | 기준 시각 | `PurgeResult{task:'catalog', deleted}` — 지운 가예약 행 수 | DB 오류는 그대로 던진다 — 보존 작업이 기록하고 다음 모듈로 넘어가며, 다음 날 다시 부른다 | `RetentionTask.purgeExpired` → `CatalogRetentionTask.purgeExpired` → `ReservationRetention.purge` |

- **호출자 트랜잭션 전제**: 재고 계약 넷(`reserveStock`·`commitReservation`·`extendReservation`·`releaseStock`)은 조율자가 연 트랜잭션 안에서만 돈다. 구현은 `@Transactional(propagation = MANDATORY)`로 트랜잭션이 없으면 바로 실패한다. 그래서 주문·쿠폰·재고가 한 커밋으로 함께 바뀌고, 호출자가 롤백하면 catalog의 쓰기도 함께 사라진다(`D-01`·`C-06`).
- **`releaseStock`의 두 모양**: `lines`를 **생략**하면 그 참조 키 전체다 — 가예약(`HELD`)이면 해제하고, 확정(`COMMITTED`)이면 남은 수량을 재입고한다. `lines`를 주면 확정 행의 일부 수량만 재입고한다(반품). **빈 목록**은 아무것도 하지 않는다 — 검수가 전부 `DAMAGED`인 반품이 이렇게 부른다. 생략과 빈 목록의 차이가 계약의 일부다(§8).
- **결과 값과 예외**: 업무상 정상인 갈래(`outOfStock`·`notHeld`·이미 끝남)는 값으로 돌려주고, 호출자의 버그(같은 키에 다른 줄, 넘는 재입고, 트랜잭션 없음)만 예외로 던진다. 예외는 호출자 트랜잭션을 롤백시킨다.
- **`purgeExpired`**: mall-api의 하루 1회 보존 작업이 `RetentionTask` 구현 전부를 차례로 부를 때 불린다([상위 §6.2](../system-design-to-be.md#62-권위-소유자와-생명주기)). 끝난 가예약(`RELEASED`·`RETURNED`)은 끝난 지 30일, `COMMITTED` 행은 확정 1년 뒤를 지운다(잠정 — §8).
- **호환성**: 신규라 소비자가 cart(`getSkus`), order(`getSkus`·재고 넷), claim(`getSkus` — 교환 신청 때 새 SKU 확인, `reserveStock`·`commitReservation`·`releaseStock`), promotion에 넘길 `quote` 입력을 만드는 order(`getSkus`의 `productId`·`categoryIds`), mall-api(`purgeExpired`)뿐이다. 응답에는 필드만 더하고 기존 필드의 뜻은 바꾸지 않는다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 모듈 전체의 단일 조율자는 없다. 재고 계약은 `StockService`, 조회와 `getSkus`는 `ProductQueryService`, 운영 라우트는 `AdminCatalogController`가 각자 조율한다. 바깥으로 나가는 객체는 객체 저장소 쪽 게이트웨이 `StorageGateway` 하나이고, 그마저 네트워크 호출 없이 서명만 계산한다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Catalog.stockLifecycle`(§5.1) 가운데 `Catalog.reserveStock`(§5.6, §5.12 교환) | [`JF-1` 가예약](#jf-1-가예약--stockservicereservestock) | — |
| `Catalog.stockLifecycle`(§5.1) 가운데 `Catalog.commitReservation`(§5.7·§5.8·§5.9, §5.12 교환)·`Catalog.extendReservation`(§5.9) | [`JF-2` 확정·연장](#jf-2-확정연장--stockservicecommitreservation) | — |
| `Catalog.stockLifecycle`(§5.1) 가운데 `Catalog.releaseStock`(§5.7·§5.8·§5.9·§5.10·§5.12) | [`JF-3` 해제·재입고](#jf-3-해제재입고--stockservicereleasestock) | — |
| `Catalog.getSkus`(§5.1·§5.5·§5.6)·`Catalog.browse`(§5.1) — `Catalog.listProducts`·`Catalog.search`·`Catalog.getProduct`(§5.2), `GET /api/categories` | [`JF-4` 조회](#jf-4-조회--productqueryservice) | `search` → [`JF-4.1` 검색](#jf-41-검색--productsearchservicesearch) |
| `Catalog.adminCatalog`(§5.1) — `Catalog.issueUploadUrl`·`Catalog.saveProduct`·`Catalog.adjustStock`(§5.15), 카테고리 편집 | [`JF-5` 운영 라우트](#jf-5-운영-라우트--admincatalogcontroller) | `saveProduct` → [`JF-5.1` 상품 저장](#jf-51-상품-저장--productcommandservicesaveproduct), `adjustStock` → [`JF-5.2` 재고 조정](#jf-52-재고-조정--stockserviceadjuststock) |
| `Catalog.purgeExpired`(§5.17 — mall-api 보존 작업의 `RetentionTask.purgeExpired`) | 그림 없음 — `CatalogRetentionTask.purgeExpired` → `ReservationRetention.purge`는 조건 삭제 한 문장이라 §2 표와 §4로 대신한다 | — |

상위의 바깥 노드 `Storage.putObject`는 브라우저가 서명 URL로 직접 부르는 객체 저장소다. 이 경계의 대응은 서명을 만드는 `StorageGateway.presignPut`뿐이다(`JF-5`).

**표기** 노드는 제안 클래스·메서드다. 이름이 `…Repository`인 객체는 catalog 테이블만 읽고 쓰는 저장소다. 값 분기(`ReservationRepository.findByRef.none`)는 그 저장소가 돌려준 값을 조율자가 판정한 갈래이고, 거기서 나가는 화살표는 조율자가 그 갈래에서 다음으로 부르는 호출이다([상위 §5.0](../system-design-to-be.md#50-표기)의 요청자 값 분기와 같은 꼴). 여덟 그림 모두 `design-doc-check`의 렌더러로 SVG를 만들고 PNG로 확인했다. 열지 않은 것: 저장소 메서드 안의 SQL(§4와 각 그림 표에 핵심 조건만), `SearchQueryParser`·`OptionMatrix`의 규칙(순수 함수 — 표에 규칙을 적었다).

### JF-1 가예약 — StockService.reserveStock

```jobflow
orchestrator: StockService
Object: StockService, ReservationRepository, SkuRepository
StockService.reserveStock --> ReservationRepository.findByRef
ReservationRepository.findByRef.same
ReservationRepository.findByRef.conflict
ReservationRepository.findByRef.none --> SkuRepository.lockForUpdate
SkuRepository.lockForUpdate.short
SkuRepository.lockForUpdate.enough --> SkuRepository.decreaseAvailable
SkuRepository.decreaseAvailable.missed
SkuRepository.decreaseAvailable.allUpdated --> ReservationRepository.insertHeld
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `StockService.reserveStock` | `C-06`·`D-03` | 상위 `Catalog.reserveStock`. 먼저 줄을 정리한다 — 같은 SKU는 수량을 합치고, `qty < 1`이면 `IllegalArgumentException`, SKU ID 오름차순으로 정렬한다(교착 방지 — §6.1) |
| `ReservationRepository.findByRef` | `C-06` | `stock_reservations`에서 `ref` 행을 읽는다. `.none` 처음 호출, `.same` 같은 줄의 행이 이미 있다, `.conflict` 다른 줄의 행이 있다 |
| `.same` | `C-06` | 단독 줄 — 쓰기 없이 `reserved`를 돌려준다(멱등). 행 상태가 `HELD`가 아니어도(이미 확정·해제) 다시 가예약하지 않는다 — 같은 키의 두 번째 호출은 첫 결과를 다시 확인할 뿐이다 |
| `.conflict` | `C-06` | 단독 줄 — `ReservationConflictException`. 호출자가 같은 주문 ID를 다시 쓴 버그다. 호출자 트랜잭션이 롤백된다 |
| `SkuRepository.lockForUpdate` | `C-06`·`R-09` | `SELECT … FROM skus WHERE id IN (…) ORDER BY id FOR UPDATE` — 정렬한 순서로 행을 잠그고 `available`·`sale_status`·상품 상태를 읽는다. 잠금은 호출자 트랜잭션이 끝날 때 풀린다 |
| `.short` | `C-06`·`R-09` | 단독 줄 — 한 SKU라도 `available < qty`이거나 판매중이 아니면 쓰기 없이 `outOfStock{skuIds}`를 돌려준다. 모자란 SKU를 모두 담는다. 아무것도 쓰지 않았으므로 「전부 아니면 전무」가 롤백 없이도 지켜진다. 상위 §5.6의 `Order.placeOrder.rejected`(409 `OUT_OF_STOCK`)가 이 값이다 |
| `.enough` → `SkuRepository.decreaseAvailable` | `C-06`·`D-03` | SKU마다 `UPDATE skus SET available = available - :q, reserved = reserved + :q WHERE id = :id AND available >= :q`. 잠금 뒤라 늘 성공해야 하지만 조건을 남겨 둔 두 번째 방어다 |
| `.missed` | `C-06` | 단독 줄 — 갱신된 행 수가 줄 수보다 적다. 잠금이 깨진 경우뿐이라 `IllegalStateException`으로 호출자 트랜잭션을 롤백한다 |
| `.allUpdated` → `ReservationRepository.insertHeld` | `C-06`·`R-20` | SKU마다 `stock_reservations` 행 하나 — `status='HELD'`, `qty`, `hold_until`. 유일 제약 `(ref, sku_id)`가 같은 키의 동시 두 호출 가운데 하나를 실패시킨다. 그 뒤 `reserved` |

- **트리거** order의 주문 생성(상위 §5.6, `holdUntil` = 지금 + 30분)과 claim의 교환 완료(상위 §5.12 그림 밖 행, `ref = 'claim:<claimId>'`, 바로 이어서 `commitReservation`). **완료 사실** SKU마다 `available` 감소·`reserved` 증가 + `HELD` 행.
- **줄 순서** 호출마다 끝나는 갈래(단독 줄)를 먼저, 이어지는 갈래를 뒤에 써서 끝나는 칸이 그 호출 바로 아래에 붙게 했다. 실제 판정 순서도 같다 — `findByRef`(같음·충돌·없음) → 잠금(모자람·충분) → 감소 → 행 기록.
- `holdUntil`은 기록일 뿐 catalog가 읽어 스스로 해제하지 않는다. 만료는 order 타이머가 판단해 `releaseStock`을 부른다(상위 §5.9).

### JF-2 확정·연장 — StockService.commitReservation

```jobflow
orchestrator: StockService
Object: StockService, ReservationRepository, SkuRepository
StockService.commitReservation --> ReservationRepository.lockByRef
ReservationRepository.lockByRef.committed
ReservationRepository.lockByRef.notHeld
ReservationRepository.lockByRef.held --> SkuRepository.settleReserved
SkuRepository.settleReserved.done --> ReservationRepository.markCommitted
StockService.extendReservation --> ReservationRepository.extendHold
ReservationRepository.extendHold.notHeld
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `StockService.commitReservation` | `C-06`·`D-03` | 상위 `Catalog.commitReservation`. 결제 확정(§5.7 `.paid`·§5.8 `.paid`)·입금 확정(§5.9 `.deposited`)·교환 완료(§5.12)가 부른다 |
| `ReservationRepository.lockByRef` | `C-06` | `SELECT … FROM stock_reservations WHERE ref = :ref ORDER BY sku_id FOR UPDATE`. 한 키의 행들은 늘 같은 상태로 함께 바뀐다(확정·해제가 키 단위) — 그래서 상태 하나로 가른다 |
| `.held` → `SkuRepository.settleReserved` | `C-06` | SKU ID 순으로 `UPDATE skus SET reserved = reserved - :q WHERE id = :id AND reserved >= :q`. `available`은 가예약 때 이미 줄었으므로 그대로다 — 팔린 수량이 재고 열에서 빠진다. 갱신 수가 모자라면 불변조건 위반이라 `IllegalStateException` |
| `.done` → `ReservationRepository.markCommitted` | `C-06` | 행을 `COMMITTED`로, `committed_at` 기록. 그 뒤 `committed` |
| `.committed` | `C-06` | 단독 줄 — 이미 확정. 쓰기 없이 `committed`(멱등). 상위 §5.8의 대사와 §5.7이 같은 주문을 두 번 확정하려 해도 여기서 끝난다 |
| `.notHeld` | `C-06`·`R-20` | 단독 줄 — 행이 `RELEASED`이거나 없다. 쓰기 없이 `notHeld`. `holdUntil`이 지났어도 `HELD`면 확정한다 — 만료 판단은 order 몫이다 |
| `StockService.extendReservation` → `ReservationRepository.extendHold` | `C-06`·`R-19` | 상위 `Catalog.extendReservation`(§5.9 가상계좌 발급). `UPDATE stock_reservations SET hold_until = GREATEST(hold_until, :until) WHERE ref = :ref AND status = 'HELD'`. 바뀐 행이 있으면 `extended` |
| `.notHeld`(연장) | `C-06` | 단독 줄 — `HELD` 행이 없다. 쓰기 없이 `notHeld`. order는 이 값을 받으면 가상계좌 발급 트랜잭션을 롤백해야 한다(만료와 겹친 경우) |

- **트리거** 확정은 order의 결제·입금 확정 트랜잭션과 claim의 교환 완료, 연장은 order의 가상계좌 발급 트랜잭션이다. **완료 사실** 확정: `reserved` 감소 + 행 `COMMITTED`. 연장: `hold_until`이 입금기한까지 늘어난다.
- **만료 경합** order 만료 타이머가 먼저 `releaseStock`을 부른 주문에 대사(상위 §5.8)가 `commitReservation`을 부르면 `.notHeld`다. catalog는 다시 가예약하지 않고 값만 돌려준다 — 상위 §5.8의 「확정 대신 `Payment.cancel`로 환불」은 이 값에 기댄다.
- 두 진입점은 서로 모르는 계약이라 한 그림에 두되 이어지지 않는다. `notHeld` 칸 둘은 다른 호출의 값이다.

### JF-3 해제·재입고 — StockService.releaseStock

```jobflow
orchestrator: StockService
Object: StockService, ReservationRepository, SkuRepository
StockService.releaseStock --> ReservationRepository.lockByRef
ReservationRepository.lockByRef.ended
ReservationRepository.lockByRef.held --> SkuRepository.releaseHeld
SkuRepository.releaseHeld.done --> ReservationRepository.markReleased
ReservationRepository.lockByRef.committed --> SkuRepository.restock
SkuRepository.restock.done --> ReservationRepository.markRestocked
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `StockService.releaseStock` | `C-06`·`D-03` | 상위 `Catalog.releaseStock`. `lines`가 빈 목록이면 저장소를 부르지 않고 `restocked:[]`로 끝난다(그리지 않음) |
| `ReservationRepository.lockByRef` | `C-06` | `JF-2`와 같은 잠금 읽기. 반품이 일부 끝난 키는 `COMMITTED`와 `RETURNED` 행이 섞일 수 있다 — `lines`가 있으면 그 줄의 행만 본다 |
| `.held` → `SkuRepository.releaseHeld` | `C-06`·`R-20` | `lines` 생략일 때만. SKU ID 순으로 `available = available + q, reserved = reserved - q`(조건 `reserved >= q`). 결제 거절(§5.7)·대사 미승인(§5.8)·만료(§5.9)·결제 전 취소(§5.10)가 이 갈래다. `lines`를 주면 `InvalidReleaseException` |
| `.done` → `ReservationRepository.markReleased` | `C-06` | 행을 `RELEASED`로, `ended_at` 기록 |
| `.committed` → `SkuRepository.restock` | `C-06`·`R-13`·`R-14` | `lines` 생략이면 행마다 `qty - returned_qty`, `lines`가 있으면 그 수량만큼 `available`을 늘린다. 출고 전 취소(§5.10)와 반품 완료(§5.12)가 이 갈래다. `lines`의 수량이 남은 수량(`qty - returned_qty`)을 넘거나 그 SKU 행이 없으면 `InvalidReleaseException` |
| `.done` → `ReservationRepository.markRestocked` | `C-06`·`R-14` | `returned_qty`를 더한다. 남은 수량이 0이 된 행은 상태를 바꾼다 — `lines` 생략(취소)이면 `RELEASED`, `lines` 있음(반품)이면 `RETURNED`. 일부만 반품한 행은 `COMMITTED`로 남는다 |
| `.ended` | `C-06` | 단독 줄 — 행이 없거나 모두 `RELEASED`·`RETURNED`다. 쓰기 없이 `restocked:[]`(멱등). 같은 주문의 거절과 만료가 겹쳐 두 번 불려도 재고는 한 번만 돌아온다 |

- **트리거** order의 결제 실패·만료·취소 트랜잭션과 claim의 반품 완료 트랜잭션. **완료 사실** 가예약 해제(`available`·`reserved` 복원) 또는 재입고(`available` 증가) + 행 상태 변경.
- **같은 이름의 두 동작** 이 계약은 행 상태로 해제와 재입고를 가른다. 만료·거절 경로가 이미 확정된 주문에 부르면 재입고가 일어난다 — 그것을 막는 것은 같은 트랜잭션 안 order의 조건부 상태 전이다(§8).
- **반품의 멱등** `lines`가 있는 호출은 키로 멱등이 아니다 — 같은 반품을 두 번 부르면 두 번 재입고한다(남은 수량을 넘으면 예외). 두 번째 호출을 막는 것은 같은 트랜잭션의 클레임 상태 전이와 `markLineClaim` 조건부 갱신이다(상위 §6.3의 원자 구간 6). 검수 `DAMAGED` 품목은 claim이 `lines`에서 빼고 부른다.

### JF-4 조회 — ProductQueryService

```jobflow
orchestrator: ProductQueryService
Object: ProductQueryService, CategoryRepository, ProductRepository, SkuRepository, ProductSearchService
ProductQueryService.listCategories --> CategoryRepository.findVisibleTree
ProductQueryService.listProducts --> CategoryRepository.findSubtreeIds
ProductQueryService.listProducts --> ProductRepository.findCards
ProductQueryService.getProduct --> ProductRepository.findOnSale
ProductRepository.findOnSale.found --> SkuRepository.findOnSaleByProduct
ProductRepository.findOnSale.missing
ProductQueryService.search --> ProductSearchService.search
ProductQueryService.getSkus --> SkuRepository.findViewsByIds
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `listCategories` → `CategoryRepository.findVisibleTree` | `C-05`·`R-01` | `GET /api/categories`. `visible` 카테고리를 한 번에 읽어 `parent_id`로 트리를 만든다. 숨긴 카테고리의 하위도 숨는다 |
| `listProducts` → `CategoryRepository.findSubtreeIds` | `C-05`·`R-01` | 상위 `Catalog.listProducts`. `categoryId`가 있을 때만 — `path LIKE '<경로>%'`로 하위 카테고리 ID를 모은다. 없는 카테고리면 404 `CATEGORY_NOT_FOUND` |
| `listProducts` → `ProductRepository.findCards` | `C-05`·`R-01` | `status = 'ON_SALE'`만. 정렬 — `recommended`는 `rank_score` 내림차순, `newest`는 `published_at`, 가격은 `min_price`. `soldOut`은 판매중 SKU의 `available` 합이 0인지다. `ids`면 `IN (…)` 뒤 준 순서로 다시 늘어놓는다(상위 §5.2의 기획전 상품 카드) |
| `getProduct` → `ProductRepository.findOnSale` | `C-05`·`R-01` | 상위 `Catalog.getProduct`. 상품·이미지·카테고리 경로를 함께 읽는다. `.missing`은 단독 줄 — 없음·`DRAFT`·`STOPPED` 모두 404 `PRODUCT_NOT_FOUND` |
| `.found` → `SkuRepository.findOnSaleByProduct` | `C-05`·`R-01` | `sale_status = 'ON_SALE'` SKU만. `inStock = available > 0` — 수량 자체는 내지 않는다. 품절 SKU는 화면이 고르지 못하게 한다(`R-01`) |
| `search` → `ProductSearchService.search` | `D-08`·`R-01` | 상위 `Catalog.search`. 안쪽은 `JF-4.1` |
| `getSkus` → `SkuRepository.findViewsByIds` | `C-05`·`R-07`·`R-09` | 상위 `Catalog.getSkus`. `skus`와 `products`, 대표 이미지, 상품 카테고리의 `path`를 한 질의로 묶는다(같은 모듈 테이블). `categoryIds`는 `path`(`/1/5/12/`)를 나눠 말단부터 거꾸로 늘어놓는다 — 조상 조회가 따로 없다. `optionName`은 축 값을 ` / `로 잇는다(예: `블랙 / L`). 잠금이 없다 — 값은 읽은 순간의 것이고, 재고 확보는 `reserveStock`만 보장한다 |

- **트리거** 고객 화면의 탐색(상위 §5.2), cart의 담기·조회·수량 변경·병합(§5.3·§5.5), order의 견적·주문 생성(§5.5·§5.6), claim의 교환 신청(§5.12 — 새 SKU의 상품·단가·판매 상태 확인)이 부르는 `getSkus`. **완료 사실** 읽기만 한다 — 쓰기·잠금 없음.
- 다섯 진입점은 서로 이어지지 않는 독립 조회다. 컨트롤러(`ProductController`)는 매개변수 검사와 응답 변환만 해서 그리지 않았다 — §2의 구현 칸에 대응이 있다.
- 조회는 읽기 전용 트랜잭션이고 복제본을 쓰지 않는다(한 DB — 상위 `D-01`). 캐시는 두지 않는다 — 규모를 재 본 뒤 정한다(§9).

### JF-4.1 검색 — ProductSearchService.search

```jobflow
orchestrator: ProductSearchService
Object: ProductSearchService, SearchQueryParser, ProductSearchRepository
ProductSearchService.search --> SearchQueryParser.parse
SearchQueryParser.parse.terms --> ProductSearchRepository.matchOnSale
SearchQueryParser.parse.tooShort
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ProductSearchService.search` | `D-08`·`R-01` | `JF-4`의 `search`. 입력 `q`·`sort`·`page`·`size` |
| `SearchQueryParser.parse` | `D-08` | 순수 함수. ① 앞뒤 공백을 빼고 50자가 넘으면 `QUERY_TOO_LONG`(422) ② boolean 모드 연산 문자 `+ - > < ( ) ~ * " @`를 공백으로 바꾼다 ③ 공백으로 나눠 2글자 미만 낱말은 버린다 ④ 남은 낱말마다 `+"낱말"`로 묶는다 — ngram 토큰이 연달아 맞는 구절 일치이고, 모든 낱말이 들어 있어야 한다 |
| `.tooShort` | `D-08`·`R-01` | 단독 줄 — 남은 낱말이 없다(검색어가 1글자이거나 1글자 낱말뿐). 422 `QUERY_TOO_SHORT`. 토큰 크기 2의 ngram 색인은 1글자로 찾을 수 없어서다(상위 §5.2의 「`q`가 2글자 미만이면 422」) |
| `.terms` → `ProductSearchRepository.matchOnSale` | `D-08`·`R-01` | `MATCH(name, brand, search_tags) AGAINST(:terms IN BOOLEAN MODE)` + `status = 'ON_SALE'`. 정렬 — `recommended`는 일치 점수 내림차순, 같으면 `rank_score`. `newest`·가격은 `JF-4`와 같다. 전체 건수는 `COUNT(*) OVER()`로 같은 질의에서 받는다. 페이지는 50쪽까지 |

- **완료 사실** 판매중 상품의 카드 목록 — 목록 응답과 같은 꼴. 결과가 없어도 200이다.
- 한글 「청바지」는 `+"청바지"` 하나로 「청바」·「바지」 토큰이 이어서 맞는 상품을 찾는다. 「바지」 두 글자로도 찾힌다(`R-01`의 「한글 두 글자 검색어」). 형태소·오타·동의어는 없다(`D-08` 단점).

### JF-5 운영 라우트 — AdminCatalogController

```jobflow
orchestrator: AdminCatalogController
Object: AdminCatalogController, ImageUploadService, StorageGateway, ProductCommandService, StockService, CategoryCommandService
AdminCatalogController.issueUploadUrl --> ImageUploadService.issue
ImageUploadService.issue --> StorageGateway.presignPut
AdminCatalogController.saveProduct --> ProductCommandService.saveProduct
AdminCatalogController.adjustStock --> StockService.adjustStock
AdminCatalogController.saveCategory --> CategoryCommandService.save
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `AdminCatalogController` | `C-05`·`R-21` | `/api/admin/products*`·`/api/admin/skus/*`·`/api/admin/categories*`·`/api/admin/uploads/product-images`를 받는다. 운영자 세션 확인은 앞단 인증 미들웨어가 끝냈다(그 밖 403). 운영 목록·상세 GET(`AdminProductQueryService`)과 카테고리 삭제는 같은 꼴이라 그리지 않았다 |
| `issueUploadUrl` → `ImageUploadService.issue` | `C-05` | 상위 `Catalog.issueUploadUrl`. 형식(`image/jpeg`·`png`·`webp`)과 크기(10MB 이하)를 검사하고 키 `products/<yyyyMM>/<uuid>.<확장자>`를 만든다. 기획전 배너 화면도 같은 라우트로 키를 받는다(상위 §5.15) — 키 접두가 같아 배너도 상품 이미지와 같은 공개 주소 규칙을 쓴다 |
| `ImageUploadService.issue` → `StorageGateway.presignPut` | `C-05` | 객체 저장소 쪽 게이트웨이. S3 호환 서명 `PUT` 주소를 계산한다 — 수명 10분, `Content-Type`과 길이 조건을 서명에 넣는다(가정 — S3 호환 저장소). 네트워크 호출이 없다. 브라우저가 이 주소로 상위 `Storage.putObject`를 부른다 |
| `saveProduct` → `ProductCommandService.saveProduct` | `C-05`·`R-21` | 상위 `Catalog.saveProduct`(`POST`·`PATCH`). 안쪽은 `JF-5.1` |
| `adjustStock` → `StockService.adjustStock` | `C-06`·`R-21` | 상위 `Catalog.adjustStock`. 안쪽은 `JF-5.2` |
| `saveCategory` → `CategoryCommandService.save` | `C-05`·`R-21` | `POST`·`PATCH /api/admin/categories*`. 깊이 3 초과·자기 하위로 옮김은 422. 부모를 바꾸면 하위 전체의 `path`·`depth`를 한 트랜잭션에서 고친다 |

- **트리거** 운영 화면의 저장(상위 §5.15). **완료 사실** 서명 URL 발급, 상품·SKU·재고·카테고리 반영 — 각 라우트가 catalog 자기 트랜잭션 하나다(다른 모듈을 부르지 않는다).
- 컨트롤러는 라우트를 서비스로 나누고 결과를 HTTP로 바꿀 뿐이라 요청마다 화살표 하나다. 다섯 줄은 서로 다른 요청이다.

### JF-5.1 상품 저장 — ProductCommandService.saveProduct

```jobflow
orchestrator: ProductCommandService
Object: ProductCommandService, OptionMatrix, CategoryRepository, ProductRepository, SkuRepository, ProductImageRepository
ProductCommandService.saveProduct --> OptionMatrix.build
OptionMatrix.build.invalid
OptionMatrix.build.matrix --> CategoryRepository.findLeaf
CategoryRepository.findLeaf.notLeaf
CategoryRepository.findLeaf.leaf --> ProductRepository.save
CategoryRepository.findLeaf.leaf --> SkuRepository.syncSkus
CategoryRepository.findLeaf.leaf --> ProductImageRepository.replaceAll
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ProductCommandService.saveProduct` | `C-05`·`R-21` | `POST`(새 상품)와 `PATCH`(`version`으로 낙관적 잠금 — 다르면 409 `VERSION_CONFLICT`) 공통 |
| `OptionMatrix.build` | `C-05` | 순수 함수. 축 0~3개, 축마다 값 1~30개, 축 이름·값 중복 없음. SKU의 옵션 값 개수 = 축 개수, 값이 축에 있음, 조합 중복 없음, SKU 1~100개, `price ≥ 0`·`listPrice ≥ price`(정수 원), 새 SKU의 `initialStock ≥ 0`. `PATCH`면 기존 SKU의 옵션 값이 바뀌지 않았는지 본다 |
| `.invalid` | `C-05` | 단독 줄 — 422 `VALIDATION_FAILED {fields[{field, reason}]}`·`OPTION_MISMATCH`·`OPTION_IMMUTABLE`·`STOCK_FIELD_NOT_ALLOWED`. 쓰기 없음 |
| `.matrix` → `CategoryRepository.findLeaf` | `C-05` | 상품은 말단 카테고리에만 단다. `.notLeaf`는 단독 줄 — 422 `CATEGORY_NOT_LEAF`(없는 카테고리도 같다) |
| `.leaf` → `ProductRepository.save` | `C-05`·`D-08` | 상품 행. `option_axes`(JSON), `search_tags`(공백으로 이은 글), `min_price`(판매중 SKU 최저가 — 가격 정렬용), 처음 `ON_SALE`이 되는 순간 `published_at`. FULLTEXT 색인은 커밋 때 함께 갱신된다 |
| `.leaf` → `SkuRepository.syncSkus` | `C-05`·`C-06` | 새 SKU는 `available = initialStock`, `reserved = 0`으로 넣는다. 기존 SKU는 가격·`max_quantity`·`sale_status`만 바꾼다. 요청에 없는 기존 SKU도 지우지 않는다 — 주문 품목과 가예약이 참조하므로 `STOPPED`로만 내린다. 재고 열은 여기서 바꾸지 않는다(`JF-5.2`만) |
| `.leaf` → `ProductImageRepository.replaceAll` | `C-05` | `imageKeys` 순서대로 `product_images`를 다시 쓴다. 첫 장이 대표다. 키가 `products/` 접두의 형식이 아니면 422 `INVALID_IMAGE_KEY`. 객체가 실제로 있는지는 묻지 않는다(§8) |

- **완료 사실** 한 트랜잭션에서 상품·SKU·이미지 메타가 함께 바뀐다. 고객 조회(`JF-4`)에는 커밋 뒤 바로 보인다.
- `.leaf`에서 나가는 세 화살표는 같은 갈래에서 차례로 부르는 세 저장이다(재호출 아님).
- 가격을 바꿔도 장바구니·주문서는 다음 `getSkus`에서 새 가격을 받는다. 이미 만든 주문은 order의 품목 스냅숏을 쓴다(상위 §6.2).

### JF-5.2 재고 조정 — StockService.adjustStock

```jobflow
orchestrator: StockService
Object: StockService, SkuRepository, StockAdjustmentRepository
StockService.adjustStock --> SkuRepository.addAvailable
SkuRepository.addAvailable.applied --> StockAdjustmentRepository.append
SkuRepository.addAvailable.belowReserved
SkuRepository.addAvailable.notFound
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `StockService.adjustStock` | `C-06`·`R-21` | 상위 `Catalog.adjustStock`. 재고 계약 넷과 달리 catalog 자기 트랜잭션을 연다(`REQUIRED`) |
| `SkuRepository.addAvailable` | `C-06` | `UPDATE skus SET available = available + :d WHERE id = :id AND available + :d >= 0` — 조건부 갱신 한 문장이라 동시 가예약과 겹쳐도 `available`이 0 밑으로 가지 않는다. 바뀐 행이 0이면 다시 읽어 갈래를 가른다 |
| `.belowReserved` | `C-06`·`R-21` | 단독 줄 — 행은 있는데 조건이 틀렸다. 409 `BELOW_RESERVED {available, reserved}`. 남는 실물 재고(`available + reserved + d`)가 가예약 합(`reserved`)보다 적어지는 조정이다 — 식으로는 `available + d < 0`과 같다 |
| `.notFound` | `C-06` | 단독 줄 — 404 |
| `.applied` → `StockAdjustmentRepository.append` | `C-06`·`R-21` | `stock_adjustments`에 `delta`·`reason`·운영자 ID·조정 뒤 `available`을 남긴다. 그 뒤 200 `{skuId, available, reserved}` |

- **완료 사실** `available` 변경 + 조정 이력 1행. 판매 상태는 바꾸지 않는다 — 0이 되면 조회에서 품절로 보일 뿐이다.
- 「재고를 몇 개로 맞춘다」는 절대값 입력은 받지 않는다. 화면이 읽은 뒤 사이에 가예약이 바뀌면 절대값은 그 변화를 덮기 때문이다 — 화면이 차이(`delta`)를 계산해 보낸다.

### 3.1 연산별 재고 열 변화

`available`은 지금 팔 수 있는 수량, `reserved`는 `HELD` 가예약 수량의 합이다. 창고에 있는 실물(출고 전)은 `available + reserved`다.

| 연산 | `available` | `reserved` | 가예약 행 | 그림 |
|---|---|---|---|---|
| 새 SKU 등록 | `= initialStock` | `= 0` | — | `JF-5.1` |
| 운영 조정 | `+ delta`(결과 ≥ 0) | 그대로 | — | `JF-5.2` |
| 가예약 | `− qty` | `+ qty` | `HELD` 생성 | `JF-1` |
| 확정 | 그대로 | `− qty` | `HELD → COMMITTED` | `JF-2` |
| 가예약 해제 | `+ qty` | `− qty` | `HELD → RELEASED` | `JF-3` |
| 출고 전 취소 재입고 | `+ (qty − returned_qty)` | 그대로 | `COMMITTED → RELEASED` | `JF-3` |
| 반품 재입고 | `+ 반품 수량` | 그대로 | `returned_qty` 증가, 다 차면 `COMMITTED → RETURNED` | `JF-3` |
| 연장 | 그대로 | 그대로 | `hold_until` 늘림 | `JF-2` |

## 4. 소유 상태·데이터

catalog가 쓰는 테이블은 여섯이다. 다른 모듈은 이 테이블을 직접 읽거나 쓰지 않고 §2의 계약만 부른다(경계 검사 시험 — 상위 `C-21`). 이미지 바이트는 객체 저장소에 있고 catalog는 키만 갖는다.

| 표 | 주요 열 | 비고 |
|---|---|---|
| `categories` | `id`, `parent_id`, `name`, `depth`(1~3), `path`(`/1/5/12/`), `sort_order`, `visible` | 하위 조회는 `path` 접두 일치. 상품은 말단에만 단다. 하위나 상품이 있으면 지우지 못한다 |
| `products` | `id`, `category_id`, `name`, `brand`, `description`, `option_axes`(JSON — 축 이름과 값 순서), `search_tags`, `status`(`DRAFT`·`ON_SALE`·`STOPPED`), `min_price`, `rank_score`, `published_at`, `version` | `FULLTEXT(name, brand, search_tags) WITH PARSER ngram`. 지우지 않는다 — `STOPPED`로 남긴다(주문 품목이 스냅숏을 갖지만 SKU 참조는 남는다) |
| `skus` | `id`, `product_id`, `option1`~`option3`(안 쓰는 축은 빈 글자), `price`, `list_price`, `max_quantity`(기본 10), `sale_status`(`ON_SALE`·`STOPPED`), `available`, `reserved` | 유일 `(product_id, option1, option2, option3)` — 빈 글자를 쓰는 것은 MySQL 유일 색인이 `NULL`을 여럿 허용하기 때문이다. `CHECK (available >= 0)`, `CHECK (reserved >= 0)`. 지우지 않는다 |
| `product_images` | `id`, `product_id`, `object_key`, `sort_order` | `sort_order` 0이 대표 이미지. 공개 주소는 설정의 기본 주소 + 키 |
| `stock_reservations` | `id`, `ref`, `sku_id`, `qty`, `returned_qty`, `status`(`HELD`·`COMMITTED`·`RELEASED`·`RETURNED`), `hold_until`, `created_at`, `committed_at`, `ended_at` | 유일 `(ref, sku_id)`. 색인 `(status, hold_until)` — 오래된 `HELD` 경보 질의용(§8). `ref`는 `order:<orderId>`·`claim:<claimId>` |
| `stock_adjustments` | `id`, `sku_id`, `delta`, `reason`, `admin_id`, `available_after`, `created_at` | 운영 조정 이력. 지우지 않는다(잠정 — 5년, 대금·재화공급 기록과 함께 본다) |

- **보존** 끝난 가예약 행(`RELEASED`·`RETURNED`)은 `ended_at` 30일 뒤, `COMMITTED` 행은 `committed_at` 1년 뒤 `purgeExpired`가 지운다. `COMMITTED` 행을 오래 두는 것은 반품 재입고가 그 행의 `qty − returned_qty`로 넘침을 검사하기 때문이다(잠정 — §8).
- **불변조건** SKU마다 ① `available ≥ 0` ② `reserved ≥ 0` ③ `reserved` = 그 SKU의 `HELD` 행 `qty` 합 ④ 한 `ref`의 행은 `HELD`·`COMMITTED`·`RELEASED` 가운데 하나를 함께 갖는다(반품 뒤에만 `COMMITTED`·`RETURNED`가 섞인다) ⑤ `returned_qty ≤ qty`. ①②는 DB `CHECK`가, ③④⑤는 `StockService`만 재고 열을 바꾼다는 규칙과 §7의 불변조건 검사가 지킨다.

### 4.1 가예약 행 상태 기계

상태 소유자는 catalog(`stock_reservations.status`, 쓰기는 `StockService`만)다. 초기화 — `reserveStock`이 SKU마다 `HELD` 행을 만든다. 전이를 일으키는 입력은 §2의 재고 계약 넷과 보존 작업뿐이고, catalog 안에 타이머가 없다 — `hold_until`이 지나도 상태는 스스로 바뀌지 않는다(상위 §5.9의 order 만료 타이머가 `releaseStock`을 부른다).

```state
<s> --> (HELD) : reserveStock
(HELD) --> (HELD) : extendReservation — hold_until 늘림
(HELD) --> (COMMITTED) : commitReservation
(HELD) --> (RELEASED) : releaseStock — 가예약 해제
(COMMITTED) --> (COMMITTED) : releaseStock lines — 일부 수량 재입고
(COMMITTED) --> (RETURNED) : releaseStock lines — 남은 수량 모두 재입고
(COMMITTED) --> (RELEASED) : releaseStock — 출고 전 취소 재입고
(RELEASED) --> <e> : 30일 뒤 삭제
(RETURNED) --> <e> : 30일 뒤 삭제
(COMMITTED) --> <e> : 1년 뒤 삭제
```

**기호**: `<s>` 행이 생기는 곳, `(…)` 상태, `<e>` 보존 작업이 행을 지우는 곳, `A --> B : 글` A에서 B로 가는 전이와 그 입력(`state-diagram-guide.md` 「구성 요소」).

- **무시하는 입력** `RELEASED`·`RETURNED`에 온 `releaseStock`(생략형)은 아무것도 바꾸지 않는다. `RELEASED`·없음에 온 `commitReservation`·`extendReservation`은 `notHeld`다. `COMMITTED`에 온 `commitReservation`은 `committed`(멱등)다.
- **거부하는 입력** `HELD`에 온 `releaseStock lines`, 남은 수량을 넘는 `lines`는 `InvalidReleaseException`이다.
- 같은 주문의 상태를 order·payment·promotion과 나눠 가진 모습은 [상위 §5.18](../system-design-to-be.md#518-주문-상태--여러-경계가-나눠-가진-기록)에 있다. catalog 칸의 「해제」·「재입고」가 위 `RELEASED` 두 전이다.

## 5. 의존 — 나가는 방향

catalog는 다른 업무 모듈을 부르지 않는다(상위 §3.1 — 워커). 나가는 의존은 객체 저장소 서명과 공유 기반(DB·조립 지점)뿐이다.

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| 객체 저장소(S3 호환, 가정) | 서명 `PUT` 주소 계산 — `StorageGateway.presignPut(key, contentType, maxBytes, ttl)`. 공개 읽기 주소는 기본 주소 + 키 | `CATALOG_STORAGE_ENDPOINT`·`CATALOG_STORAGE_BUCKET`·자격 증명(환경 변수), `CATALOG_IMAGE_BASE_URL` | 없음 — 서명은 로컬 계산이다. 서명 주소 수명 10분 | 약함 — 게이트웨이 하나 뒤에 있다. 저장소가 멈추면 업로드만 실패하고 조회·재고는 영향이 없다 |
| MySQL 8(한 DB, catalog 테이블만) | InnoDB 행 잠금·조건부 갱신, `FULLTEXT … WITH PARSER ngram` | 서버 설정 `ngram_token_size=2`(기본값 2 — 바꾸지 않는다), 마이그레이션은 mall-api의 도구(잠정 Flyway) | 잠금 대기 `innodb_lock_wait_timeout` 3초(세션 설정 — §6) | 강함 — 재고 정합성이 DB 잠금과 `CHECK`에 기댄다. 다른 DB로 바꾸면 검색과 잠금을 다시 설계한다(`D-08`) |
| mall-api 조립 지점 | 트랜잭션 관리자, 운영자 권한 미들웨어, 오류 형식, 보존 작업의 `RetentionTask.purgeExpired` 호출 | 모듈 공개 인터페이스 `CatalogApi`와 `RetentionTask` 구현 `CatalogRetentionTask`를 빈으로 등록 | — | 재고 계약은 호출자의 트랜잭션에 참여한다(`MANDATORY`) |

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| SKU 행 잠금 대기 | 3초 — 넘으면 예외, 호출자 트랜잭션 롤백 | `catalog.stock.lock-wait-seconds` | `SkuRepository.lockForUpdate`·`ReservationRepository.lockByRef` |
| 가예약 한 번의 줄 수 | 최대 50 SKU | `catalog.stock.max-lines` | `StockService.reserveStock` |
| 서명 업로드 주소 | 수명 10분, 10MB 이하, `jpeg`·`png`·`webp` | `catalog.upload.ttl`·`catalog.upload.max-bytes` | `ImageUploadService.issue` |
| 검색어 | 2~50자, 페이지 50쪽까지 | `catalog.search.max-length`·`catalog.search.max-pages` | `SearchQueryParser`·`ProductSearchRepository` |
| 목록 | 페이지 크기 최대 60, `ids` 최대 100, `getSkus` 최대 100 | `catalog.list.max-size`·`catalog.list.max-ids` | `ProductQueryService` |
| 상품 구성 | 옵션 축 최대 3, 축당 값 최대 30, SKU 최대 100, 카테고리 깊이 3 | `catalog.product.*` | `OptionMatrix`·`CategoryCommandService` |

- **인증** 운영 라우트는 인증 미들웨어가 운영자 세션만 통과시킨다. 고객 조회 라우트는 익명도 받는다. 서비스 계약은 같은 프로세스 안의 호출이라 인증이 없다 — 다른 모듈 내부에서 부르지 못하게 하는 것은 경계 검사 시험이다(상위 `C-21`).
- **부분 실패 규칙** 재고 계약은 부분 성공이 없다 — 모자람은 쓰기 없이 값으로 돌아가고, 쓰기 도중의 예외는 호출자 트랜잭션 전체를 롤백한다. 운영 저장도 catalog 트랜잭션 하나라 상품·SKU·이미지가 함께 바뀌거나 함께 남지 않는다.
- **최후 방어** `CHECK (available >= 0)`·`CHECK (reserved >= 0)`는 코드가 조건을 빠뜨려도 초과 판매를 DB 오류로 막는다(MySQL 8.0.16 이상에서 `CHECK`를 강제한다). 불변조건 ③(`reserved` = `HELD` 합)은 §7의 검사 질의로 시험과 운영 점검에서 확인한다.

### 6.1 동시성과 잠금 순서

- **같은 SKU를 다투는 가예약** 둘 다 `lockForUpdate`에서 같은 행을 잠그려 한다. 먼저 잠근 쪽이 커밋·롤백할 때까지 다른 쪽은 기다리고, 깨어나면 바뀐 `available`을 다시 읽는다. 그래서 재고 1개에 동시 주문 10건이면 하나만 `reserved`, 나머지는 `outOfStock`이다(상위 §9.2 「재고 경합」).
- **교착 방지** 모든 재고 계약은 SKU 행과 가예약 행을 **SKU ID 오름차순**으로 잠근다. 서로 다른 순서로 담은 두 주문(A·B와 B·A)도 같은 순서로 잠가 원형 대기가 생기지 않는다.
- **모듈을 넘는 잠금 순서** 조율자 트랜잭션은 자기 행(주문·클레임)을 먼저 잠그고 catalog → promotion 순으로 부른다(상위 §5.6·§5.7의 줄 순서). 이 순서를 어기는 조율자가 생기면 모듈 사이 교착이 생길 수 있다. order 상세의 주문 생성(`insert` → `reserveStock` → `lockCoupons`)과 해제(`releaseStock` → `releaseCoupons`)가 이 순서이고, claim은 promotion을 부르지 않는다.
- **잠금 시간** 잠금은 호출자 트랜잭션이 끝날 때 풀린다. 조율자는 외부 HTTP를 트랜잭션 밖에서 부르므로(상위 §6.3) 잠금을 쥔 채 PG를 기다리는 일이 없다.
- **운영 조정과 가예약** 조정은 조건부 갱신 한 문장이라 따로 잠그지 않는다. 가예약이 행을 잠근 동안 조정은 기다렸다가 바뀐 값으로 조건을 다시 본다.

## 7. 검증 계획

시험은 실제 MySQL 8 컨테이너(Testcontainers)에서 돈다 — ngram 색인·행 잠금·`CHECK`는 메모리 DB로 흉내 낼 수 없다. 명령은 잠정 스택 기준 `./gradlew :catalog:test`다.

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 동시 가예약 | `reserveStock`, 상위 §9.2 「재고 경합」 | 재고 1개 SKU에 서로 다른 `ref` 10개를 스레드 10개로 동시에 각자 트랜잭션에서 호출 → `reserved` 1, `outOfStock` 9, 끝난 뒤 `available = 0`·`reserved = 1` | 순서 2 catalog 작업 |
| 전부 아니면 전무 | `reserveStock` 여러 SKU | SKU 셋 중 하나만 모자라게 두고 호출 → `outOfStock{그 SKU}`, 세 SKU의 `available`·`reserved`·가예약 행 변화 0 | 같음 |
| 교착 없음 | 잠금 순서(§6.1) | 두 트랜잭션이 SKU A·B와 B·A 순서의 줄로 동시에 가예약을 1,000회 반복 → 교착 예외 0 | 같음 |
| 참조 키 멱등 | `reserveStock`·`commitReservation`·`releaseStock`(생략형) 두 번 호출 | 두 번째 호출이 쓰기 없이 같은 결과. 같은 `ref`에 다른 줄 → `ReservationConflictException` | 같음 |
| 만료 경합 | `releaseStock` 뒤 `commitReservation`, `extendReservation` | 해제한 키 확정 → `notHeld`·재고 변화 0, 연장 → `notHeld` | 같음 |
| 해제와 재입고 | `releaseStock` 갈래 셋 | `HELD` 해제 → `available` 복원·`reserved` 감소. `COMMITTED` 생략형 → 재입고·`RELEASED`. `lines` 일부 → `COMMITTED` 유지·`returned_qty` 증가, 나머지까지 → `RETURNED`. 남은 수량 초과·`HELD`에 `lines` → `InvalidReleaseException`. 빈 목록 → 변화 0 | 같음 |
| 호출자 트랜잭션 전제 | 재고 계약 넷 | 트랜잭션 없이 호출 → `IllegalTransactionStateException`. 호출자 롤백 → catalog 쓰기도 사라짐 | 같음 |
| 불변조건 검사 | §4 불변조건 ③ | 위 시험이 끝날 때마다 `SELECT s.id FROM skus s LEFT JOIN (SELECT sku_id, SUM(qty) q FROM stock_reservations WHERE status='HELD' GROUP BY sku_id) h ON h.sku_id = s.id WHERE s.reserved <> COALESCE(h.q, 0)` → 0행 | 같음 |
| 재고 조정 | `PATCH /api/admin/skus/{skuId}/stock` | `available` 2·`reserved` 3에 `delta −3` → 409 `BELOW_RESERVED`, `delta −2` → 200 `available 0`, 조정 이력 1행 | 같음 |
| 검색 | `GET /api/products/search`, `R-01`·`D-08` | 「청바지」 상품에 `q=바지`·`q=청바지` → 찾음, `q=바`·`q=" 바 "` → 422 `QUERY_TOO_SHORT`, `q=+바지*` → 연산 문자 무시하고 찾음, `STOPPED` 상품 → 안 나옴, 정렬 넷의 순서 | 같음 |
| 목록·상세 | `GET /api/products`·`/{productId}` | 하위 카테고리 포함, `ids` 순서 유지·판매중 아닌 ID 제외, 품절 SKU `inStock:false`, `STOPPED` SKU 빠짐, `STOPPED` 상품 404 | 같음 |
| `getSkus` 출력 | `getSkus`, `SkuView` | 깊이 3 카테고리의 상품 SKU → `categoryIds`가 [말단, 부모, 루트] 순, `productId`·`maxQuantity`·`thumbnailUrl` 채워짐. 판매중지 상품의 SKU → `saleStatus:'STOPPED'`로 남음, 없는 ID → 빠짐 | 같음 |
| 운영 목록 필터 | `GET /api/admin/products` | `status=DRAFT`·`ON_SALE`·`STOPPED` 각각 그 상태만, `stock=OUT` → 판매중 SKU `available` 합 0인 상품만, `status=SOLD_OUT` 같은 모르는 값 → 422 `VALIDATION_FAILED` | 같음 |
| 상품 저장 검증 | `POST`·`PATCH /api/admin/products` | 축 4개·조합 중복·축에 없는 값 → 422, 기존 SKU 옵션 변경 → `OPTION_IMMUTABLE`, 요청에서 뺀 SKU → `STOPPED`(행 남음), `version` 불일치 → 409 | 같음 |
| 업로드 서명 | `POST /api/admin/uploads/product-images` | 허용 밖 형식·10MB 초과 → 422. 발급 주소로 가짜 S3(MinIO 컨테이너)에 `PUT` 성공, 10분 뒤 실패, 다른 `Content-Type`으로 실패 | 같음 |
| 계약 소비자 시험 | cart·order·claim이 쓰는 `getSkus`·재고 넷 | 각 소비자 모듈 시험이 `CatalogApi`의 실제 구현을 부른다(가짜로 바꾸지 않는다) — 상위 §9.2 「결제 끝단」·「반품 끝단」 | 순서 3·5 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-06`·`D-03` | 위험 | `releaseStock` 생략형은 행이 `HELD`면 해제, `COMMITTED`면 재입고한다. 만료·거절 경로가 이미 확정된 주문에 잘못 부르면 팔린 재고가 다시 늘어 초과 판매가 생긴다 | `JF-3` | 막는 것은 같은 트랜잭션 안 order의 조건부 상태 전이(`PENDING_PAYMENT`·`WAITING_DEPOSIT`일 때만 만료)다. 더 단단히 하려면 기대 상태 인자(`releaseStock(ref, lines?, expect)`)나 해제 전용 계약을 따로 둔다 — 상위 계약이 바뀌므로 지금은 두지 않는다(잠정) |
| `C-06` | 위험 | `lines` 생략과 빈 목록의 뜻이 다르다. 직렬화·매핑에서 빈 목록이 `null`로 바뀌면 반품 0건이 주문 전체 재입고가 된다 | §2 | 계약 시험(§7 「해제와 재입고」)으로 빈 목록 → 변화 0을 고정한다. 계약을 `releaseStock(ref)`와 `restockReturn(ref, lines)` 둘로 나누는 안이 대안이다(미확정) |
| `C-06`·`R-14` | 위험 | 반품 부분 재입고는 참조 키로 멱등이 아니다. 같은 반품이 두 번 처리되면 남은 수량 안에서 두 번 재입고한다 | `JF-3` | claim의 클레임 상태 전이와 `markLineClaim` 조건부 갱신이 같은 트랜잭션에서 막는다(상위 §6.3). 넘치는 경우만 catalog가 예외로 막는다 |
| `C-06`·`R-20` | 위험 | catalog에는 타이머가 없다. order 만료 타이머가 멈추면 `HELD`가 풀리지 않아 다른 고객에게 품절로 보인다 | §4.1 | `hold_until`이 10분 넘게 지난 `HELD` 건수를 운영 점검에 내는 질의를 둔다(색인 `(status, hold_until)`). 경보를 어디에 띄울지는 mall-api 상세의 운영 점검과 맞춰야 한다 — 미확정 |
| `C-06` | 미확정 | 잠금 대기 초과(3초)·교착 예외를 조율자가 HTTP로 무엇이라 낼지 | §6 | catalog는 예외를 던지고 끝난다. order·claim 상세에서 503 `BUSY`(다시 시도) 같은 응답을 정해야 한다 |
| `C-06` | 미확정 | `COMMITTED` 가예약 행의 보존 기간 1년(상위 §4.5 「확정 1년」) | §4 보존 | 잠정 1년 — 반품 기한(배송 완료 7일)과 배송 지연을 넉넉히 덮는다. 지운 뒤 들어온 반품은 행이 없어 `InvalidReleaseException`이 된다 |
| `C-05` | 미확정 | 옵션 축 상한 2와 3 가운데 무엇으로 할지, SKU 상한 100 | §6 | 잠정 축 3(색·사이즈·소재). 국내 의류·잡화몰은 2축이 대부분이라 화면을 2축으로 먼저 만들 수 있다 |
| `C-05` | 위험 | 업로드한 뒤 상품에 저장하지 않은 이미지 객체가 저장소에 남는다. 저장할 때 객체가 실제로 있는지도 묻지 않는다 | `JF-5.1` | 깨진 이미지는 화면이 대체 이미지로 보인다. 정리가 필요하면 저장소 수명 규칙과 `product_images` 대조 작업을 더한다 |
| `D-08` | 위험 | ngram 검색은 형태소·오타·동의어가 없고, 상품 수가 많아지면 느려질 수 있다 | `JF-4.1` | 검색 계약(`ProductSearchService.search`)을 유지한 채 검색엔진으로 바꿀 수 있게 저장소 하나 뒤에 두었다. 규모 측정 전에는 판단할 수 없다(§9) |
| `D-08` | 미확정 | 관리형 DB에서 `ngram_token_size`를 바꿀 수 없을 때 | §5 | 기본값 2를 그대로 쓰므로 바꿀 일은 없다. 다만 1글자 검색(예: 「옷」)은 끝내 안 된다 — 422로 안내한다 |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 잠금·검색·서명의 동작과 모든 수치(잠금 대기 3초, 상한값, 보존 기간)는 설계값이고 실행으로 확인하지 않았다.
2. MySQL 8 ngram 전문 검색의 성능과 결과 품질은 상품 수·데이터로 재지 않았다. 목록·검색에 캐시를 둘지도 그 측정 뒤에 정한다.
3. 객체 저장소는 S3 호환 서명(`Content-Type`·길이 조건을 넣은 서명 `PUT`)을 가정했다. 고른 저장소가 길이 조건을 서명에 넣지 못하면 업로드 크기 제한은 저장소 정책으로 옮겨야 한다.
4. 조율자의 「catalog → promotion」 호출 순서는 order 상세의 그림 줄 순서로만 대조했다 — 외부 HTTP를 트랜잭션 밖에서 부른다는 것과 함께 실행으로 확인하지 않았다.
5. 렌더 확인은 `design-doc-check`에 연결한 jobflow 렌더러로 SVG를 만들고 PNG로 본 것까지다. `state` 블록과 문서 변환 도구 안의 표시는 확인하지 않았다.
