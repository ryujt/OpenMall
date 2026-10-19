# mall-api (:8080) — TO-BE 상세

> **대상**: 백엔드 한 프로세스의 조립 지점 — 패키지 배치, 라우트 등록 규칙, SPA 정적 파일 제공, 요청 처리 파이프라인(요청 ID·로그·인증·권한·CSRF·레이트 리밋·오류 변환), 트랜잭션 규칙, 스케줄러, 설정·비밀, DB 마이그레이션, 헬스체크, 모듈 경계 검사(`C-21`, `D-01`, `D-05`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드가 없는 신규 설계의 문서 기준점)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 경로·심볼·설정 키가 제안이다 — `(제안)` 표시는 생략한다. 이 설계가 정하지 못하는 외부 동작은 「가정」, 확인하지 못한 것은 「미확인」이다. 스택은 상위 §9.5의 잠정안(Java 21 + Spring Boot 3, MySQL 8)을 따르고, 도구 이름(Spring Security·ShedLock·Flyway·ArchUnit·Bucket4j)은 잠정이다 — 바뀌어도 아래 규칙과 계약은 그대로다

## 1. 책임 / 비책임

- **책임**: 업무 모듈 9개를 한 프로세스로 조립하고 기동한다. 경로 접두로 라우트를 모듈에 붙이는 규칙을 정하고 지킨다. 두 SPA의 정적 파일과 히스토리 폴백을 내려준다. 모든 HTTP 요청에 요청 ID·접근 로그 → 주체 결정(`MemberApi.authenticate`) → 경로별 권한 → CSRF → 레이트 리밋 → 모듈 처리기 → 오류 형식 변환을 적용한다. 트랜잭션 규칙을 정하고 외부 HTTP가 트랜잭션 안에서 불리지 않게 감시한다. 주기 작업 여섯을 정해진 주기로 부르고, 인스턴스가 여럿이면 작업마다 하나만 돌게 잠근다. 설정·비밀을 환경 변수에서 읽어 모듈에 넣는다. DB 마이그레이션 묶음과 헬스체크를 갖는다. 모듈 경계 규칙을 빌드 시험으로 검사한다(`D-01`).
- **비책임**: 업무 규칙(각 모듈), 세션 저장·검증·만료·역할(member — 조립 지점은 쿠키 값을 넘기고 결과만 받는다, `D-05`), 비회원 조회 토큰의 발급·검증(order — 조립 지점은 `OrderApi.resolveGuestToken`을 불러 결과를 주체로 둘 뿐이다), `cartKey` 쿠키의 발급·해석(cart), 모든 업무 테이블(각 모듈), 타이머 작업의 내용(`OrderJobs`·`NotificationJobs`·각 `RetentionTask` 구현 — 조립 지점은 「언제·하나만·얼마 동안」을 맡는다), 업무 잠금(로그인 5회 잠금은 member, 비회원 조회 10회 잠금은 order).
- **아무도 하지 않는 것**: DB 백업·복구 절차, 외부 경보 연동(대사 경보 `RECONCILE_STUCK`·알림 `FAILED`를 사람이 어떻게 보는지 — 지금은 로그 한 줄뿐), 분산 추적, 인스턴스 자동 확장. 모두 운영 주체의 일로 남긴다(§8).

## 2. 공개 계약

진입점은 넷이다 — HTTP :8080(업무 라우트는 모듈이 소유, 조립 지점은 등록 규칙·정적 파일·헬스체크), 기동, 주기 작업 여섯, 그리고 모듈이 쓰는 조립 지점 쪽 공용 계약(오류 형식·파기 작업·트랜잭션 감시). 아래 표가 조립 지점이 직접 갖는 계약 전수다. 업무 라우트의 입력·출력·오류는 각 모듈 상세 §2가 원본이고, 어느 모듈이 받는지는 [2.2](#22-라우트-등록-규칙)에 있다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `GET /`, `GET /{고객 화면 경로}` | 브라우저 주소 | storefront-web `index.html`(`Cache-Control: no-cache`) | 없는 정적 파일(확장자 있는 경로)은 404 | `SpaFallbackController.storefront` |
| `GET /admin`, `GET /admin/**` | 브라우저 주소 | admin-web `index.html`(`no-cache`) | 같음 | `SpaFallbackController.admin` |
| `GET /assets/**`, `GET /admin/assets/**` | 파일 경로 | 빌드 산출물(이름에 해시 — `max-age=31536000, immutable`) | 404 | Spring 정적 리소스(`SpaResourceConfig`) |
| `GET /actuator/health/liveness` | — | 200 `{status:'UP'}` — 프로세스가 요청을 받는다 | 503 | Spring Boot Actuator |
| `GET /actuator/health/readiness` | — | 200 — DB 연결 됨, 마이그레이션 버전이 빌드가 기대하는 버전 이상, 기동 끝남 | 503 `{status:'OUT_OF_SERVICE'}` | `DbReadinessIndicator`, `MigrationReadinessIndicator` |
| 모든 `/api/**` 응답 머리글 | 요청 `X-Request-Id`(선택, 영숫자·하이픈 8~64자) | 응답 `X-Request-Id`, 필요 때 `Set-Cookie: XSRF-TOKEN` | — | `RequestLogFilter`, `CsrfFilter` |
| 모든 `/api/**` 오류 본문 | — | `{code, message, details}` + HTTP 상태([2.3](#23-오류-응답-형식)) | — | `ApiErrorHandler`, `FilterErrorWriter` |
| 그 밖 `/api/**` | — | — | 404 `NOT_FOUND`(JSON — SPA로 폴백하지 않는다) | `ApiErrorHandler` |
| 기동 | 환경 변수 | 업무 모듈 9개 배선, 정적 리소스, 스케줄러 시작 | 필수 설정 누락·마이그레이션 버전 불일치 → 기동 실패 | `MallApiApplication.main` — `JF-2` |
| 주기 작업 여섯 | — | 각 모듈 계약 호출 | 실패는 로그, 다음 주기에 다시 | `MallScheduler` — `JF-3`, [6](#6-실패-경계) |
| 공용 — 오류 | 모듈이 던지는 `MallException(code, status, details)` | 위 오류 본문 | — | `com.openmall.common.error` |
| 공용 — 파기 작업 | 모듈이 구현하는 `RetentionTask.purgeExpired(now)` → `PurgeResult {task, deleted}` — 구현은 member·catalog·promotion·cart·order·payment·claim·review·notification 아홉 | 보존 작업이 하루 1회 부른다 | 한 모듈 실패는 다른 모듈 파기를 막지 않는다 | `com.openmall.common.retention` |
| 공용 — 트랜잭션 감시 | 외부 HTTP 어댑터가 호출 전에 `TransactionGuard.assertNone()` | 트랜잭션 밖이면 그냥 돌아온다 | 트랜잭션 안이면 local·test는 예외, prod는 ERROR 로그 `TX_EXTERNAL_CALL` | `com.openmall.common.tx` |

- **쿠키**: 조립 지점이 직접 쓰는 것은 CSRF `XSRF-TOKEN`(httpOnly 아님·Secure·SameSite=Lax·`Path=/`) 하나다. 인증 단계가 읽는 쿠키는 셋 — 고객 세션 `SID`(`Path=/`), 운영자 세션 `ASID`(SameSite=Strict·`Path=/api/admin`), 비회원 조회 토큰 `GOT`(`Path=/api`)이다. 값·수명·발급은 소유 모듈(세션은 [member 상세 §4](member.md#4-소유-상태데이터), `GOT`는 [order 상세 §2](order.md#2-공개-계약))이 정하고, 조립 지점은 어느 쿠키를 어느 계약에 넘길지만 정한다. `cartKey`는 cart가 직접 읽는다. `ASID`를 따로 둔 이유는 같은 오리진에서 고객·운영자 세션이 서로 덮지 않게 하려는 것이다(상위 §4.3).
- **요청 주체**: 인증 단계가 요청 문맥에 두는 값은 `Principal {subjectType:'MEMBER'|'ADMIN'|'GUEST'|'ANONYMOUS', subjectId?, displayName?, role?, guestOrderIds?}` 하나다(`common` 패키지의 타입). 회원·운영자는 `MemberApi.authenticate`가 채운다 — `displayName`은 member가 주고, 회원은 마스킹한 로그인 ID(예 `min****`, 소셜 전용 회원은 `카카오 회원`·`네이버 회원`), 운영자는 운영자 이름이다([member 상세 §2](member.md#2-공개-계약)). 비회원은 `OrderApi.resolveGuestToken`의 `guest {orderIds[]}`로 `GUEST {guestOrderIds[]}`(최대 5)를 만든다. 모듈 처리기는 이 값만 보고, 쿠키를 직접 읽지 않는다(`cartKey` 제외).
- **호환성**: 오류 본문의 세 필드와 `code` 값은 화면이 분기에 쓰는 계약이다. 필드·`code`를 더하는 것은 호환되고, 이름을 바꾸거나 지우는 것은 화면과 함께 바꾼다.

### 2.1 패키지 배치

한 Gradle 프로젝트·한 jar다. 모듈은 최상위 패키지 하나이고, 그 아래 `api`(공개)와 `internal`(비공개) 둘로 나눈다.

```text
src/main/java/com/openmall/
  app/                     조립 지점 — 이 상세의 범위
    MallApiApplication     기동
    web/                   RequestLogFilter, SessionAuthFilter, AccessRuleFilter, CsrfFilter, RateLimitFilter,
                           ApiErrorHandler, FilterErrorWriter, SpaFallbackController, SecurityConfig, RouteTable
    scheduling/            MallScheduler, LockedJobRunner
    config/                AppProperties(설정 묶음·검증), ModuleWiring
  common/                  공용 — 업무 규칙 금지
    error/                 MallException, ErrorCode
    security/              Principal(요청 주체 — §2)
    money/                 Money(원 정수)
    retention/             RetentionTask, PurgeResult
    tx/                    TransactionGuard
  member/  api/            MemberApi(서비스 인터페이스), DTO(record), 예외
           internal/       web/(컨트롤러), service/, persistence/(엔티티·저장소), adapter/(소셜·본인인증)
  catalog/ promotion/ cart/ order/ payment/ claim/ review/ notification/   같은 모양 — 공개 인터페이스는 `<Module>Api`,
                           타이머 진입은 따로 `OrderJobs`·`NotificationJobs`(api 패키지)
src/main/resources/
  db/migration/<module>/   모듈별 마이그레이션 — §4.1
  static/storefront/       storefront-web 빌드 산출물(빌드 때 복사)
  static/admin/            admin-web 빌드 산출물(빌드 때 복사)
src/test/java/com/openmall/arch/   ModuleBoundaryTest, RouteOwnershipTest, TableOwnershipTest — §7.1
```

- **`api`에 두는 것**: 다른 모듈이 부르는 서비스 인터페이스(`<Module>Api` — `MemberApi`·`CatalogApi`·`PromotionApi`·`CartApi`·`OrderApi`·`PaymentApi`·`ClaimApi`·`ReviewApi`·`NotificationApi`), 스케줄러가 부르는 타이머 진입(`OrderJobs`·`NotificationJobs`), 그 입력·출력 DTO(Java `record`), 공개 예외. `api`는 `internal`·JPA(`jakarta.persistence`)·Spring 웹 타입에 의존하지 않는다.
- **`internal`에 두는 것**: 인터페이스 구현, 컨트롤러, 엔티티·저장소, 외부 어댑터. 다른 모듈은 이 패키지를 참조할 수 없다(§7.1). 엔티티는 모듈 밖으로 나가지 않는다 — 공개 계약은 DTO로 바꿔 돌려준다.
- **`common`**: 업무 규칙이 없는 타입만 둔다. 모든 모듈이 의존할 수 있고 `common`은 어느 모듈에도 의존하지 않는다.
- **배선**: 모듈 구현은 `internal`의 Spring 빈이고, 다른 모듈은 `api`의 인터페이스 타입으로 주입받는다. 조립 지점(`ModuleWiring`)은 컴포넌트 스캔 범위를 `com.openmall`로 두는 것 말고는 업무 빈을 직접 만들지 않는다.

### 2.2 라우트 등록 규칙

모듈의 컨트롤러는 자기 모듈의 경로 패턴 안에서만 매핑할 수 있다. 아래 표가 원본이고(`RouteTable`), `RouteOwnershipTest`가 모든 컨트롤러 매핑을 이 표와 맞춘다(§7.1). 같은 요청에 두 패턴이 맞으면 **더 구체적인 패턴**이 이긴다(Spring MVC 규칙과 같다) — 아래 「예외」 칸이 그런 자리다.

| 모듈 | 경로 패턴 | 예외(더 구체적이라 다른 모듈이 받는 경로) | 접근 |
|---|---|---|---|
| member | `/api/auth/**`, `/api/oauth/**`, `/api/signup/**`, `/api/signup`, `/api/members/**`, `/api/password/**`, `/api/admin/auth/**` | `/api/members/me/coupons` → promotion, `/api/members/me/reviews` → review, `/api/members/me/claims` → claim | 아래 접근 규칙 표의 익명 경로 말고 `/api/members/**`는 회원, `/api/admin/auth/login`은 익명 |
| catalog | `/api/categories/**`, `/api/products/**`, `/api/admin/products/**`, `/api/admin/categories/**`, `/api/admin/skus/**`, `/api/admin/uploads/product-images` | `/api/products/{productId}/reviews` → review | 고객 조회는 익명, `/api/admin/**`는 운영자 |
| promotion | `/api/exhibitions/**`, `/api/coupons/**`, `/api/members/me/coupons`, `/api/admin/exhibitions/**`, `/api/admin/coupons/**` | — | 기획전 조회 익명, 쿠폰 받기·쿠폰함 회원 |
| cart | `/api/cart/**`, `/api/wishlist/**` | — | 장바구니는 회원·익명(`cartKey`), 찜은 회원 |
| order | `/api/orders/**`, `/api/payments/**`, `/api/webhooks/pg`, `/api/guest/orders/lookup`, `/api/admin/orders/**` | `/api/orders/{orderId}/claims/**` → claim | 견적·주문 생성은 익명, 주문·결제는 회원·비회원 조회 토큰, 웹훅·비회원 조회는 익명 |
| claim | `/api/orders/{orderId}/claims/**`, `/api/claims/**`, `/api/members/me/claims`, `/api/admin/claims/**` | — | 회원·비회원 조회 토큰, `/api/admin/**`는 운영자 |
| review | `/api/reviews/**`, `/api/products/{productId}/reviews`, `/api/members/me/reviews` | — | 상품별 목록 익명, 작성·내 리뷰 회원 |
| payment·notification | 없음 — HTTP 라우트가 없다 | — | — |
| 조립 지점 | `/actuator/health/**`, 정적 파일·SPA 폴백 | — | 익명 |

**접근 규칙**(`SecurityConfig`의 요청 매처 — 위에서 아래로 먼저 맞는 규칙이 이긴다):

| 접근 | 경로 | 주체 조건 |
|---|---|---|
| 운영자 | `/api/admin/**`(`POST /api/admin/auth/login` 제외) | `ADMIN` |
| 익명 허용 — 회원 전용 아래 규칙보다 먼저 건다 | `GET /api/categories/**`·`/api/products/**`(상품별 리뷰 목록 포함)·`/api/exhibitions/**`, `/api/cart/**` 전부, `POST /api/members/check-duplicate`, `POST /api/signup`, `POST /api/signup/social`, `POST /api/password/reset`, `/api/auth/login`, `/api/auth/logout`(세션이 없어도 204 — member 상세 §2), `/api/oauth/**`, `POST /api/orders/preview`, `POST /api/orders`, `POST /api/guest/orders/lookup`, `POST /api/webhooks/pg`(CSRF 제외), `POST /api/admin/auth/login` | 아무 주체나 — 익명도 통과 |
| 회원 또는 비회원 조회 토큰 | 주문·결제·클레임 경로 — `GET /api/orders/{orderId}`·`/tracking`, `POST /api/orders/{orderId}/cancel`, `POST /api/orders/{orderId}/lines/{lineId}/confirm`, `POST /api/payments/{paymentKey}/approve`, `POST /api/payments/virtual-accounts`, `/api/orders/{orderId}/claims/**`, `GET /api/claims/{claimId}`, `POST /api/claims/{claimId}/withdraw` | `MEMBER` 또는 `GUEST` |
| 회원 | 나머지 `/api/members/**`(`/me/coupons`·`/me/reviews`·`/me/claims` 포함), `GET /api/orders`, `POST /api/coupons/{couponId}/download`, `/api/wishlist/**`, `POST /api/reviews*`·`PATCH`·`DELETE /api/reviews/{reviewId}` | `MEMBER` |
| 거부 | 표에 없는 `/api/**` | 기본 거부 |

- **판정 몫**: `AccessRuleFilter`는 주체 종류만 본다. 「회원 또는 비회원 조회 토큰」 경로에서 그 주문이 주체의 것인지는 order·claim이 판정한다 — 회원은 주문의 회원 ID, 비회원은 「요청 주문 ∈ `guestOrderIds`」. 조립 지점은 토큰이 있다는 것만 안다.
- **익명 허용 경로의 몫**: 가입·재설정·소셜 경로는 요청자가 아직 회원 주체가 아니라서, 견적·주문 생성은 비회원 구매(`D-07`) 때문에, 장바구니는 `cartKey` 소유자라서 익명을 받는다. 회원 주체로 와도 막지 않는다.
- **경로 원본**: 상위 §3 표의 접두는 모듈별 묶음이다. 더 구체적인 예외 경로(위 넷과 catalog의 `/api/admin/skus/**`·`/api/admin/uploads/product-images`)와 접근 규칙의 원본은 이 절이다.

### 2.3 오류 응답 형식

```json
{ "code": "OUT_OF_STOCK", "message": "재고가 부족한 상품이 있습니다", "details": { "skuIds": [101, 102] } }
```

- `code`는 대문자 스네이크(`OUT_OF_STOCK`) — 화면이 분기하는 값이다. `message`는 사람이 읽는 한국어 기본 문구 — 화면이 바꿔 보여도 된다. `details`는 `code`마다 정해진 객체이고 없으면 `{}`다.
- 요청 ID는 본문에 넣지 않고 `X-Request-Id` 머리글로 준다. 500만 `details.requestId`에도 넣는다(사용자가 문의할 때 쓰게).

| 상태 | 언제 | 대표 `code` | 만드는 곳 |
|---|---|---|---|
| 400 | 본문이 JSON이 아니거나 필수 형식이 깨짐, 업무상 잘못된 요청, 웹훅 서명 불일치 | `MALFORMED_REQUEST`, `AMOUNT_MISMATCH`, `INVALID_SIGNATURE` | `ApiErrorHandler`, 모듈(order 웹훅) |
| 401 | 주체가 필요한 경로에 세션이 없거나 만료 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`(로그인) | `AccessRuleFilter`, member |
| 402 | 결제 거절 | `PAYMENT_DECLINED` | order |
| 403 | 역할 부족, CSRF 불일치, 남의 주문 | `FORBIDDEN`, `CSRF_INVALID`, `NOT_OWNER` | `AccessRuleFilter`, `CsrfFilter`, 모듈 |
| 404 | 대상 없음, 등록되지 않은 `/api/**` | `NOT_FOUND` | 모듈, `ApiErrorHandler` |
| 409 | 상태 충돌 | `INVALID_STATE`, `OUT_OF_STOCK`, `PRICE_CHANGED` 등 | 모듈 |
| 410 | 만료·소진 | `EXHAUSTED`, `EXPIRED` | 모듈 |
| 422 | 입력 검사 실패, 업무 규칙 위반 | `VALIDATION_FAILED {fields:[{field, reason}]}`(입력 형식 — 이 이름 하나만 쓴다), 업무 코드(`TERMS_REQUIRED`·`REFUND_ACCOUNT_REQUIRED` 등) | `ApiErrorHandler`(Bean Validation), 모듈 |
| 423 | 업무 잠금 — 로그인 5회 실패 | `LOCKED {until}` | member |
| 429 | 레이트 리밋 초과(미들웨어) / 업무 잠금 — 비회원 조회 10회 실패 / 업무 한도 | `RATE_LIMITED`(+ `Retry-After`) / `LOCKED {until}` / `UPLOAD_LIMIT`(review 발급 한도) | `RateLimitFilter` / order / review |
| 500 | 처리하지 못한 예외 | `INTERNAL_ERROR {requestId}` | `ApiErrorHandler` |
| 502 | 외부 서비스 오류로 업무를 끝내지 못함 | `PG_ERROR`, `REFUND_FAILED` | 모듈 |
| 503 | 준비 안 됨(기동 중·종료 중) | `UNAVAILABLE` | Actuator, 종료 처리 |

- 202(결제 결과 불명 — 상위 `D-04`)는 오류가 아니라 정상 응답이다.
- **검증 실패 형식**: 입력 형식 오류는 언제나 422 `VALIDATION_FAILED`이고 `details.fields`에 `[{field, reason}]`(예 `{field:'password', reason:'TOO_SHORT'}`)을 담는다. `VALIDATION`·`VALIDATION {field}` 같은 다른 이름은 쓰지 않는다. Bean Validation 위반은 `ApiErrorHandler`가 이 형식으로 바꾼다.
- **`RATE_LIMITED`와 `LOCKED`는 다르다**: `RATE_LIMITED`는 `RateLimitFilter`가 인스턴스 메모리의 짧은 창으로 끊은 것이고(`Retry-After` 초), `LOCKED {until}`은 모듈이 DB에 남긴 업무 잠금이다(로그인은 423, 비회원 조회는 429 — 상태는 다르지만 `code`·`details`가 같아 화면은 `code`로 가른다). 화면은 `LOCKED`면 `until`까지 기다리라고 안내하고, `RATE_LIMITED`면 잠시 뒤 다시 시도하게 한다.
- 모듈은 HTTP 상태를 직접 쓰지 않고 `MallException`(또는 그 하위 예외)을 던진다. 필터 단계 오류(401·403·429)는 처리기에 닿기 전이라 `FilterErrorWriter`가 같은 형식으로 쓴다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 요청 처리는 필터 사슬(`RequestLogFilter` → `SessionAuthFilter` → `AccessRuleFilter` → `CsrfFilter` → `RateLimitFilter`)이 차례로 다음을 부르고 끝에서 모듈 컨트롤러가 받는다 — 단일 조율자가 없다. 기동은 `MallApiApplication.main`이, 주기 작업은 `MallScheduler`가 조율한다. 바깥으로 나가는 것은 모듈의 공개 인터페이스(`MemberApi`·`OrderApi`·`CartApi`·`ReviewApi`), 타이머 진입(`OrderJobs`·`NotificationJobs`), 공용 파기 인터페이스 `RetentionTask`뿐이다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)). 상위 §5는 조립 지점을 칸으로 그리지 않는다 — 「같은 프로세스 안의 관통 단계라 칸으로 그리지 않는다」([상위 §5.0](../system-design-to-be.md#50-표기)). 그래서 요청 처리 파이프라인과 기동은 §5 노드가 없는 진입점이다. 예외는 스케줄러다 — 여러 모듈을 잇는 주기 정리만 상위가 `Scheduler` 칸으로 그렸다(§5.1 `Scheduler.cleanup`, §5.17 `Scheduler.runRetention`·`Scheduler.runWithdrawalCleanup`).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| (§5 노드 없음 — 요청 처리 파이프라인) 상위의 `Browser.*`·`AdminBrowser.*`·`PG.OnDepositNotice`에서 모듈 노드로 가는 모든 HTTP 화살표가 이 사슬을 지난다 | [`JF-1` 요청 처리 파이프라인](#jf-1-요청-처리-파이프라인--requestlogfilterdofilter) | `SessionAuthFilter` → [`JF-1.1` 주체 결정](#jf-11-주체-결정--sessionauthfilterdofilter) |
| (§5 노드 없음 — 기동) | [`JF-2` 기동](#jf-2-기동--mallapiapplicationmain) | — |
| `Scheduler.cleanup`(§5.1 묶음), `Scheduler.runRetention`·`Scheduler.runWithdrawalCleanup`(§5.17) = `MallScheduler.runRetention`·`runWithdrawalCleanup`. 상위의 `Order.OnReconcileTick`·`Order.OnExpiryTick`·`Order.OnDeliveryTick`·`Notification.OnDispatchTick`의 실제 호출자이기도 하다(상위는 칸 생략, §5.17) | [`JF-3` 주기 작업](#jf-3-주기-작업--mallscheduler) | 모든 작업 → [`JF-3.1` 단일 실행 잠금](#jf-31-단일-실행-잠금--lockedjobrunnerrun) |

상위 바깥 노드 ↔ 이 경계가 부르는 모듈 계약: 상위 `Order.OnExpiryTick` = `OrderJobs.onExpiryTick()`, `Order.OnReconcileTick` = `OrderJobs.onReconcileTick()`, `Order.OnDeliveryTick` = `OrderJobs.onDeliveryTick()`, `Notification.OnDispatchTick` = `NotificationJobs.onDispatchTick()`, 요청마다의 주체 결정 = `MemberApi.authenticate`·`OrderApi.resolveGuestToken`, 보존 파기(상위 `*.purgeExpired`) = `RetentionTask.purgeExpired`, 탈퇴 정리 = `MemberApi.listWithdrawnSince`·`CartApi.purgeMembers`·`ReviewApi.anonymizeAuthors`. 상위가 이벤트처럼 쓴 이름을 자바 메서드 이름 규칙에 맞춰 소문자로 시작했다 — 계약은 같다.

**표기** 노드는 제안 심볼이다. `ModuleController`는 「경로를 받은 모듈의 컨트롤러」를 뜻하는 자리표시 객체이고, `RetentionTask`는 아홉 모듈이 구현하는 공용 인터페이스다. 다른 경계는 그 모듈의 `…Api`·`…Jobs` 객체로만 그린다. `on…`으로 시작하는 모듈 계약은 렌더러가 이벤트 모양(앞 두 글자를 지움)으로 그린다. 렌더 확인은 이 문서의 jobflow 블록 전부를 design-doc-check 렌더러로 SVG를 만들고 PNG로 바꿔 눈으로 봤다. 열지 않은 것: `ApiErrorHandler`(예외 → 표 [2.3](#23-오류-응답-형식)의 단순 변환), `SpaFallbackController`(규칙은 [3.2](#32-정적-파일과-히스토리-폴백)), 각 필터의 판정 규칙(표 [3.1](#31-요청-처리-단계)).

### JF-1 요청 처리 파이프라인 — RequestLogFilter.doFilter

```jobflow
scope: mall-api 요청 처리 파이프라인
Object: RequestLogFilter, SessionAuthFilter, MemberApi, AccessRuleFilter, CsrfFilter, RateLimitFilter, ModuleController, ApiErrorHandler

RequestLogFilter.doFilter --> SessionAuthFilter.doFilter
SessionAuthFilter.doFilter --> MemberApi.authenticate
SessionAuthFilter.doFilter --> AccessRuleFilter.doFilter
AccessRuleFilter.doFilter --> CsrfFilter.doFilter
CsrfFilter.doFilter --> RateLimitFilter.doFilter
RateLimitFilter.doFilter --> ModuleController.handle
ModuleController.handle.failed --> ApiErrorHandler.toResponse
RateLimitFilter.doFilter.limited
CsrfFilter.doFilter.mismatch
AccessRuleFilter.doFilter.denied
```

`scope:`를 쓴 이유: 필터마다 다음 필터를 부르는 사슬이라 전체를 조율하는 객체가 없다(순서는 `SecurityConfig`가 등록 때 정한다).

| 노드 | 근거 | 단계 # | 비고 |
|---|---|---|---|
| `RequestLogFilter.doFilter` | `C-21` | 1 | 요청 ID를 받거나 만든다 → 로그 문맥(MDC)·응답 머리글. 사슬이 끝나면 접근 로그 한 줄(메서드·경로 패턴·상태·소요 ms·주체 종류·요청 ID) |
| `SessionAuthFilter.doFilter` → `MemberApi.authenticate` | `D-05`·`C-02` | 2 | 경로에 맞는 세션 쿠키를 골라 member에 넘기고 주체를 정한다. 세션이 없으면 비회원 조회 토큰을 order에 묻는다 — `JF-1.1`. 상위 §5가 그리지 않은 「요청마다 부르는 `Member.authenticate`」(= `MemberApi.authenticate`)가 이 화살표다 |
| `AccessRuleFilter.doFilter`·`.denied` | `R-21`·`C-21` | 3 | 접근 규칙 표([2.2](#22-라우트-등록-규칙))와 주체 종류를 맞춘다. 익명 허용 경로는 그냥 지난다. 주체가 없으면 401 `UNAUTHENTICATED`, 있는데 종류가 다르면 403 `FORBIDDEN` — `.denied`는 `FilterErrorWriter`가 응답을 쓰고 끝난다 |
| `CsrfFilter.doFilter`·`.mismatch` | `D-05`·`C-21` | 4 | 상태를 바꾸는 메서드에서 쿠키 `XSRF-TOKEN` = 머리글 `X-CSRF-Token`(상수 시간 비교). 다르거나 없으면 403 `CSRF_INVALID`. `/api/webhooks/**`는 검사하지 않는다 |
| `RateLimitFilter.doFilter`·`.limited` | `R-03`·`R-16`·`R-02` | 5 | 정해진 경로만 센다(§6). 넘으면 429 `RATE_LIMITED` + `Retry-After` |
| `ModuleController.handle` | `D-01` | 6 | 경로를 받은 모듈의 컨트롤러 → 그 모듈 서비스. 트랜잭션은 여기서 열린다(§6.1) |
| `.failed` → `ApiErrorHandler.toResponse` | `C-21` | 7 | 처리기가 던진 예외를 [2.3](#23-오류-응답-형식) 형식으로 바꾼다. 500이면 스택을 ERROR 로그로 남긴다 |

- **트리거** 모든 HTTP 요청. 정적 파일·헬스체크 경로는 단계 2~5를 건너뛴다(공개, 상태 변경 없음). **완료 사실** 모듈 응답, 또는 단계 3~5에서 끊긴 오류 응답.
- **401이 처리기 앞에서 정해진다** — 세션 없는 상태 변경 요청은 단계 3에서 끝나 업무 처리에 닿지 않는다. 그래서 화면이 재로그인 뒤 같은 요청을 다시 보내도 효과가 두 번 생기지 않는다([admin-web 상세 §3](admin-web.md#3-내부-job-flow--드릴다운)의 재전송이 이 사실에 기댄다).
- **순서를 고른 이유** 권한(3)을 CSRF(4)보다 앞에 둬 세션이 끝난 화면이 403 대신 401을 받게 했다 — 화면이 재로그인으로 갈 수 있다. 레이트 리밋(5)은 쿠폰 받기를 회원 ID로 세야 해서 주체 결정 뒤에 둔다. 로그인·비회원 조회는 IP로 센다.
- 세 단독 줄(`.limited`·`.mismatch`·`.denied`)은 모두 오류 응답으로 끝나는 분기다. 줄 순서 규칙상 사슬을 먼저 쓰고 분기를 뒤에 썼다 — 실제로는 각 단계에서 바로 끝난다.

### JF-1.1 주체 결정 — SessionAuthFilter.doFilter

```jobflow
orchestrator: SessionAuthFilter
Object: SessionAuthFilter, CookieReader, MemberApi, OrderApi, PrincipalHolder

SessionAuthFilter.doFilter --> CookieReader.read
CookieReader.read.sessionId --> MemberApi.authenticate
MemberApi.authenticate.result --> PrincipalHolder.setSession
MemberApi.authenticate.anonymous --> PrincipalHolder.setAnonymous
CookieReader.read.guestToken --> OrderApi.resolveGuestToken
OrderApi.resolveGuestToken.guest --> PrincipalHolder.setGuest
OrderApi.resolveGuestToken.invalid --> PrincipalHolder.setAnonymous
CookieReader.read.none --> PrincipalHolder.setAnonymous
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `CookieReader.read` | `D-05`·`D-07` | 경로가 `/api/admin/**`면 `ASID`, 아니면 `SID`를 읽는다. 세션 쿠키가 없으면 비회원 조회 토큰 `GOT`를 본다(`/api/admin/**`에서는 보지 않는다). `cartKey`는 읽지 않는다(cart가 직접 읽는다) |
| `.sessionId` → `MemberApi.authenticate` | `D-05`·`C-02` | 서비스 계약 `authenticate(sessionId)` → `authenticated {principal: Principal{subjectType:'MEMBER'·'ADMIN', subjectId, displayName, role?}, refreshCookie}` 또는 `anonymous`([member 상세 §2](member.md#2-공개-계약)). 유휴 연장은 member 안의 일이고, `refreshCookie`가 오면 이 필터가 응답에 `Set-Cookie`를 다시 쓴다(로그인 유지 쿠키의 `Max-Age` 연장) |
| `.result` → `PrincipalHolder.setSession` | `D-05`·`R-15` | `.result`는 `authenticated` 결과다. 요청 문맥에 회원·운영자 주체를 둔다. `displayName`은 review가 작성자 표시(`authorLabel`)에 쓴다. 로그 문맥에 주체 종류와 ID(개인정보 아님)만 넣는다 |
| `.anonymous` → `PrincipalHolder.setAnonymous` | `D-05` | 세션이 만료·폐기됐다 — 응답에서 그 세션 쿠키를 지운다(`Max-Age=0`) |
| `.guestToken` → `OrderApi.resolveGuestToken` | `D-07`·`C-13` | 서비스 계약 `resolveGuestToken(token)` → `guest {orderIds[]}`·`invalid`([order 상세 §2](order.md#2-공개-계약)). 한 토큰이 같은 브라우저의 비회원 주문을 최대 5개 가리킨다. `.guest`면 `Principal {subjectType:'GUEST', guestOrderIds}`를 둔다 — 요청한 주문이 그 안에 있는지는 order·claim 처리기가 본다 |
| `.none` → `PrincipalHolder.setAnonymous` | `D-05` | 익명 |

- `PrincipalHolder.setAnonymous`로 들어오는 세 화살표는 택일(세션 무효·토큰 무효·쿠키 없음)의 **합류**다 — 요청 한 번에 주체는 하나다.
- 세션 쿠키와 조회 토큰이 함께 오면 세션을 쓴다. 세션이 무효(`.anonymous`)인데 `GOT`도 있으면 이어서 `resolveGuestToken`을 부른다 — 그림에서는 `.anonymous`를 익명으로만 그렸다.
- `MemberApi.authenticate`·`OrderApi.resolveGuestToken`은 각각 요청마다 DB 조회 1회다(상위 `D-05`의 단점). 정적 파일·헬스체크는 이 필터를 지나지 않는다.

### JF-2 기동 — MallApiApplication.main

```jobflow
orchestrator: MallApiApplication
Object: MallApiApplication, AppProperties, MigrationCheck, ModuleWiring, SpaResourceConfig, MallScheduler, ReadinessState

MallApiApplication.main --> AppProperties.validate
AppProperties.validate.missing
MallApiApplication.main --> MigrationCheck.verify
MigrationCheck.verify.behind
MallApiApplication.main --> ModuleWiring.registerModules
MallApiApplication.main --> SpaResourceConfig.register
MallApiApplication.main --> MallScheduler.start
MallApiApplication.main --> ReadinessState.markReady
```

| 노드 | 근거 | 단계 # | 비고 |
|---|---|---|---|
| `AppProperties.validate`·`.missing` | `C-21` | 1 | 환경 변수 → 설정 묶음(§5.1). prod 프로필에서 필수 값이 비면 기동을 멈춘다(빠른 실패). 비밀 값은 로그에 쓰지 않는다 |
| `MigrationCheck.verify`·`.behind` | `C-21` | 2 | prod는 마이그레이션을 실행하지 않고 검사만 한다 — DB 버전이 빌드가 기대하는 버전보다 낮으면 기동을 멈춘다. local·test는 여기서 Flyway `migrate`를 실행한다(§4.1) |
| `ModuleWiring.registerModules` | `D-01` | 3 | 업무 모듈 9개의 빈 생성·주입(스프링 컴포넌트 스캔). 순환 의존이 있으면 여기서 실패한다 |
| `SpaResourceConfig.register` | `C-21` | 4 | `/`·`/admin` 정적 리소스와 히스토리 폴백 등록([3.2](#32-정적-파일과-히스토리-폴백)) |
| `MallScheduler.start` | `C-21` | 5 | 주기 작업 여섯을 등록한다(`JF-3`). 첫 실행은 기동 끝난 뒤 한 주기 지나서다 |
| `ReadinessState.markReady` | `C-21` | 6 | readiness를 `UP`으로 — 이때부터 부하 분산기가 요청을 보낸다 |

- **트리거** 프로세스 시작(배포·재시작). **완료 사실** readiness `UP`. 단계 1·2의 단독 줄은 기동 실패로 끝나는 분기다(프로세스 종료 코드 ≠ 0).
- 이 그림은 줄 순서가 곧 기동 순서다. 실제로는 Spring 컨텍스트가 단계 1~4를 한 번의 `refresh`에서 하고, 단계 5·6은 `ApplicationReadyEvent` 뒤다.
- **종료** `server.shutdown=graceful` — readiness를 내리고 진행 중 요청을 최대 30s 기다린다. 도는 주기 작업은 끝까지 두고, 잠금은 `JF-3.1`이 풀거나 `lockAtMostFor`가 지나면 풀린다.

### JF-3 주기 작업 — MallScheduler

```jobflow
orchestrator: MallScheduler
Object: MallScheduler, OrderJobs, NotificationJobs, RetentionTask, MemberApi, CartApi, ReviewApi

MallScheduler.runOrderExpiry --> OrderJobs.onExpiryTick
MallScheduler.runReconcile --> OrderJobs.onReconcileTick
MallScheduler.runDeliveryTracking --> OrderJobs.onDeliveryTick
MallScheduler.runNotificationDispatch --> NotificationJobs.onDispatchTick
MallScheduler.runRetention --> RetentionTask.purgeExpired
MallScheduler.runWithdrawalCleanup --> MemberApi.listWithdrawnSince
MallScheduler.runWithdrawalCleanup --> CartApi.purgeMembers
MallScheduler.runWithdrawalCleanup --> ReviewApi.anonymizeAuthors
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `runOrderExpiry` → `OrderJobs.onExpiryTick` | `R-20`·`C-14` | 1분(앞 실행이 끝난 뒤부터 — fixedDelay), 시간 예산 3분. 상위 `Order.OnExpiryTick` |
| `runReconcile` → `OrderJobs.onReconcileTick` | `R-18`·`C-10` | 1분, 시간 예산 3분. 상위 `Order.OnReconcileTick`. `CANCELLING`·`NET_CANCELLING` 닫기와 입금 대기 주기 조회도 같은 계약 안이다(order 상세). 결론을 못 내는 주문의 경보 `RECONCILE_STUCK`은 order가 남긴다 |
| `runDeliveryTracking` → `OrderJobs.onDeliveryTick` | `R-24`·`C-15` | 30분, 시간 예산 3분. 상위 `Order.OnDeliveryTick` |
| `runNotificationDispatch` → `NotificationJobs.onDispatchTick` | `R-22`·`D-06` | 10초, 시간 예산 1분(한 번에 20건씩 — notification 상세). 상위 `Notification.OnDispatchTick` |
| `runRetention` → `RetentionTask.purgeExpired` | `R-25`·`R-26`·`C-20`·`C-08` | 매일 03:30(Asia/Seoul), 시간 예산 4분. `RetentionTask`를 구현한 모듈 빈 아홉(member·catalog·promotion·cart·order·payment·claim·review·notification — 각 상세 §4가 대상)을 이름 순으로 하나씩 부르고 `PurgeResult {task, deleted}`를 INFO 로그로 남긴다. 한 모듈이 실패해도 다음 모듈을 부른다. 30일 안 쓴 비회원 장바구니 삭제(cart)와 안 쓰인 리뷰 사진 정리(review)도 이 작업 안의 구현이다 |
| `runWithdrawalCleanup` → `MemberApi.listWithdrawnSince` → `CartApi.purgeMembers`·`ReviewApi.anonymizeAuthors` | `R-26`·`C-20` | 매일 04:30, 시간 예산 4분. 지난 48시간 안에 탈퇴한 회원 ID를 쪽 단위로 받아 두 계약에 넘긴다 — 두 계약이 멱등이라 기간이 겹쳐도 되고, 커서를 저장하지 않아 조립 지점에 상태가 생기지 않는다. 이틀 연속 실패하면 경보 로그를 남긴다. member가 다른 모듈을 부르지 않게 조립 지점이 잇는다 |

- **트리거** 스케줄러 스레드의 주기. **완료 사실** 각 계약 1회 호출 — 몇 건을 처리할지(디스패치 20건 등)는 모듈이 정한다.
- 여섯 작업은 모두 `JF-3.1`의 단일 실행 잠금을 지난다. 그림에서 뺐다.
- **시간 예산**: 작업마다 예산을 두고 예산을 넘으면 새 건을 고르지 않고 돌아온다 — 하던 건은 끝낸다. `OrderJobs`·`NotificationJobs`는 건 사이에 경과 시간을 보고(예산 값은 각 모듈 설정 — 위 값이 기본), 보존·탈퇴 정리는 `MallScheduler`가 구현·쪽 사이에 본다(남은 구현은 다음 날 — §8). 잠금 `lockAtMostFor`는 예산보다 긴 5분이라, 예산을 지킨 실행은 잠금이 풀리기 전에 끝난다(§6).
- 모듈 계약은 「한 번 돌리기」만 한다. 주기·시각·잠금은 조립 지점의 설정이다(§6) — 그래서 시험에서는 계약을 직접 불러 시계를 옮긴다.
- 스케줄러 스레드는 4개다(§6). Spring 기본값 1개면 하루 1회 보존 작업이 도는 동안 10초 디스패치와 1분 대사가 멈춘다.

### JF-3.1 단일 실행 잠금 — LockedJobRunner.run

```jobflow
orchestrator: LockedJobRunner
Object: LockedJobRunner, LockProvider, JobContext, ScheduledTask

LockedJobRunner.run --> LockProvider.lock
LockProvider.lock.busy
LockProvider.lock.acquired --> JobContext.begin
JobContext.begin.result --> ScheduledTask.execute
ScheduledTask.execute.failed --> JobContext.logFailure
JobContext.logFailure --> LockProvider.unlock
ScheduledTask.execute.result --> LockProvider.unlock
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `LockProvider.lock`·`.busy` | `C-21` | 잠정 ShedLock JDBC — `shedlock` 표의 작업 이름 행을 `lock_until > now`가 아니면 갱신한다(조건부 UPDATE, 한 행만 이긴다). 다른 인스턴스가 쥐고 있으면 `.busy` — 이번 주기를 건너뛴다(로그 DEBUG) |
| `JobContext.begin` | `C-21` | 요청 ID 자리에 `job-<작업 이름>-<uuid>`를 로그 문맥에 넣고 시작 시각을 잰다 |
| `ScheduledTask.execute` | `C-21` | `JF-3`의 모듈 계약 하나. 트랜잭션은 모듈 계약이 연다(§6.1) |
| `.failed` → `JobContext.logFailure` | `C-21` | 예외를 ERROR 로그(작업 이름·소요·요청 ID)로 남긴다. 다시 부르지 않는다 — 다음 주기가 재시도다 |
| `LockProvider.unlock` | `C-21` | `lock_until`을 `max(now, 시작 + lockAtLeastFor)`로 돌린다 — 짧은 작업이 다른 인스턴스에서 바로 다시 도는 것을 막는다 |

- `LockProvider.unlock`으로 들어오는 두 화살표는 실패·성공 택일의 **합류**다(`finally`) — 실행 한 번에 풀기는 한 번이다.
- 프로세스가 작업 중에 죽으면 풀기가 없다 — `lockAtMostFor`(작업마다, §6)가 지나면 다른 인스턴스가 잡는다. 그 사이 같은 작업이 두 번 돌지 않게 하는 두 번째 방어는 각 모듈의 조건부 전이다(상위 §5.8·§6.3).

### 3.1 요청 처리 단계

| 단계 # | 구성 | 하는 일 | 끊기는 응답 |
|---|---|---|---|
| 1 | `RequestLogFilter` | 요청 ID(받은 값이 형식에 맞으면 쓰고 아니면 UUID), 로그 문맥, 끝에 접근 로그. 요청 본문은 남기지 않는다 | — |
| 2 | `SessionAuthFilter` | 주체 결정 — `JF-1.1` | — |
| 3 | `AccessRuleFilter` | 경로 규칙 [2.2](#22-라우트-등록-규칙) — `/api/admin/**`(로그인 제외)는 운영자 주체(`subjectType:'ADMIN'`, 역할 무관 — 역할별 제한은 미확정 §8), 그 밖은 표대로. 표에 없는 `/api/**`는 거부 | 401 `UNAUTHENTICATED`, 403 `FORBIDDEN` |
| 4 | `CsrfFilter` | `POST`·`PUT`·`PATCH`·`DELETE`의 이중 제출 비교. 제외: `/api/webhooks/**`(PG가 부른다 — 서명으로 확인, 상위 `C-11`). 응답에 `XSRF-TOKEN` 쿠키가 없던 요청이면 새 토큰을 심는다. 로그인 성공 응답에서는 토큰을 바꾼다 | 403 `CSRF_INVALID` |
| 5 | `RateLimitFilter` | §6 표의 경로만 | 429 `RATE_LIMITED` |
| 6 | 모듈 컨트롤러 | 입력 검사(Bean Validation) → 모듈 서비스 | 모듈 오류 |
| 7 | `ApiErrorHandler` | 예외 → [2.3](#23-오류-응답-형식) | — |

- 웹훅 처리기는 서명 검증에 원문 바이트가 필요해 본문을 `byte[]`로 받는다 — 앞 단계가 본문을 읽지 않는다(단계 1이 본문을 남기지 않는 이유 중 하나다). 웹훅 본문 상한은 256KB다.
- 소셜 로그인 콜백(`GET /api/oauth/{provider}/callback`)은 `GET`이라 CSRF 검사 대상이 아니다 — 위조는 member의 `state` 검사가 막는다(상위 `R-04`).

### 3.2 정적 파일과 히스토리 폴백

| 요청 | 처리 |
|---|---|
| `GET` 경로에 확장자가 있음(`.js`·`.css`·`.png`…) | `static/storefront/` 또는 `/admin/`이면 `static/admin/`에서 찾는다. 없으면 404(HTML로 폴백하지 않는다 — 깨진 자산이 HTML로 오면 화면이 조용히 망가진다) |
| `GET /admin`·`/admin/**`이고 확장자 없음, `Accept`에 `text/html` | `static/admin/index.html` |
| `GET` 그 밖 경로(`/api/**`·`/actuator/**` 제외)이고 확장자 없음, `Accept`에 `text/html` | `static/storefront/index.html` |
| `/api/**`의 미등록 경로 | 404 JSON(SPA로 폴백하지 않는다) |

- `index.html`은 `Cache-Control: no-cache`, 해시 붙은 자산은 1년 `immutable` — 배포 직후 옛 화면이 남지 않게 한다.
- 보안 머리글: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `/admin/**`는 `X-Frame-Options: DENY`. 고객 화면의 CSP는 PG·본인인증·우편번호 스크립트 출처를 허용해야 해 업체를 정한 뒤 정한다(§8).

## 4. 소유 상태·데이터

업무 상태는 없다 — 세션은 member, 그 밖 업무 테이블은 각 모듈이 소유한다(상위 [§3](../system-design-to-be.md#3-구조--무엇으로-이뤄져-있나)). 조립 지점이 쓰는 것은 운영용 기반 데이터뿐이다.

| 표 | 주요 열 | 비고 |
|---|---|---|
| `shedlock` | `name`(PK, 작업 이름), `lock_until`, `locked_at`, `locked_by`(호스트 이름) | 주기 작업 단일 실행 잠금(`JF-3.1`). 행은 작업 여섯 개뿐이고 지우지 않는다 |
| `flyway_schema_history` | `version`, `description`, `script`, `checksum`, `installed_on`, `success` | Flyway가 쓴다. 모든 모듈의 마이그레이션이 이 표 하나에 기록된다 |

| 데이터 | 경로 | 쓰기 주체 | 생명주기·보존 | 원자성 |
|---|---|---|---|---|
| 레이트 리밋 버킷 | 인스턴스 메모리(잠정 Bucket4j) | `RateLimitFilter` | 키별 마지막 사용 뒤 10분이면 버린다. 재시작하면 사라진다 | 인스턴스 안에서만 — 인스턴스가 N개면 한도가 최대 N배(§8) |
| 접근·작업 로그 | 표준 출력(JSON 한 줄) | `RequestLogFilter`, `JobContext`, 모든 로거 | 보존은 수집 쪽(운영 주체) — 미확정 | 해당 없음 |

### 4.1 마이그레이션 배치

- **폴더**: `src/main/resources/db/migration/<module>/` — 모듈마다 하나, 조립 지점 것은 `common/`(`shedlock`). Flyway `locations`에 폴더 열 개를 모두 준다.
- **버전**: `V<yyyyMMddHHmm>__<module>_<설명>.sql`(예: `V202610201030__order_create_orders.sql`). 모듈별로 나눠 쓰는 사람이 같은 번호를 고르지 않게 시각을 버전으로 쓴다. 기록 표가 하나라 버전은 전체에서 유일해야 한다.
- **테이블 소유**: 테이블 이름에 모듈 접두를 붙이지 않는다 — 상위 §3이 정한 이름(`orders`·`skus`·`sessions`…)을 그대로 쓴다. 대신 `TableOwnershipTest`가 상위 §3의 「소유 상태」 칸을 옮긴 소유 목록(`TableOwnership`)으로 검사한다(§7.1). 접두를 둘지는 §8 미확정이다.
- **모듈 사이 외래 키 금지**: 모듈 X의 마이그레이션은 X 소유 테이블만 `CREATE`·`ALTER`·`REFERENCES`한다. 다른 모듈 행은 ID 값으로만 가리킨다(예: `order_lines.sku_id`는 FK 없음). 그래야 모듈을 나중에 떼어 낼 때 스키마가 따라 끊긴다(상위 `D-01` 근거).
- **추가만 하는 변경**: 열 추가·새 표만 한 배포에 넣는다. 열 삭제·이름 변경은 두 배포로 나눈다(상위 [§9.3](../system-design-to-be.md#93-이행롤백)). 새 마이그레이션 파일에 `DROP`·`RENAME`이 있으면 시험이 실패한다(§7).
- **실행 시점**: prod는 배포 1단계에서 따로 `flyway migrate`를 돌리고(상위 §9.3 순서 ①), 앱은 검사만 한다(`JF-2` 단계 2). local·test는 앱 기동 때 실행한다.

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| member | `MemberApi.authenticate(sessionId)` — 요청마다 | `api` 인터페이스 주입 | DB 쿼리 타임아웃(§6) | 어느 쿠키를 넘길지는 조립 지점, 세션 값·수명·역할·`displayName`은 member. `Principal.role` 값이 늘면 [2.2](#22-라우트-등록-규칙) 규칙도 는다 |
| order | `OrderApi.resolveGuestToken(token)` — 세션 없이 `GOT`가 온 요청마다 | 같음 | 같음 | 토큰 형식·수명·가리키는 주문 수(최대 5)는 order. 조립 지점은 결과(`guest {orderIds[]}`·`invalid`)만 주체로 둔다 |
| order | `OrderJobs.onExpiryTick()`·`onReconcileTick()`·`onDeliveryTick()` | 같음 | 시간 예산 3분, `lockAtMostFor` 5분(§6) | 주기·잠금은 조립 지점, 처리량·대상·예산 안의 중단은 order |
| notification | `NotificationJobs.onDispatchTick()` | 같음 | 시간 예산 1분, `lockAtMostFor` 5분 | 같음 |
| member·cart·review(탈퇴 정리) | `MemberApi.listWithdrawnSince(since, page)` → `CartApi.purgeMembers(memberIds)`·`ReviewApi.anonymizeAuthors(memberIds)` | 같음 | 시간 예산 4분 | 두 정리 계약은 멱등. member는 cart·review를 모른다 |
| `RetentionTask` 구현 아홉(member·catalog·promotion·cart·order·payment·claim·review·notification) | `purgeExpired(now)` → `PurgeResult {task, deleted}` | 같은 인터페이스의 빈 전부 | 시간 예산 4분 | 파기 대상·기간·한 번에 지울 양은 각 모듈(상위 §6.2) |
| 업무 모듈 9개 | HTTP 라우트(컨트롤러) | 컴포넌트 스캔 + [2.2](#22-라우트-등록-규칙) 규칙 | 트랜잭션 기본 10s(§6) | 조립 지점은 업무 계약을 부르지 않는다 — 라우팅만 한다 |
| MySQL 8 | JDBC(커넥션 풀) | `DB_URL`·`DB_USER`·`DB_PASSWORD` | 연결 3s | 모든 모듈이 같은 풀을 쓴다 |
| storefront-web·admin-web | 빌드 산출물 | 빌드 때 `dist/`를 `static/storefront/`·`static/admin/`로 복사(Gradle 작업) | — | 화면 빌드가 깨지면 mall-api jar도 만들지 않는다 |

### 5.1 설정·비밀

모든 비밀은 환경 변수로만 받는다 — 저장소·jar·이미지에 넣지 않는다. 설정 파일(`application.yml`)은 `${ENV_NAME}` 자리표시자만 갖는다. 프로필은 `local`·`test`·`prod` 셋이다.

| 환경 변수 | 쓰는 모듈 | prod 필수 | 비고 |
|---|---|---|---|
| `DB_URL`·`DB_USER`·`DB_PASSWORD` | 전체 | 예 | |
| `APP_BASE_URL` | member·order·notification | 예 | 소셜 콜백·PG 복귀 주소·알림톡 링크의 앞부분 |
| `PG_SECRET_KEY`·`PG_WEBHOOK_SECRET` | payment | 예 | 승인·취소 인증, 웹훅 서명(가정 — 업체 미정) |
| `PG_CLIENT_KEY` | storefront-web(설정 API로 전달) | 예 | 결제창용 공개 키 — 비밀 아님 |
| `KAKAO_CLIENT_ID`·`KAKAO_CLIENT_SECRET`·`NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET` | member | 예 | |
| `IDV_API_KEY` | member | 예 | 본인인증 결과 조회(가정) |
| `ALIMTALK_API_KEY`·`ALIMTALK_SENDER_KEY` | notification | 예 | |
| `TRACKER_API_KEY` | order | 예 | 택배 조회 |
| `STORAGE_BUCKET`·`STORAGE_ACCESS_KEY`·`STORAGE_SECRET_KEY`·`STORAGE_ENDPOINT` | catalog·review | 예 | 업로드 URL 서명 |
| `RATE_LIMIT_*`, `SCHEDULER_*` | 조립 지점 | 아니오 | 기본값은 §6 |

- `AppProperties`가 모듈별 설정 묶음(`@ConfigurationProperties` + 검증)을 만들어 그 모듈에만 주입한다 — 모듈은 다른 모듈의 비밀을 받지 않는다.
- 로그에 비밀·개인정보를 쓰지 않는다. 설정 묶음의 `toString`은 비밀 칸을 `***`로 바꾼다.
- local은 외부 업체 대신 가짜 어댑터(가짜 PG·가짜 알림톡)를 쓴다 — 비밀 없이 기동된다.

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| HTTP 작업 스레드 | 최대 200 | `server.tomcat.threads.max` | 내장 Tomcat |
| 요청 본문 상한 | 1MB(웹훅 256KB) — 이미지는 서버를 거치지 않는다 | `spring.servlet.multipart.*`, `MALL_WEBHOOK_MAX_BYTES` | `RequestLogFilter`, 웹훅 처리기 |
| DB 커넥션 풀 | 최대 20, 연결 대기 3s | `spring.datasource.hikari.maximum-pool-size`·`connection-timeout` | Hikari |
| 트랜잭션 기본 타임아웃 | 10s | `spring.transaction.default-timeout` | 모든 `@Transactional` |
| 스케줄러 스레드 | 4 | `spring.task.scheduling.pool.size` | `MallScheduler` |
| 작업 시간 예산 | 만료·대사·배송 추적 3m, 디스패치 1m, 보존·탈퇴 정리 4m | 모듈 작업은 각 모듈 설정(order·notification 상세 §6), 보존·탈퇴 정리는 `SCHEDULER_<JOB>_BUDGET` | `OrderJobs`·`NotificationJobs`·`MallScheduler` — `JF-3` |
| 작업 잠금 `lockAtMostFor` / `lockAtLeastFor` | 모든 작업 5m / 만료·대사 30s, 배송 1m, 디스패치 5s, 보존·탈퇴 정리 1m | `SCHEDULER_<JOB>_LOCK_MOST`·`_LEAST` | `JF-3.1` |
| 레이트 리밋 — 로그인 | `POST /api/auth/login`·`POST /api/admin/auth/login` IP당 분당 20 | `RATE_LIMIT_LOGIN_PER_MIN` | `RateLimitFilter` |
| 레이트 리밋 — 비회원 조회 | `POST /api/guest/orders/lookup` IP당 분당 10 | `RATE_LIMIT_GUEST_LOOKUP_PER_MIN` | 같음 |
| 레이트 리밋 — 쿠폰 받기 | `POST /api/coupons/{couponId}/download` 회원당 분당 30 | `RATE_LIMIT_COUPON_PER_MIN` | 같음 |
| 레이트 리밋 — 본인인증 조회 | `POST /api/members/check-duplicate`·`POST /api/password/reset` IP당 분당 10 | `RATE_LIMIT_IDV_PER_MIN` | 같음 — 업체 조회 비용이 드는 경로 |
| 우아한 종료 | 30s | `spring.lifecycle.timeout-per-shutdown-phase` | `JF-2` 종료 |

- **레이트 리밋과 업무 잠금은 다르다**: 레이트 리밋은 인스턴스 메모리의 짧은 창이고, 로그인 5회 잠금(member, `R-03`)·비회원 조회 10회 잠금(order, `R-16`)은 DB에 남는 업무 규칙이다. 레이트 리밋은 대량 시도를 싸게 끊는 앞단 방어일 뿐이다. IP는 부하 분산기가 넣는 `X-Forwarded-For`의 신뢰 구간 값을 쓴다(`server.forward-headers-strategy`).
- **인증** `/api/admin/**`는 운영자 주체만(`AccessRuleFilter`), 상태 변경은 CSRF 이중 제출(웹훅 제외), 세션 쿠키는 httpOnly·Secure·SameSite=Lax. 웹훅은 무인증 경로이고 payment의 서명 검증과 PG 조회가 방어다(상위 `C-11`).
- **동시성** 여러 인스턴스에서 같은 주기 작업은 하나만 돈다(`JF-3.1`). 같은 요청의 경합(두 번 누름 등)은 모듈의 조건부 전이가 막는다 — 조립 지점은 요청을 줄 세우지 않는다.
- **최후 방어** 처리하지 못한 예외는 500 `INTERNAL_ERROR {requestId}` + ERROR 로그. 주기 작업 실패는 로그만 남기고 다음 주기에 다시 돈다.

### 6.1 트랜잭션 규칙

상위 [§6.3](../system-design-to-be.md#63-트랜잭션-경계)의 원자 구간을 코드 규칙으로 옮긴 것이다.

| 규칙 | 어떻게 | 근거 |
|---|---|---|
| 경계는 조율 모듈의 유스케이스 메서드다 | order·claim의 유스케이스(`CheckoutService.placeOrder` 등)가 원자 구간 하나마다 트랜잭션을 연다. 컨트롤러·필터·조립 지점은 트랜잭션을 열지 않는다 | `D-01`·`D-02` |
| 외부 HTTP가 끼는 유스케이스는 구간을 나눈다 | 결제 승인처럼 「상태 전이 → PG 호출 → 확정」인 메서드는 메서드 전체에 `@Transactional`을 달지 않고, 구간마다 `TransactionTemplate.execute`로 연다. PG 호출은 두 구간 사이다 | 상위 §6.3 원자 구간 2·3 |
| 워커의 공개 계약은 호출자 트랜잭션에 참여한다 | 조율자가 부르는 계약(`CatalogApi.reserveStock`·`commitReservation`·`releaseStock`, `PromotionApi.lockCoupons`·`useCoupons`·`releaseCoupons`, `CartApi.removeItems`, `NotificationApi.enqueue`, `OrderApi.markLineClaim`)은 `@Transactional(propagation = MANDATORY)` — 트랜잭션 없이 부르면 예외라 잘못 쓴 곳이 바로 드러난다 | `D-02`·`D-06` |
| 워커 자신의 라우트는 자기 트랜잭션을 연다 | 운영자 상품 저장·쿠폰 받기처럼 한 모듈만 바꾸는 유스케이스는 그 모듈 서비스가 `REQUIRED`로 연다 | `D-01` |
| 외부 HTTP는 트랜잭션 밖에서만 | 외부 어댑터(PG·택배·알림톡·본인인증·소셜)는 호출 전에 `TransactionGuard.assertNone()`. 트랜잭션 안이면 local·test는 예외, prod는 ERROR 로그 | 상위 §6.3 결론 |
| 조회는 읽기 전용 | `@Transactional(readOnly = true)` | — |
| 주기 작업은 계약이 연다 | `MallScheduler`는 트랜잭션을 열지 않는다. 대사처럼 건마다 외부 호출이 끼는 작업은 건마다 구간을 연다 — 한 건의 실패가 다른 건을 되돌리지 않는다 | 상위 §5.8 |

- 저장소 업로드 URL 서명은 네트워크 호출이 없는 계산이라 감시 대상에서 뺐다.
- 상태 전이의 경합은 격리 수준이 아니라 조건부 갱신(`UPDATE … WHERE status = ?`의 바뀐 행 수)으로 판정한다 — MySQL 기본 격리(REPEATABLE READ)를 바꾸지 않는다.

### 6.2 로깅·요청 ID

- 형식: JSON 한 줄(잠정 Logback + JSON 인코더). 공통 칸 — 시각·수준·로거(모듈 패키지)·`requestId`·`principalKind`·`principalId`·메시지.
- 요청 ID: 받은 `X-Request-Id`가 형식에 맞으면 쓰고 아니면 새 UUID. 모듈이 외부 업체를 부를 때 업체가 받는 추적 머리글이 있으면 같은 값을 넣는다(가정 — 업체마다 다르다). 주기 작업은 `job-<이름>-<uuid>`.
- 개인정보: 이름·휴대폰·주소·이메일·카드 정보·비밀번호·토큰은 쓰지 않는다. 요청·응답 본문은 남기지 않는다. 외부 응답 원문 보관은 payment의 표(상위 §6.2)이지 로그가 아니다.
- 수준: 4xx는 INFO 접근 로그만, 5xx·작업 실패·`TX_EXTERNAL_CALL`은 ERROR, 대사 경보는 WARN `RECONCILE_STUCK`(order가 남긴다 — 결론 없이 오래 머문 주문, `MANUAL_REVIEW` 전환).

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 모듈 경계 | `D-01` — 다른 모듈 `internal` 참조, 허용하지 않은 모듈 의존, 순환 | `./gradlew test --tests '*ModuleBoundaryTest'`(§7.1 규칙 1~4) | 상위 §9.1 순서 1부터 매 빌드 |
| 라우트 소유 | [2.2](#22-라우트-등록-규칙) | `RouteOwnershipTest` — 모든 컨트롤러 매핑이 자기 모듈 패턴 안, 모든 `/api/**` 매핑이 접근 규칙을 가짐 | 매 빌드 |
| 테이블 소유 | 상위 §3 소유 상태, §4.1 | `TableOwnershipTest` — 마이그레이션·엔티티·SQL 문자열의 테이블 이름 대조(§7.1 규칙 5~6) | 매 빌드 |
| 파이프라인 | `JF-1`·`JF-1.1`, [2.3](#23-오류-응답-형식) | 통합 시험(MockMvc + 가짜 `Member`): 세션 없는 `/api/admin/orders` → 401 / 회원 세션으로 `/api/admin/orders` → 401(`ASID` 없음) / 운영자 세션 + CSRF 없음 `POST` → 403 `CSRF_INVALID` / 웹훅 CSRF 없이 통과 / 로그인 21회째 → 429 + `Retry-After` / 모든 오류 본문이 `{code, message, details}` / 응답에 `X-Request-Id` / 미등록 `/api/x` → 404 JSON | 순서 1 |
| 401 뒤 무효과 | `JF-1` 「401이 처리기 앞에서 정해진다」 | 세션 없는 `POST /api/admin/orders/{id}/shipments` → 401이고 order 서비스 호출 0회 | 순서 1 |
| SPA 폴백 | [3.2](#32-정적-파일과-히스토리-폴백) | `/mypage/orders`·`/admin/claims/1` → 각 `index.html`, `/assets/없는.js` → 404, `/api/없음` → 404 JSON | 순서 1 |
| 단일 실행 잠금 | `JF-3.1` | 시험 DB(잠정 Testcontainers MySQL)에 앱 컨텍스트 둘을 띄우고 같은 작업을 동시에 시작 → 모듈 계약 호출 1회. 실행 중 한쪽을 죽이면 `lockAtMostFor` 뒤 다른 쪽이 잡는다 | 순서 1 |
| 스케줄러 막힘 없음 | `JF-3` 스레드 4 | 보존 작업을 60s 붙잡아 둔 동안 디스패치 계약이 10초마다 불린다 | 순서 1 |
| 트랜잭션 감시 | §6.1 | `@Transactional` 안에서 가짜 PG 어댑터 호출 → test 프로필 예외. 워커 `MANDATORY` 계약을 트랜잭션 없이 호출 → 예외 | 순서 1, 각 모듈 작업 |
| 마이그레이션 | §4.1 | 빈 MySQL에 전체 `migrate` 성공 / 새 파일에 `DROP`·`RENAME` → 실패 / 같은 버전 두 파일 → 실패 | 매 빌드 |
| 기동 실패 | `JF-2` 단계 1·2 | prod 프로필에서 `PG_SECRET_KEY` 비움 → 기동 실패, DB 버전 낮음 → 기동 실패, readiness는 그 전까지 `UP`이 아님 | 순서 1 |
| 접근 규칙 | [2.2](#22-라우트-등록-규칙) 접근 규칙 표 | 익명으로 `POST /api/members/check-duplicate`·`/api/signup`·`/api/signup/social`·`/api/password/reset`·`/api/orders/preview`·`/api/orders`·`/api/guest/orders/lookup` → 401이 아님(처리기 도달), 익명 `GET /api/members/me` → 401, `GUEST` 주체로 `GET /api/orders/{id}`·`POST /api/payments/{paymentKey}/approve`·`POST /api/orders/{id}/claims/return` → 처리기 도달, `GUEST`로 `GET /api/orders` → 401 | 순서 1 |
| 시간 예산 | `JF-3` 「시간 예산」 | 가짜 `RetentionTask` 셋 중 첫째가 4분 30초 걸리게 하면 둘째부터 그날 건너뛰고 WARN, 실행은 `lockAtMostFor`(5분) 전에 끝나 잠금을 스스로 푼다. 가짜 시계로 예산 1분을 넘긴 디스패치가 새 건을 고르지 않음(notification 상세 §7) | 순서 1 |
| 세션 쿠키 분리 | [2](#2-공개-계약) `SID`·`ASID` | 같은 쿠키 저장소로 고객·운영자 로그인 → 두 세션 모두 유효, 운영자 로그아웃 뒤 고객 세션 유효 | member 작업 뒤 |

### 7.1 모듈 경계 검사 규칙

잠정 ArchUnit(JUnit 5)으로 쓴다. 대안 Spring Modulith의 `ApplicationModules.verify()`도 「다른 모듈의 하위 패키지 참조 금지」를 검사하지만, 교육용이라 규칙이 시험 코드에 그대로 보이는 ArchUnit을 잠정으로 골랐다.

| # | 규칙 | 검사 방법 |
|---|---|---|
| 1 | 다른 모듈의 `internal`을 참조하지 않는다 | 모듈마다 `noClasses().that().resideOutsideOfPackage("com.openmall.<m>..").should().dependOnClassesThat().resideInAPackage("com.openmall.<m>.internal..")` — 모듈 목록으로 반복 생성 |
| 2 | 허용한 방향으로만 의존한다 | 허용 표 — order → catalog·promotion·cart·payment·notification, claim → order·payment·catalog·notification, review → order, member → order, cart → catalog, 그 밖 모듈 → 없음(상위 [§3](../system-design-to-be.md#3-구조--무엇으로-이뤄져-있나)). 모듈 X가 표에 없는 모듈의 `api`를 참조하면 실패 |
| 3 | 순환이 없다 | `slices().matching("com.openmall.(*)..").should().beFreeOfCycles()` |
| 4 | `api`는 깨끗하다 | `com.openmall.*.api..`는 `..internal..`·`jakarta.persistence..`·`org.springframework.web..`에 의존하지 않는다. `common`은 어느 모듈에도 의존하지 않는다. 조립 지점 `app`은 모듈의 `api`와 컨트롤러 스캔 말고는 모듈을 참조하지 않는다 |
| 5 | 다른 모듈 테이블에 접근하지 않는다 — 매핑 | 모듈 X 안의 `@Entity`·`@Table` 이름이 소유 목록(`TableOwnership` — 상위 §3 「소유 상태」 칸을 옮긴 것)의 X 몫에 있어야 한다 |
| 6 | 다른 모듈 테이블에 접근하지 않는다 — SQL | ① 모듈 X 마이그레이션 폴더의 `CREATE TABLE`·`ALTER TABLE`·`REFERENCES` 대상이 X 몫인지 SQL 파일을 읽어 대조한다. ② 모듈 X 클래스의 문자열 상수(`@Query`·`JdbcTemplate`에 쓴 SQL)에서 `FROM`·`JOIN`·`UPDATE`·`INTO` 뒤 이름을 뽑아 X 몫인지 대조한다 |

- 규칙 6-②는 문자열을 이어 붙여 만든 SQL을 놓친다 — 이어 붙인 SQL은 금지 규칙으로 두고 리뷰로 본다(§8). JPQL은 엔티티 이름이라 규칙 5가 막는다(다른 모듈 엔티티는 규칙 1로 참조할 수 없다).
- 조립 지점의 테이블(`shedlock`·`flyway_schema_history`)은 소유 목록의 `common` 몫이다.

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `D-01` | 위험 | 모듈 경계가 컴파일러가 아니라 시험으로 지켜진다. 규칙 6-②는 이어 붙인 SQL을 못 잡는다 | 상위 `D-01` 단점, §7.1 | 시험을 매 빌드에 넣고 SQL 이어 붙이기를 금지한다. 더 강하게 하려면 모듈마다 Gradle 하위 프로젝트로 나눠 `internal`을 컴파일 단계에서 막는다 — 빌드가 복잡해져 지금은 미룬다 |
| `D-05`·`C-02` | 위험 | 고객·운영자 세션이 같은 오리진의 한 쿠키를 쓰면 서로 덮는다 | 상위 `D-05`, `D-01`(같은 오리진) | `ASID`(`Path=/api/admin`)로 나눴다 — member 상세 §4.2가 같은 이름을 쓴다 |
| `C-21` | 위험 | CSRF 이중 제출 쿠키는 같은 상위 도메인의 다른 하위 도메인이 덮어쓸 수 있다 | §3.1 단계 4 | 하위 도메인을 쓰지 않으면 문제없다. 쓸 일이 생기면 쿠키 이름을 `__Host-XSRF-TOKEN`으로 바꾸거나 토큰을 세션에 묶는다 |
| `C-21` | 위험 | 레이트 리밋이 인스턴스 메모리라 인스턴스 N개면 한도가 최대 N배다 | §4 | 교육용 단일·소수 인스턴스라 잠정 허용. 업무 잠금(로그인 5회·비회원 조회 10회)은 DB라 영향이 없다. 늘리면 DB·Redis 버킷으로 바꾼다 |
| `C-21`·`D-04` | 위험 | 작업 중 프로세스가 죽으면 `lockAtMostFor` 동안 그 작업이 멈춘다(대사·만료 최대 5분) | `JF-3.1` | `R-18`의 「10분 안에 대사」 안에 든다. 조건부 전이가 두 번째 방어다 |
| `C-02`·`R-21` | 미확정 | 운영자 역할별 경로 제한 | member·admin-web 상세와 같이 잠정 `ADMIN` 하나다 | `/api/admin/**`는 운영자 주체면 허용. 역할을 나누면 [2.2](#22-라우트-등록-규칙)에 역할별 허용 경로를 더한다 |
| `C-20` | 미확정 | 보존 작업 시각·순서와 한 번에 지울 양 | `JF-3` | 잠정 03:30, 모듈 이름 순, 한도는 각 모듈, 작업 예산 4분. 지울 양이 많으면 모듈이 건수 한도로 나눠 여러 날에 걸친다. 예산을 넘으면 남은 구현은 그날 건너뛰고 WARN 로그를 남긴다 — 다음 날 다시 첫 구현부터라, 앞 모듈이 계속 예산을 다 쓰면 뒤 모듈(이름 순 뒤쪽)이 밀린다. 그런 일이 보이면 시작 위치를 날마다 돌리거나 예산을 늘린다 |
| `C-21` | 미확정 | 고객 화면 CSP | §3.2 | PG·본인인증·우편번호 스크립트 출처가 업체 선정에 달려 있다(상위 §9.5) |
| `C-21` | 미확정 | 로그 수집·보존 기간과 경보 연동 | §1 「아무도 하지 않는 것」 | 대사 경보 `RECONCILE_STUCK`·알림 `FAILED`가 로그로만 남는다 — 운영 주체가 수집 도구에서 경보를 걸어야 한다 |
| `D-01` | 미확정 | 테이블 접두를 둘지 | §4.1 | 잠정 접두 없음 + 소유 목록 시험. 접두를 두면 상위 §3의 테이블 이름을 모두 바꿔야 한다 |

## 9. 미확인·한계

1. 코드·실행 환경이 없다 — 필터 순서·설정값·잠금 시간은 설계값이고 실행하지 않았다.
2. Spring Security 필터 사슬에 위 순서(권한 → CSRF)대로 사용자 필터를 넣을 수 있다는 것은 일반 사용법에서 추론했고 확인하지 않았다. 기본 `CsrfFilter`는 인증 필터보다 앞이므로 끄고 `CsrfFilter`(이 설계의 것)를 `AuthorizationFilter` 뒤에 넣는다고 가정했다.
3. ShedLock·Flyway·ArchUnit·Bucket4j의 동작은 각 도구의 일반 사용법 기준이고 이 저장소에서 확인하지 않았다(상위 §9.5 — 스택 미확정).
4. 부하 분산기·인스턴스 수·배포 방식(컨테이너 여부)은 정하지 않았다 — `X-Forwarded-For` 신뢰 구간과 헬스체크 연결은 그때 정한다.
5. [2.2](#22-라우트-등록-규칙)의 경로·접근 규칙과 `RetentionTask` 구현 목록, 주체·타이머 계약 이름은 공통 결정(모듈 공개 인터페이스 `…Api`·`…Jobs`, 익명 허용 경로, `PurgeResult {task, deleted}`, 비회원 토큰 `guest {orderIds[]}`)에 맞췄다.
