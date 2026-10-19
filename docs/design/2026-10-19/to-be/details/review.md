# review (모듈) — TO-BE 상세

> **대상**: review 모듈 전체 — 구매확정 품목 리뷰 작성·수정·삭제, 사진 업로드 URL 발급과 키 확인, 상품별·내 리뷰 목록과 별점 집계, 안 쓰인 사진 정리, 탈퇴 회원 작성자 익명화(`C-17`·`R-15`, 익명화는 `C-20`·`R-26`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드 없는 신규 설계의 문서 기준점)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·테이블·설정이 제안이다 — 그래서 `(제안)` 표시는 생략한다. 외부 객체 저장소의 동작은 「가정」, 확인하지 못한 것은 「미확인」으로 적는다. 그림 근거 열은 `R`·`C`·`D` ID다. 심볼 이름은 상위 §9.5의 잠정 스택(Java 21 + Spring Boot 3)을 따른 예시다

## 1. 책임 / 비책임

- **책임**: 구매확정한 주문 품목에 회원이 리뷰 1건(별점 1~5, 본문 10~2000자, 사진 0~5장)을 쓰게 한다. 구매확정 여부와 품목 소유는 order에 묻는다(`Order.getConfirmedLine`). 사진은 브라우저가 객체 저장소에 직접 올리도록 서명 URL을 내주고, 리뷰에 붙는 키가 이 회원이 발급받은 키인지와 실제로 올라왔는지 확인한다. 상품별 목록(최신순·별점순)과 평균 별점·별점 분포, 내 리뷰 목록을 낸다. 작성자 본인의 수정·삭제를 받는다. 발급만 받고 리뷰에 안 쓰인 사진과 떼어 낸 사진을 저장소에서 지운다. 탈퇴 회원의 리뷰 작성자 표시를 익명화한다(`C-17`, `R-15`, `R-26`).
- **비책임**: 구매확정 판정과 자동 구매확정(order — 상위 §5.11·§5.13), 회원 인증과 요청 주체 결정(mall-api 인증 미들웨어 → member), 탈퇴 처리와 탈퇴 회원 목록(member), 작성자 표시 이름의 마스킹 규칙(member — 요청 주체의 `displayName`), 상품 정보·판매 상태(catalog — review는 상품이 판매중인지 보지 않는다), 이미지 바이트 저장과 공개 제공(객체 저장소), 보존·탈퇴 정리 작업의 실행 주기(mall-api 스케줄러).
- **아무도 하지 않는 것**: 금칙어 걸러내기·리뷰 신고·운영자 숨김(범위 밖 — 요청 범위에서 뺐다), 사진 내용 검수(음란물 등), 리뷰 적립금(적립금 자체가 범위 밖 — 상위 §9.5), 상품 카드의 평균 별점 표시(catalog는 review를 부르지 않는다 — §8), 「작성 가능한 리뷰」 목록(구매확정 품목 중 리뷰 없는 것 — §8).

## 2. 공개 계약

전수 8개 — HTTP 라우트 6(고객 화면이 부른다), 서비스 2(mall-api 탈퇴 정리 작업이 부르는 `anonymizeAuthors`, 보존 작업이 부르는 `purgeExpired`). 라우트는 `/api/reviews*`·`/api/products/{productId}/reviews`·`/api/members/me/reviews`이고 조립 지점이 이 모듈의 `ReviewRoutes`에 붙인다. 서비스 인터페이스는 `ReviewApi`(공개 패키지)이고, `purgeExpired`는 공용 `RetentionTask`의 구현이다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `POST /api/reviews/upload-urls` | 세션(회원), `{count 1..5, contentTypes[]}` — `contentTypes`는 `count`개, 각각 `image/jpeg`·`image/png`·`image/webp` | 201 `{uploads[{imageKey, uploadUrl, method:'PUT', headers{Content-Type}, expiresAt}]}` — URL 10분, 장당 10MB | 401(미로그인 — 인증 미들웨어), 422 `VALIDATION_FAILED {fields}`, 429 `UPLOAD_LIMIT`(한 시간에 30장 초과 — 업무 한도) | `ReviewRoutes.issueUploadUrl` → `ReviewService.issueUploadUrl` — `C-17` |
| `POST /api/reviews` | 세션(회원), `{orderLineId, rating 1..5, content 10..2000자, imageKeys[] 0..5}` | 201 `{reviewId}`(화면은 `MyReviewList`로) | 401, 403 `NOT_CONFIRMED`(구매확정 전), 403 `NOT_OWNER`(남의 품목·없는 품목), 409 `ALREADY_REVIEWED`, 422 `VALIDATION_FAILED {fields}`·`INVALID_IMAGE_KEY {imageKey, why}`, 503 `STORAGE_UNAVAILABLE`(사진 확인 실패 — 다시 시도 가능) | `ReviewRoutes.createReview` → `ReviewService.createReview` — `C-17`·`R-15` |
| `PATCH /api/reviews/{reviewId}` | 세션(회원), `{rating?, content?, imageKeys?}` — `imageKeys`를 주면 사진 전체를 이 목록으로 바꾼다 | 200 `{reviewId, editedAt}` | 401, 404 `NOT_FOUND`(내 리뷰가 아니거나 삭제됨), 422 `VALIDATION_FAILED`·`INVALID_IMAGE_KEY`, 503 `STORAGE_UNAVAILABLE` | `ReviewRoutes.updateReview` → `ReviewService.updateReview` — `C-17` |
| `DELETE /api/reviews/{reviewId}` | 세션(회원) | 204 | 401, 404 `NOT_FOUND` | `ReviewRoutes.deleteReview` → `ReviewService.deleteReview` — `C-17` |
| `GET /api/products/{productId}/reviews` | 쿼리 `sort=latest·rating`(기본 `latest`), `photoOnly=false`, `page=0..`, `size=1..50`(기본 20). 로그인 불필요 | 200 `{summary{count, average(소수 첫째 자리), distribution{1..5}}, items[{reviewId, rating, content, imageUrls[], authorLabel, optionName, createdAt, edited}], page{number, size, totalElements}}` | 422 `VALIDATION_FAILED`(정렬·페이지 값). 없는 상품도 빈 목록 200 — review는 상품 존재를 모른다 | `ReviewRoutes.listProductReviews` → `ReviewQueries.listByProduct` — `C-17` |
| `GET /api/members/me/reviews` | 세션(회원), `page`, `size` | 200 `{items[{reviewId, orderLineId, productId, productName, optionName, rating, content, imageUrls[], createdAt, editedAt}], page}` | 401 | `ReviewRoutes.listMyReviews` → `ReviewQueries.listByMember` — `C-17` |
| 서비스 `anonymizeAuthors(memberIds)` | 탈퇴한 회원 ID 목록(최대 500) | `{updated}` — 바꾼 리뷰 수 | 없음(없는 ID는 무시) | `ReviewApi.anonymizeAuthors` → `ReviewMaintenance.anonymizeAuthors` — mall-api 탈퇴 정리 작업이 부른다 — `C-20`·`R-26` |
| 서비스 `purgeExpired(now)` | 기준 시각 | `PurgeResult {task:'review', deleted}` — 저장소 삭제에 실패해 남긴 수는 로그로 남긴다 | 없음(저장소 삭제 실패는 행을 남기고 다음 날 다시) | `ReviewMaintenance.purgeExpired`(`RetentionTask` 구현) — mall-api 보존 작업이 하루 1회 부른다 — `C-17` |

- **불변조건**: 주문 품목 하나에 리뷰 행은 최대 하나다(`reviews.order_line_id` 유일). 삭제한 리뷰도 행이 남아 같은 품목에 다시 쓸 수 없다(§8 미확정). 리뷰에 붙은 사진 키는 그 리뷰 작성자가 발급받은 키다. 한 키는 리뷰 하나에만 붙는다.
- **부작용**: `createReview`·`updateReview`·`deleteReview`는 review 테이블 둘만 한 트랜잭션으로 쓴다. 다른 모듈의 테이블을 바꾸지 않는다 — order의 품목 상태도 바꾸지 않는다(리뷰 작성 여부는 order가 모른다). 저장소 호출은 트랜잭션 밖이다(`issueUploadUrl`의 서명은 네트워크 호출이 아니다 — §5).
- **멱등·재시도**: `createReview`는 멱등 키를 받지 않는다. 두 번 보내면 두 번째가 409 `ALREADY_REVIEWED`이고 화면은 이를 성공처럼 `MyReviewList`로 간다. `issueUploadUrl`은 부를 때마다 새 키를 준다 — 안 쓴 키는 정리 작업이 지운다. 503은 같은 요청을 다시 보내면 된다.
- **권한**: 비회원(조회 토큰 주체)과 운영자 세션은 쓰기 라우트에서 401이다(인증 미들웨어가 회원 주체만 넘긴다 — 상위 §5.13 「리뷰는 비회원이 쓰지 않는다」). 상품별 목록만 익명으로 열린다.
- **작성자 표시**: `authorLabel`은 작성 때 요청 주체의 `Principal.displayName`을 그대로 저장한 값이다 — member가 이미 가려서 준다(회원은 마스킹한 로그인 ID, 예 `minsu77` → `min****`, 소셜 전용 회원은 `카카오 회원`·`네이버 회원`). review는 다시 가리지 않고 원문 로그인 ID를 받지 않는다. 탈퇴 뒤에는 `탈퇴한 회원`이다(§4).

### 2.1 사진 업로드 규칙

| 항목 | 값 | 어디서 막나 |
|---|---|---|
| 형식 | `image/jpeg`·`image/png`·`image/webp` | 발급 때 `contentTypes` 검사, 서명에 `Content-Type`을 넣어 다른 형식 업로드를 저장소가 거절(가정 — S3 호환 서명), 작성 때 `headObject`의 `Content-Type` 재확인 |
| 크기 | 장당 10MB | 작성·수정 때 `headObject`의 크기 확인 — PUT 서명은 크기를 강제하지 못해(가정) 사후 확인한다. 넘으면 422 `INVALID_IMAGE_KEY {why:'TOO_LARGE'}`, 객체는 정리 작업이 지운다 |
| 장수 | 발급 한 번 1~5장, 리뷰 하나 최대 5장 | 발급·작성 입력 검사 |
| URL 수명 | 10분 | 서명 만료 |
| 키 | `reviews/<UUID>.<확장자>` — 회원 ID를 경로에 넣지 않는다 | 발급 때 서버가 만든다 |
| 키 유효 기간 | 발급 뒤 24시간 안에 리뷰에 붙여야 한다 | 작성 때 `issued_at` 확인, 지난 키는 정리 대상 |
| 발급 한도 | 회원당 한 시간 30장 | 발급 때 최근 발급 수 확인 → 429 |
| 공개 주소 | `<REVIEW_IMAGE_PUBLIC_BASE>/<imageKey>` — 리뷰 사진은 공개 읽기(가정 — 저장소·CDN 설정) | 목록 응답이 키로 조립한다 |

## 3. 내부 Job Flow — 드릴다운

**결론**: 조율자는 쓰기 쪽 `ReviewService`, 읽기 쪽 `ReviewQueries`, 정리 작업 쪽 `ReviewMaintenance` 셋이고 서로 부르지 않는다. 사진 키 확인은 작성·수정이 같이 쓰는 `ImageKeyVerifier`로 모았다. 바깥으로 나가는 객체는 order 공개 계약을 부르는 `OrderApi`와 객체 저장소를 부르는 `StorageGateway` 둘이다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Review.write`(§5.1 묶음 — 고객 리뷰 라우트 전부), `Review.write --> Storage.headObject`(§5.1 — 사진 키 확인) | [`JF-1` 라우트 진입](#jf-1-라우트-진입--reviewroutes) | 목록 → [`JF-1.1` 상품별·내 리뷰 목록](#jf-11-상품별내-리뷰-목록--reviewqueries), 수정·삭제 → [`JF-1.2` 리뷰 수정·삭제](#jf-12-리뷰-수정삭제--reviewserviceupdatereview), `Storage.headObject` → 작성·수정이 같이 쓰는 [`JF-3.1` 사진 키 확인](#jf-31-사진-키-확인--imagekeyverifierverify) |
| `Review.issueUploadUrl`(§5.13) | [`JF-2` 사진 업로드 URL 발급](#jf-2-사진-업로드-url-발급--reviewserviceissueuploadurl) | — |
| `Review.createReview`(§5.13), `Review.createReview --> Storage.headObject`(§5.13) | [`JF-3` 리뷰 작성](#jf-3-리뷰-작성--reviewservicecreatereview) | [`JF-3.1` 사진 키 확인](#jf-31-사진-키-확인--imagekeyverifierverify) — `StorageGateway.headObject` |
| `Review.cleanupSupport`(§5.1 묶음)·`Review.cleanupSupport --> Storage.deleteObject`(§5.1), `Review.anonymizeAuthors`·`Review.purgeExpired`·`Review.purgeExpired --> Storage.deleteObject`(§5.17) = `ReviewMaintenance.anonymizeAuthors`·`purgeExpired` | [`JF-4` 정리 작업](#jf-4-정리-작업--reviewmaintenance) | — |

상위 바깥 노드 ↔ 이 경계의 객체: `Order.getConfirmedLine`(§5.1 `Order.claimSupport` 묶음) = `OrderApi.getConfirmedLine`(order 공개 인터페이스를 주입받은 것 — 같은 프로세스 호출), `Storage.putObject`(§5.13 — 브라우저가 직접 올린다) ↔ 이 경계는 `StorageGateway.presignPut`(서명)·`headObject`(확인)·`deleteObject`(정리)만 부른다.

**표기** 노드는 제안 클래스·메서드다. `ReviewStore`는 `reviews`와 리뷰에 붙은 `review_images`를 한 트랜잭션으로 다루는 저장소, `ReviewImageStore`는 발급한 사진 키(`review_images`의 붙지 않은 행)를 다루는 저장소다 — 두 저장소가 같은 표 `review_images`를 나눠 쓰는 규칙은 §4에 있다. 렌더 확인은 이 문서의 jobflow 블록 전부를 대상 렌더러로 SVG·PNG로 그려 봤다. 열지 않은 것: `ReviewInputValidator`(별점·글자 수·키 개수 — 순수 검사), `ReviewQueries`의 정렬 SQL.

### JF-1 라우트 진입 — ReviewRoutes

```jobflow
orchestrator: ReviewRoutes
Object: ReviewRoutes, ReviewService, ReviewQueries

ReviewRoutes.issueUploadUrl --> ReviewService.issueUploadUrl
ReviewRoutes.createReview --> ReviewService.createReview
ReviewRoutes.updateReview --> ReviewService.updateReview
ReviewRoutes.deleteReview --> ReviewService.deleteReview
ReviewRoutes.listProductReviews --> ReviewQueries.listByProduct
ReviewRoutes.listMyReviews --> ReviewQueries.listByMember
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewRoutes.issueUploadUrl` → `ReviewService.issueUploadUrl` | `C-17` | 상위 `Review.issueUploadUrl`. 결과 `issued`→201, `invalid`→422, `overLimit`→429. 안쪽은 `JF-2` |
| `ReviewRoutes.createReview` → `ReviewService.createReview` | `C-17`·`R-15` | 상위 `Review.createReview`. 결과 `created`→201, `notConfirmed`→403 `NOT_CONFIRMED`, `notOwner`→403 `NOT_OWNER`, `duplicate`→409, `invalid`·`invalidImage`→422, `storageUnavailable`→503. 안쪽은 `JF-3` |
| `updateReview`·`deleteReview` | `C-17` | §5.13에 없는 라우트 — 상위 `Review.write` 묶음에 든다. 안쪽은 `JF-1.2` |
| `listProductReviews`·`listMyReviews` → `ReviewQueries` | `C-17` | 상위 `Review.write` 묶음(상위 §4.11 「목록」). 안쪽은 `JF-1.1` |

- **트리거** 고객 화면의 리뷰 요청 — 상위 §5.1 `Browser.call --> Review.write`. 요청 주체(`Principal.subjectId`·`displayName`)는 인증 미들웨어가 넣어 준다. 쓰기 라우트에서 회원 주체가 없으면 미들웨어가 401로 끝내 이 그림에 오지 않는다.
- **완료 사실** 서비스 결과 종류를 HTTP 응답과 오류 형식 `{code, message, details}`(mall-api 공통)으로 바꾼다. 라우트는 업무 판정을 하지 않는다.

### JF-1.1 상품별·내 리뷰 목록 — ReviewQueries

```jobflow
orchestrator: ReviewQueries
Object: ReviewQueries, ReviewStore, ReviewImageStore, StorageGateway

ReviewQueries.listByProduct --> ReviewStore.summarizeByProduct
ReviewQueries.listByProduct --> ReviewStore.pageByProduct
ReviewStore.pageByProduct.result --> ReviewImageStore.findAttached
ReviewImageStore.findAttached.result --> StorageGateway.publicUrl
ReviewQueries.listByMember --> ReviewStore.pageByMember
ReviewStore.pageByMember.result --> ReviewImageStore.findAttached
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewStore.summarizeByProduct` | `C-17` | `SELECT COUNT(*), AVG(rating), rating별 COUNT … WHERE product_id=? AND status='ACTIVE'` — 조회 때 집계한다(집계 표를 따로 두지 않는다 — §4·§8). 색인 `(product_id, status, rating)`만 읽는다 |
| `ReviewStore.pageByProduct` | `C-17` | `latest` = `created_at DESC, review_id DESC`, `rating` = `rating DESC, created_at DESC`. `photoOnly`면 `image_count > 0`. `ACTIVE`만 |
| `ReviewImageStore.findAttached` | `C-17` | 페이지에 든 리뷰 ID들의 사진 키를 `sort_order`로 한 번에 읽는다(리뷰마다 따로 묻지 않는다) |
| `StorageGateway.publicUrl` | `C-17` | 키 → 공개 주소. 설정값을 앞에 붙이는 순수 함수라 네트워크 호출이 없다 |
| `ReviewStore.pageByMember` | `C-17` | `member_id=? AND status='ACTIVE'`, `created_at DESC`. 익명화된 리뷰는 `member_id`가 비어 여기에 안 나온다 |

- **트리거** 상품 상세의 리뷰 탭(로그인 불필요), 마이페이지 `MyReviewList`(N6 `(/reviews) --> MyReviewList`). **완료 사실** 요약 + 한 페이지. 읽기 전용이라 트랜잭션은 읽기 전용 하나다.
- `findAttached`로 들어오는 화살표 둘은 서로 다른 진입(`listByProduct`·`listByMember`)이 같은 계약을 부르는 것이다 — 한 요청은 둘 중 하나로만 온다. `listByMember` 쪽도 `publicUrl`을 거치지만 같은 순수 함수라 다시 그리지 않았다.
- 별점 평균은 소수 둘째 자리에서 반올림한다. 삭제된 리뷰는 개수·평균에 들지 않는다.

### JF-1.2 리뷰 수정·삭제 — ReviewService.updateReview

```jobflow
orchestrator: ReviewService
Object: ReviewService, ReviewStore, ImageKeyVerifier

ReviewService.updateReview --> ReviewStore.findOwned
ReviewStore.findOwned.missing
ReviewStore.findOwned.result --> ImageKeyVerifier.verify
ImageKeyVerifier.verify.invalid
ImageKeyVerifier.verify.result --> ReviewStore.updateWithImages
ReviewService.deleteReview --> ReviewStore.softDelete
ReviewStore.softDelete.missing
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewStore.findOwned` | `C-17` | `review_id=? AND member_id=? AND status='ACTIVE'`를 `FOR UPDATE`로 읽는다. 없으면 `.missing` → 404(남의 리뷰인지 알리지 않는다) |
| `ImageKeyVerifier.verify` | `C-17` | `imageKeys`를 준 경우만 부른다. 이미 이 리뷰에 붙은 키는 확인을 건너뛰고, 새 키만 `JF-3.1`로 확인한다. `.invalid` → 422, 저장소 장애 → 503 |
| `ReviewStore.updateWithImages` | `C-17` | 한 트랜잭션 — 별점·본문·`edited_at` 갱신, 새 키 `ISSUED → ATTACHED`, 목록에서 빠진 키 `ATTACHED → DETACHED`(저장소 삭제는 정리 작업이 한다) |
| `ReviewStore.softDelete` | `C-17` | 한 트랜잭션 — `status='DELETED'`, 본문을 지우고 `deleted_at` 기록, 붙은 사진 전부 `DETACHED`. 행은 남아 같은 품목에 다시 쓸 수 없다 |

- **트리거** `MyReviewList`의 「수정」·「삭제」(화면은 storefront-web 상세). **완료 사실** 리뷰 갱신 또는 삭제 표시 1건, 뗀 사진은 다음 정리 작업에서 저장소에서 지워진다.
- 수정 기한은 두지 않는다(잠정 — §8). 구매확정 여부는 다시 묻지 않는다 — 확정은 되돌려지지 않는다(order 상세 §4의 품목 상태 기계 원본).
- `updateReview`에서 `imageKeys`를 주지 않으면 `verify`를 건너뛰고 바로 갱신한다. 그림은 사진을 바꾸는 경우를 그렸다.

### JF-2 사진 업로드 URL 발급 — ReviewService.issueUploadUrl

```jobflow
orchestrator: ReviewService
Object: ReviewService, ReviewImageStore, StorageGateway

ReviewService.issueUploadUrl --> ReviewImageStore.countIssuedSince
ReviewImageStore.countIssuedSince.overLimit
ReviewImageStore.countIssuedSince.result --> ReviewImageStore.insertIssued
ReviewImageStore.insertIssued.result --> StorageGateway.presignPut
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewService.issueUploadUrl` | `C-17` | 상위 `Review.issueUploadUrl`. 먼저 입력을 검사한다 — `count` 1~5, `contentTypes` 개수 = `count`, 허용 형식 셋. 어기면 `invalid` → 422(그리지 않음 — 순수 검사) |
| `ReviewImageStore.countIssuedSince` | `C-17` | 이 회원이 최근 한 시간에 발급받은 키 수 + `count` > 30이면 `.overLimit` → 429. 저장소를 채우는 남용을 막는다 |
| `ReviewImageStore.insertIssued` | `C-17` | 키마다 `review_images` 행 `ISSUED`(`member_id`·`content_type`·`issued_at`)를 먼저 적는다 — 서명보다 앞이라, 서명 뒤 응답 전에 죽어도 키 기록이 남아 정리 작업이 지운다 |
| `StorageGateway.presignPut` | `C-17` | 키·`Content-Type`·10분으로 PUT 서명 URL을 만든다. SDK가 로컬에서 서명을 계산한다 — 네트워크 호출 없음(가정 — S3 호환 SDK) |

- **트리거** `ReviewWriteForm`에서 사진 고르기(상위 §5.13 `Browser.attachPhoto`). **완료 사실** 201 서명 URL 목록 + `ISSUED` 키 행. 이어서 브라우저가 저장소에 직접 `PUT`한다(상위 `Storage.putObject` — 이 경계를 지나지 않는다).
- 업로드가 실패하거나 사용자가 작성을 그만두면 키 행만 남는다. 24시간 뒤 정리 작업이 지운다(`JF-4`).

### JF-3 리뷰 작성 — ReviewService.createReview

```jobflow
orchestrator: ReviewService
Object: ReviewService, OrderApi, ReviewStore, ImageKeyVerifier

ReviewService.createReview --> OrderApi.getConfirmedLine
OrderApi.getConfirmedLine.notConfirmed
OrderApi.getConfirmedLine.notOwner
OrderApi.getConfirmedLine.result --> ReviewStore.existsForLine
ReviewStore.existsForLine.true
ReviewStore.existsForLine.false --> ImageKeyVerifier.verify
ImageKeyVerifier.verify.invalid
ImageKeyVerifier.verify.result --> ReviewStore.insertWithImages
ReviewStore.insertWithImages.duplicate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewService.createReview` | `C-17`·`R-15` | 상위 `Review.createReview` — 입력 `{orderLineId, rating, content, imageKeys[]}` + 요청 주체. 먼저 `ReviewInputValidator`가 별점 1~5, 본문 10~2000자(앞뒤 공백 뺀 글자 수), 키 0~5개·중복 없음을 본다 → 어기면 `invalid` 422(그리지 않음) |
| `OrderApi.getConfirmedLine` | `C-17`·`D-02` | 상위 `Order.getConfirmedLine(orderLineId, memberId)` → `confirmed {orderId, productId, skuId, productName, optionName, confirmedAt}`(그림의 `.result`)·`notConfirmed`·`notOwner`([order 상세 §2](order.md#2-공개-계약)). `.notConfirmed` → 403 `NOT_CONFIRMED`, `.notOwner` → 403 `NOT_OWNER` — 없는 품목도 order가 `notOwner`로 준다. 같은 프로세스 호출이고 트랜잭션 밖이다 |
| `ReviewStore.existsForLine` | `C-17`·`R-15` | 같은 품목 리뷰가 이미 있으면(`DELETED` 포함) `.true` → 409 `ALREADY_REVIEWED`. 사진 확인 전에 빨리 거절하려는 것이고, 최종 방어는 유일 제약이다 |
| `ImageKeyVerifier.verify` | `C-17` | 키가 없으면 부르지 않는다. `.invalid` → 422 `INVALID_IMAGE_KEY`, 저장소 장애 → 503. 안쪽은 `JF-3.1` |
| `ReviewStore.insertWithImages` | `C-17`·`R-15` | 한 트랜잭션 — 리뷰 행(품목 스냅숏 `productName`·`optionName`, `authorLabel` = `displayName`) 삽입 + 키를 조건부로 붙임(`WHERE image_key IN (…) AND member_id=? AND status='ISSUED'`, 바뀐 행 수 = 키 수가 아니면 롤백 → 422). 유일 제약 위반이면 `.duplicate` → 409 `ALREADY_REVIEWED` |

- **트리거** `ReviewWriteForm` 「등록」(N6 `(validate_review) --> (/reviews)`, 상위 §5.13 `Browser.submitReview`). **완료 사실** 리뷰 1건(품목당 유일) + 사진 키 `ATTACHED`. 화면은 201을 받아 `MyReviewList`로, 오류는 `ReviewWriteForm`에 머문다(N6 `(/reviews) --> ReviewWriteForm : error`).
- **동시 작성** 같은 품목을 두 탭에서 동시에 보내면 둘 다 `existsForLine.false`를 지날 수 있다. 유일 제약 `order_line_id`가 두 번째 삽입을 막아 `.duplicate`가 된다. 같은 키를 두 리뷰에 동시에 붙이려 하면 조건부 갱신 `status='ISSUED'`가 한쪽만 통과시킨다.
- **실패 분기** order 조회가 예외(DB 오류)면 500 — review는 다시 시도하지 않는다. 저장소 `headObject`가 타임아웃이면 리뷰를 쓰지 않고 503이다. 확인하지 못한 사진을 붙인 채 쓰지 않는다.

### JF-3.1 사진 키 확인 — ImageKeyVerifier.verify

```jobflow
orchestrator: ImageKeyVerifier
Object: ImageKeyVerifier, ReviewImageStore, StorageGateway

ImageKeyVerifier.verify --> ReviewImageStore.findIssued
ReviewImageStore.findIssued.unusable
ReviewImageStore.findIssued.result --> StorageGateway.headObject
StorageGateway.headObject.missing
StorageGateway.headObject.tooLarge
StorageGateway.headObject.timeout
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewImageStore.findIssued` | `C-17` | 키 목록으로 행을 읽는다. 키마다 ① 행이 있고 ② `member_id` = 요청 회원 ③ `status='ISSUED'`(수정이면 이 리뷰에 붙은 `ATTACHED`도 통과) ④ `issued_at`이 24시간 안 — 하나라도 어기면 `.unusable` → `invalid {imageKey, why:'NOT_ISSUED'·'EXPIRED'·'IN_USE'}` |
| `StorageGateway.headObject` | `C-17` | 키마다 저장소에 메타를 묻는다(3s, 키 5개는 동시에). 객체가 없으면 `.missing`(`why:'NOT_UPLOADED'`), 10MB 초과나 허용 밖 `Content-Type`이면 `.tooLarge`(`why:'TOO_LARGE'`·`'BAD_TYPE'`), 타임아웃·5xx면 `.timeout` → `storageUnavailable` 503 |

- **트리거** `JF-3` 작성과 `JF-1.2` 수정 — 두 곳이 같은 계약을 부른다(한 요청에 한 번). **완료 사실** 모든 키가 쓸 수 있으면 `ok`. 이 그림은 아무것도 쓰지 않는다 — 붙이는 것은 호출자의 트랜잭션이다.
- 확인과 붙이기 사이에 다른 요청이 같은 키를 붙이면, 호출자의 조건부 갱신이 바뀐 행 수로 잡아낸다(`JF-3` 표). 그래서 이 그림은 잠그지 않는다.
- 크기 초과 객체는 지우지 않고 둔다 — 키 행이 `ISSUED`로 남아 24시간 뒤 정리 작업이 지운다.

### JF-4 정리 작업 — ReviewMaintenance

```jobflow
orchestrator: ReviewMaintenance
Object: ReviewMaintenance, ReviewImageStore, StorageGateway, ReviewStore

ReviewMaintenance.purgeExpired --> ReviewImageStore.listPurgeable
ReviewImageStore.listPurgeable.result --> StorageGateway.deleteObject
StorageGateway.deleteObject.result --> ReviewImageStore.deleteRows
ReviewMaintenance.anonymizeAuthors --> ReviewStore.anonymizeAuthors
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `ReviewMaintenance.purgeExpired` | `C-17` | `RetentionTask` 구현 — 안 쓰인·뗀 사진 정리. mall-api 하루 1회 보존 작업이 부른다(상위 §6.2 「파기는 … 소유 모듈의 파기 계약을 부른다」). 상위 §5.17 `Review.purgeExpired` |
| `ReviewImageStore.listPurgeable` | `C-17` | `ISSUED`이고 `issued_at` < 지금−24시간, 또는 `DETACHED` — 500건씩 |
| `StorageGateway.deleteObject` | `C-17` | 키마다 저장소 삭제(5s). 이미 없는 객체도 성공으로 본다(가정 — S3 호환 삭제는 없는 키에 성공을 준다) |
| `ReviewImageStore.deleteRows` | `C-17` | 저장소 삭제에 성공한 키의 행만 지운다. 실패한 키는 행을 남겨 다음 날 다시 한다 |
| `ReviewMaintenance.anonymizeAuthors` → `ReviewStore.anonymizeAuthors` | `C-20`·`R-26` | 탈퇴 정리 작업이 `MemberApi.listWithdrawnSince`에서 받은 탈퇴 회원 ID를 넘긴다(아래 불릿). `UPDATE reviews SET member_id=NULL, author_label='탈퇴한 회원' WHERE member_id IN (…)`, 같은 회원들의 붙지 않은 키 행도 `member_id=NULL` — 이 행은 다음 정리에서 지워진다 |

- **트리거** mall-api 스케줄러의 하루 1회 작업 둘 — 보존 작업(03:30)이 `purgeExpired`를, 탈퇴 정리 작업(04:30)이 `anonymizeAuthors`를 부른다. 두 계약은 서로 모르고 따로 불린다 — 그래서 한 그림에 두 시작점이 있다. **완료 사실** 안 쓰인·뗀 사진이 저장소와 표에서 사라지고, 탈퇴 회원 리뷰의 작성자 표시가 익명이 된다.
- **익명화의 탈퇴 회원 목록** member는 review를 부르지 않는다(상위 §3). 그래서 탈퇴 시각에 바로 익명화하지 않고, mall-api 탈퇴 정리 작업이 `MemberApi.listWithdrawnSince(since, page)`(지난 48시간, 쪽당 500 — [mall-api 상세 `JF-3`](mall-api.md#jf-3-주기-작업--mallscheduler))로 받은 ID를 `ReviewApi.anonymizeAuthors`에 넘긴다. 탈퇴 뒤 최대 하루 동안 가린 표시 이름(`min****`)이 보인다(§8). `anonymizeAuthors`는 같은 ID로 두 번 불려도 결과가 같다.
- `deleteObject` 화살표 하나가 키 수만큼의 실제 재호출이다. 반복은 그리지 않았다. 리뷰 본문은 익명화하지 않는다 — 본문에 쓴 개인정보는 범위 밖이다(§9).

## 4. 소유 상태·데이터

**결론**: 표 둘(`reviews`·`review_images`)과 객체 저장소의 `reviews/` 접두 아래 객체를 소유한다. 평균 별점은 저장하지 않고 조회 때 집계한다.

| 표 | 주요 열 | 비고 |
|---|---|---|
| `reviews` | `review_id` PK, `order_line_id` **UNIQUE**, `member_id` NULL 허용(익명화 뒤 NULL), `author_label`, `product_id`, `sku_id`, `product_name`·`option_name`(작성 때 스냅숏), `rating` TINYINT CHECK 1~5, `content` VARCHAR(2000), `image_count`, `status` `ACTIVE`·`DELETED`, `created_at`, `edited_at`, `deleted_at` | 색인 `(product_id, status, created_at)`, `(product_id, status, rating, created_at)`, `(member_id, status, created_at)`. `order_line_id`·`product_id`·`sku_id`는 다른 모듈의 ID라 FK를 걸지 않는다(상위 §3.1 — 다른 모듈 표 참조 금지) |
| `review_images` | `image_key` PK(`reviews/<UUID>.<확장자>`), `member_id` NULL 허용(발급 회원), `content_type`, `review_id` NULL 허용, `sort_order`, `status` `ISSUED`·`ATTACHED`·`DETACHED`, `issued_at`, `attached_at`, `detached_at` | 색인 `(member_id, issued_at)`(발급 한도), `(status, issued_at)`(정리), `(review_id, sort_order)`. 쓰는 객체가 둘이다 — `ReviewImageStore`는 `ISSUED` 행 삽입·조회·삭제, `ReviewStore`는 리뷰 트랜잭션 안의 `ISSUED → ATTACHED`·`ATTACHED → DETACHED`. 둘 다 review 모듈 안이라 쓰기 소유는 하나다 |
| 객체 저장소 `reviews/*` | 이미지 바이트 | 브라우저가 서명 URL로 올리고, review가 정리 작업으로 지운다. 공개 읽기(가정) |

- **평균 별점 저장 방식**: 조회 때 집계한다. 상품별 리뷰는 수백~수천 건 규모라 색인 범위 집계로 충분하다고 본다(미측정 — §8). 집계 표를 두면 작성·수정·삭제마다 갱신과 경합이 생기고, 표가 셋이 되어 상위 §6.2의 「2표」와 어긋난다.
- **보존**: 리뷰는 삭제 표시로 남는다(본문은 지운다). 탈퇴 회원의 리뷰는 익명화해 남긴다(상위 §6.2). 붙지 않은 키는 24시간, 뗀 사진은 다음 정리 작업까지 남는다. 리뷰 행의 법정 보존 의무는 없다(거래 기록이 아니다 — 잠정).

### 4.1 사진 키 상태 기계

상태 소유자는 review 모듈(`review_images.status`)이다. 초기화는 `issueUploadUrl`의 `insertIssued`, 수명 끝은 정리 작업의 행 삭제다.

```state
<s> --> (ISSUED) : issueUploadUrl
(ISSUED) --> (ATTACHED) : createReview·updateReview — 확인 통과
(ATTACHED) --> (DETACHED) : updateReview에서 빠짐·deleteReview
(ISSUED) --> purge : 24시간 지남
(DETACHED) --> purge : 다음 정리 작업
purge --> <e>
```

**기호**: `<s>` 시작점, `(…)` 상태, 괄호 없는 `purge`는 정리 작업의 처리(저장소 삭제 → 행 삭제), `<e>` 행이 사라지는 곳, `A --> B : 글` 전이와 그 조건(`state-diagram-guide.md` 「구성 요소」).

- **불변조건**: `ATTACHED`면 `review_id`가 있고 그 리뷰의 `member_id`(익명화 전)가 행의 `member_id`와 같다. `ISSUED`·`DETACHED`면 그 키는 어떤 활성 리뷰의 사진 목록에도 없다. `ATTACHED → ISSUED`는 없다 — 뗀 키는 다시 쓰지 않는다.
- 저장소 삭제가 실패하면 행이 그 상태로 남아 다음 정리에서 다시 시도한다.

### 4.2 리뷰 상태

상태 소유자는 review 모듈(`reviews.status`)이다. 초기화는 `createReview`의 삽입이다.

```state
<s> --> (ACTIVE) : createReview
(ACTIVE) --> (ACTIVE) : updateReview
(ACTIVE) --> (DELETED) : deleteReview
```

**기호**: 위와 같다. `DELETED`에서 나가는 전이와 종료점은 없다 — 행은 같은 품목 재작성을 막으려고 남는다.

- **불변조건**: 품목 하나에 행 하나(`ACTIVE`든 `DELETED`든). 목록·집계는 `ACTIVE`만 본다. 익명화는 상태를 바꾸지 않고 `member_id`·`author_label`만 바꾼다.

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| order | `OrderApi.getConfirmedLine(orderLineId, memberId)` → `confirmed {orderId, productId, skuId, productName, optionName, confirmedAt}`·`notConfirmed`·`notOwner`(없는 품목 포함) | order 공개 인터페이스를 조립 지점이 주입(`OrderApi`) | 없음 — 같은 프로세스·같은 DB 읽기 | 읽기만 한다. `productName`·`optionName`으로 스냅숏을 남긴다. order는 review를 모른다(`D-02`) |
| 객체 저장소 | 서명 PUT URL 생성(`presignPut`), 메타 조회(`HEAD`), 삭제(`DELETE`) | `mall.review.storage.bucket`, `mall.review.storage.endpoint`, `mall.review.image.public-base-url`, 자격 증명은 환경 변수 | 서명 없음(로컬 계산), HEAD 3s, DELETE 5s | S3 호환 API 가정. catalog의 상품 이미지와 같은 저장소의 다른 접두를 쓸 수 있다 — 버킷 정책은 운영 설정(미확정) |
| mall-api(들어오는 쪽) | 인증 미들웨어가 넘기는 요청 주체 `Principal {subjectType:'MEMBER', subjectId, displayName}`, 탈퇴 정리 작업의 `anonymizeAuthors`, 보존 작업의 `purgeExpired` | 조립 지점 | — | `displayName`은 member가 마스킹해 준 값이고 그대로 `authorLabel`이 된다([mall-api 상세 §2](mall-api.md#2-공개-계약)). 탈퇴 회원 ID는 탈퇴 정리 작업이 member에서 받아 넘긴다 |

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 업로드 URL 수명 | 10분 | `mall.review.upload.url-ttl` | `StorageGateway.presignPut` |
| 사진 크기 상한 | 10MB | `mall.review.upload.max-bytes` | `ImageKeyVerifier`(HEAD 사후 확인) |
| 사진 형식 | jpeg·png·webp | `mall.review.upload.content-types` | 발급 검사, 서명, HEAD 확인 |
| 리뷰당 사진 | 최대 5장 | `mall.review.max-images` | `ReviewInputValidator` |
| 발급 한도 | 회원당 한 시간 30장 | `mall.review.upload.hourly-limit` | `ReviewImageStore.countIssuedSince` |
| 키 유효 기간 | 발급 뒤 24시간 | `mall.review.upload.key-ttl` | `findIssued`, 정리 작업 |
| 저장소 HEAD | 3s, 재시도 없음(503으로 돌려준다) | `mall.review.storage.head-timeout` | `StorageGateway.headObject` |
| 저장소 DELETE | 5s, 실패는 다음 날 다시 | `mall.review.storage.delete-timeout` | `StorageGateway.deleteObject` |
| 정리 묶음 | 500건 | `mall.review.purge.batch-size` | `ReviewImageStore.listPurgeable` |
| 목록 페이지 | 기본 20, 최대 50 | `mall.review.page.max-size` | `ReviewQueries` |

- **인증** 쓰기 라우트와 내 리뷰는 회원 세션만 받는다(미들웨어). 수정·삭제는 `member_id` 조건으로 본인만 — 남의 리뷰는 404로 존재를 숨긴다. 상품별 목록은 익명 공개이고 `member_id`를 응답에 넣지 않는다.
- **동시성** 품목당 1리뷰는 유일 제약이, 한 키 한 리뷰는 조건부 갱신(`status='ISSUED'`)이 지킨다. 수정은 `findOwned`의 `FOR UPDATE`로 같은 리뷰의 수정·삭제가 겹치지 않는다.
- **부분 실패** 사진 확인 실패 = 리뷰를 쓰지 않음(422·503), 저장소 삭제 실패 = 행을 남기고 다음 날 다시, 익명화 실패 = 탈퇴 정리 작업이 다음 날 다시(48시간 창이 겹쳐 놓치지 않는다, 멱등). review의 실패는 주문·결제 상태에 영향이 없다 — review를 부르는 조율자가 없다.
- **최후 방어** 저장소에 올라갔지만 키 행이 없는 객체(행 삽입 전 업로드는 불가능하지만, 수동 업로드나 버그)는 이 모듈이 찾지 못한다 — 버킷 수명 규칙으로 `reviews/` 접두의 오래된 고아 객체를 지우는 운영 설정이 필요하다(§8).

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 작성 판정 | `createReview` × `getConfirmedLine` 결과 셋 | 가짜 `OrderApi`가 `notConfirmed`·`notOwner`·품목을 돌려준다 → 403 `NOT_CONFIRMED`·403 `NOT_OWNER`·201. 별점 0·6, 본문 9자·2001자, 키 6개 → 422 | 리뷰 작업(상위 §9.1 순서 5) |
| 품목당 1리뷰 | 동시 작성, 삭제 뒤 재작성 | 같은 품목 동시 요청 2건 → 201 1건 + 409 1건. 삭제 뒤 같은 품목 → 409 | 리뷰 작업 |
| 사진 키 확인 | `JF-3.1` | 남의 키, 24시간 지난 키, 이미 붙은 키, 안 올린 키, 11MB 객체, `image/gif` 객체 → 422와 `why` 값. 가짜 저장소 HEAD 지연 4s → 503, 리뷰 0건 | 리뷰 작업 |
| 키 경합 | 같은 키를 두 리뷰에 동시에 | 두 품목 리뷰를 같은 키로 동시 작성 → 한쪽 201, 다른 쪽 422 `IN_USE`, 키는 `ATTACHED` 1건 | 리뷰 작업 |
| 발급 한도·서명 | `issueUploadUrl` | 31장째 → 429. 서명 URL로 다른 `Content-Type` PUT → 저장소 거절(저장소 에뮬레이터, 가정) | 리뷰 작업 |
| 정리 작업 | `purgeExpired` | 시계를 옮긴 시험 DB에서 `ISSUED` 25시간·`DETACHED`·`ATTACHED` 키 → 앞의 둘만 저장소·행 삭제. 저장소 삭제 실패 주입 → 행 남음, 다음 실행에서 삭제 | 리뷰 작업, 상위 §9.2 「보존 작업」 |
| 익명화 | `anonymizeAuthors` | 회원 리뷰 3건 → 작성자 `탈퇴한 회원`, 내 리뷰 목록에서 사라짐, 상품 목록에는 남음. 두 번 실행 → 같은 결과 | 상위 §9.1 순서 6 |
| 목록·집계 | `listByProduct` | 별점 5·4·4·DELETED 1 → `count 3`, `average 4.3`, 분포. `rating` 정렬 순서, `photoOnly` | 리뷰 작업 |
| 모듈 경계 | review가 order 공개 인터페이스만 참조 | mall-api 경계 검사 시험(상위 `C-21`) | 매 빌드 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-20`·`R-26` | 위험 | 탈퇴 즉시가 아니라 다음 탈퇴 정리 작업(최대 하루 뒤)에 작성자를 익명화한다 | member가 review를 부르지 않는다(상위 §3·`D-02`) | 하루 동안 가린 표시 이름이 남는다. 즉시가 필요하면 member 탈퇴 처리가 `ReviewApi.anonymizeAuthors`를 부르게 해야 하고 member → review 의존이 새로 생긴다. 지금은 mall-api 탈퇴 정리 작업이 `listWithdrawnSince`로 잇는다 |
| `C-17` | 미확정 | 삭제한 품목에 리뷰를 다시 쓸 수 있게 할지 | `R-15` 「리뷰 1건」 | 잠정 「다시 못 쓴다」(행을 남겨 유일 제약을 단순하게 지킨다). 허용하면 유일 제약을 `ACTIVE` 행에만 거는 방식(생성 열 + 유일 색인)으로 바꾼다 |
| `C-17` | 미확정 | 수정 기한(예: 작성 뒤 30일)과 수정 이력 보관 | 국내몰마다 다르다 | 잠정 기한 없음·이력 없음(`edited` 표시만). 수정으로 별점을 바꿔 평판을 조작하는 문제가 생기면 기한을 둔다 |
| `C-17` | 위험 | 평균 별점을 조회 때 집계한다 | §4 | 리뷰가 아주 많은 상품에서 느려질 수 있다(미측정). 그때 상품별 집계 표를 더하고 쓰기 트랜잭션에서 갱신한다 — 상위 §6.2의 표 수가 바뀐다 |
| `C-17`·`D-02` | 미확정 | 상품 카드·상품 상세 머리의 평균 별점 표시 | catalog는 review를 부르지 않는다 | 잠정: 상품 상세 화면이 리뷰 목록 요약(`summary`)을 따로 불러 보인다. 카드 목록(카테고리·검색)에는 별점이 없다 — 넣으려면 화면이 상품 ID 묶음으로 요약을 묻는 계약을 review에 더한다 |
| `C-17` | 미확정 | 「작성 가능한 리뷰」 목록 | N6 `ReviewPromptModal`은 구매확정 직후만 다룬다 | 잠정 없음 — 주문 상세의 구매확정 품목에서 「리뷰 쓰기」로 들어간다. 만들려면 order의 구매확정 품목 목록과 review의 작성 여부를 화면이 합친다 |
| `C-17` | 위험 | PUT 서명은 크기를 강제하지 못해 10MB 초과 객체가 잠시 저장소에 남는다 | §2.1(가정 — S3 호환 PUT 서명) | 작성 때 422로 막고 24시간 뒤 지운다. 남용은 발급 한도(시간당 30장)로 줄인다. POST 정책 업로드(크기 범위 강제)로 바꾸면 사전에 막을 수 있다 |
| `C-17` | 위험 | 키 행이 없는 고아 객체는 정리 작업이 찾지 못한다 | §6 최후 방어 | 버킷 수명 규칙(`reviews/` 접두, 예: 행과 대조하는 월 1회 점검이나 태그 기반 만료)이 필요하다 — 운영 설정 |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 수치(10분·10MB·24시간·30장·3s·5s)는 설계값이고 측정하지 않았다.
2. 객체 저장소 업체를 정하지 않았다 — 서명에 `Content-Type`을 넣으면 다른 형식 업로드를 거절하는지, 없는 키 삭제가 성공인지, 공개 읽기 설정은 S3 호환 저장소의 보편 동작을 가정했다.
3. order의 `getConfirmedLine` 출력, member의 `listWithdrawnSince`·`displayName` 마스킹 규칙, mall-api의 `Principal`은 각 상세가 원본이다 — 이 문서는 쓰는 형태만 옮겼고, 원본이 바뀌면 함께 고친다.
4. 리뷰 본문에 고객이 쓴 개인정보(전화번호 등)와 사진 속 개인정보는 걸러내지 않는다 — 금칙어·신고와 함께 범위 밖이다.
5. 렌더 확인은 대상 jobflow 렌더러로 만든 SVG·PNG를 눈으로 본 것이고, 문서 사이트 안의 표시는 확인하지 않았다.
