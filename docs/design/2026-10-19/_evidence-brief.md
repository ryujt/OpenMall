# 근거 브리프 — 2026-10-19 TO-BE 설계

> 이 파일은 원본을 찾는 색인이다. 요약으로 원본 검증을 대신하지 않는다.
> **상위**: [`to-be/system-design-to-be.md`](to-be/system-design-to-be.md) · **설계 유형**: 신규 설계 — AS-IS 문서·코드가 없다

## 1. 기준선

| 항목 | 값 |
|---|---|
| DATE | 2026-10-19 |
| 기준 커밋 | `6ace327`(2026-10-19 20:34, `main`, 「Initial commit」) — `README.md`·`LICENSE`·`.gitignore`뿐 |
| 브랜치 | `main` |
| 작업 트리 | 미추적 `docs/navigation.md`(사용자 산출물 — 이 설계의 입력) |
| 관찰 시점 | 2026-10-19 |
| 관찰 방법 | 입력 문서 정독과 시나리오 검증(코드 없음). 외부 서비스 계약은 국내 보편 형태를 가정 |
| 설계 유형 | 신규 설계 |
| 입력 근거 | 요구 원문 ①②(사용자 요청), ③ `README.md`, [`docs/navigation.md`](../../navigation.md) N1~N8과 「화면 · API 계약 요약」 표 |

### 1.1 분석 범위

교육용 국내 B2C 단일 판매자 쇼핑몰의 고객 화면·운영자 화면·백엔드와 외부 연동 계약. 입력이 이동 다이어그램 하나라, 이동도에 나온 화면·API를 모두 소유 모듈에 배정하고 그 흐름이 끝나는 데 필요한 기능을 시나리오 검증으로 더했다(핵심 §2.2의 `R-18`~`R-26`). 사용자가 범위를 좁히지 않았으므로 목표 경계 12개 모두에 상세를 둔다.

근거 명령: `git ls-files`(추적 파일 3개), `git status --short`(미추적 `docs/` 하나).

### 1.2 제외한 것과 이유

| 경로 | 이유 | 근거 |
|---|---|---|
| 입점 판매자(오픈마켓)·정산 | 요구 원문과 이동도에 판매자 화면·정산이 없고, 「보편적인 쇼핑몰」의 최소형은 단일 판매자 자사몰이다(판단) | `grep -n "판매자\|입점\|정산" docs/navigation.md` → 없음 |
| 적립금·회원 등급 | 국내몰에 흔하지만 이동도에 없다. 넣으면 promotion에 원장이 생기고 취소·반품 환원이 늘어난다 — 핵심 §9.5에 필요 입력으로 남겼다 | `grep -n "적립\|포인트\|등급" docs/navigation.md` → 없음 |
| 정기배송·다국어·해외 배송·모바일 앱 | 요구 원문과 이동도에 없다 | `grep -n "정기\|해외\|언어\|앱" docs/navigation.md` → 없음 |
| 세금계산서·ERP·물류(WMS) 연동 | 교육용 범위를 넘는다(판단). 송장은 운영자가 직접 입력한다 | 판단 — 근거 위치: 핵심 `R-21`, `grep -n "세금\|ERP\|물류" docs/navigation.md` → 없음 |
| `docs/navigation.md` 수정 | 사용자 산출물이라 고치지 않는다. 더한 화면·이동은 상세 문서에 둔다 | 판단 — 근거 위치: `system-design-to-be-prompt.md` 「4. 문서와 다이어그램」(사용자 DSL을 치환하지 않는다). 확인 `git diff --stat -- docs/navigation.md` → 변경 없음 |

### 1.3 문서 대조 기준선

| 문서 | 이 브리프에서의 지위 |
|---|---|
| [`docs/navigation.md`](../../navigation.md) | 입력 — 요구의 원본. 화면 이름·처리 노드·API 논리 이름·계약 표를 그대로 따른다. 설계가 이동도와 다르게 정한 것은 핵심·상세에 근거와 함께 적는다 |
| `README.md` | 입력 — 「교육용 오픈소스 쇼핑몰」(요구 원문 ③) |
| 설계 가이드 묶음(`system-design-to-be-prompt.md`, `system-design-document-guide.md`, `job-flow-diagram-guide.md`, `module-boundary-guide.md`, `navigation-diagram-guide.md`, `state-diagram-guide.md`) | 양식·판단 기준. 이 저장소에 사본이 없어 링크하지 않고 파일 이름과 절 제목으로 가리킨다 |

## 2. 경계 목록과 조사 산출물

병렬 작성의 공유 계약이다. 경계 이름·§5 노드 이름·ID 범위는 핵심 문서가 원본이다.

| ID | 목표 경계 | 포트 | 상세 문서 |
|---|---|---|---|
| A | storefront-web | 정적 SPA(`/`) | [`to-be/details/storefront-web.md`](to-be/details/storefront-web.md) |
| B | admin-web | 정적 SPA(`/admin`) | [`to-be/details/admin-web.md`](to-be/details/admin-web.md) |
| C | mall-api(조립 지점) | :8080 | [`to-be/details/mall-api.md`](to-be/details/mall-api.md) |
| D | member | 모듈 | [`to-be/details/member.md`](to-be/details/member.md) |
| E | catalog | 모듈 | [`to-be/details/catalog.md`](to-be/details/catalog.md) |
| F | promotion | 모듈 | [`to-be/details/promotion.md`](to-be/details/promotion.md) |
| G | cart | 모듈 | [`to-be/details/cart.md`](to-be/details/cart.md) |
| H | order | 모듈 | [`to-be/details/order.md`](to-be/details/order.md) |
| I | payment | 모듈 | [`to-be/details/payment.md`](to-be/details/payment.md) |
| J | claim | 모듈 | [`to-be/details/claim.md`](to-be/details/claim.md) |
| K | review | 모듈 | [`to-be/details/review.md`](to-be/details/review.md) |
| L | notification | 모듈 | [`to-be/details/notification.md`](to-be/details/notification.md) |

## 3. 이슈 색인

신규 설계라 물려받는 AS-IS 이슈가 없다. 이 설계의 ID 범위:

| 접두 | 범위 | 건수 | 근거 표가 있는 곳 |
|---|---|---|---|
| `R` | `R-01`~`R-26` | 26 | [핵심 §2.2](to-be/system-design-to-be.md#22-요구) |
| `C` | `C-01`~`C-21` | 21 | [핵심 §2.3](to-be/system-design-to-be.md#23-설계-항목) |
| `D` | `D-01`~`D-08` | 8 | [핵심 §2.4](to-be/system-design-to-be.md#24-주요-결정) |

번호 공백 없음. 상세의 위험·미확정은 새 ID를 만들지 않고 관련 `R`·`C`·`D`로 단다(각 상세 §8).

## 4. 재확인 명령

| 목적 | 명령 |
|---|---|
| 기준 커밋과 추적 파일 | `git log --oneline -1 && git ls-files` |
| 이동도의 API 논리 이름 전수 | `grep -o '(/[a-z_/]*)' docs/navigation.md \| sort -u` |
| 이동도의 화면 노드 전수 | `grep -hoE '^[A-Z][A-Za-z]+|--> [A-Z][A-Za-z]+' docs/navigation.md \| sed 's/--> //' \| sort -u` |
| 설계 문서 정적 검사 | `node <가이드 사본>/guides/tools/design-doc-check.mjs docs/design/2026-10-19` |
| jobflow 렌더 | `node <가이드 사본>/guides/tools/design-doc-check.mjs --renderer <렌더러> --out <임시 폴더> docs/design/2026-10-19` |

## 5. 검증 기록

실제로 돌린 것만 적는다. 저장소 밖의 도구는 자리표시자로 쓴다.

**정적**

| 검사 | 명령 | 결과 |
|---|---|---|
| 펜스·jobflow 구조·링크·앵커·Mermaid 라벨 | `node <가이드 사본>/guides/tools/design-doc-check.mjs docs/design/2026-10-19` | `files=14 blocks=120 fail=0 warn=0`, 링크 487개·Mermaid 1블록 통과(최종 회차, 2026-10-19) |
| 다시 그리기(`JF-REDRAW`) | 같은 명령 | 0 — 남긴 경고 없음 |
| 테이블 소유 대조 | 상세 §4 표 이름을 뽑아 핵심 §3 「소유 상태」와 대조(스크립트) | 일치 — 두 모듈이 쓰는 표 없음 |
| 그림 수 대조 | 상세별 `jobflow` 블록 수를 세어 핵심 §5.19와 대조 | 일치(12개 경계) |

**렌더링**

| 검사 | 방법 | 결과 |
|---|---|---|
| jobflow SVG 생성 | `node <가이드 사본>/guides/tools/design-doc-check.mjs --renderer <렌더러> --out <임시 폴더> docs/design/2026-10-19` — 렌더러는 `JobFlowToSVG` 계열 사본 | 120블록 모두 SVG 생성 |
| PNG로 눈으로 확인 | SVG를 헤드리스 브라우저로 PNG 캡처(`<브라우저> --headless --screenshot`) 후 열람 | 핵심 17블록은 최종판을 모두 봤다(선 교차·좌우 가지 접합·끊긴 칸 없음, `Order.settle` 합류 칸은 렌더러가 들어오는 화살표마다 칸을 그리는 특성 — §5.9 불릿에 적음). 상세 103블록은 각 작성·수정 회차에 작성자가 바꾼 그림을 PNG로 봤다고 보고했고, 통합 담당은 그 가운데 표본만 다시 봤다 |
| `state` 16블록·`navigation` 14블록·Mermaid 1블록 | 렌더하지 않음 | 정적 검토 — 문법·라벨 규칙 대조까지만 |

**의미**

| 회차 | 검토자 | 결과 |
|---|---|---|
| 1차 | 독립 검토 셋(작성자와 다른 에이전트) — 핵심↔상세 계약 일치, 실패·경합 시나리오, 양식·가이드 준수 | 지적 82건(계약 37·시나리오 19·양식 26) — 필수 약 36건 |
| 2차 수정 | 통합 담당이 공통 결정 22개(K1~K22)를 정하고 수정자 다섯이 파일별로 반영, 핵심은 통합 담당 | — |
| 재검토 | 독립 검토 하나(회귀 확인) | 1차 필수 결함 10건 가운데 9건 닫힘·1건 부분, 새 지적 21건(필수 6) |
| 3차 수정 | 수정자 셋 + 통합 담당 | 필수 6건 반영. **이 회차는 독립 재검토를 다시 돌리지 않았다** — 정적 검사와 통합 담당의 대조만 거쳤다 |

## 6. 검토 반영

**필수 결함과 조치**

| 지적 | 조치 |
|---|---|
| 망취소가 대사의 확정과 겹쳐 「`PAID`이면서 환불」이 생길 수 있다 | `APPROVING → NET_CANCELLING` 조건부 전이가 통과했을 때만 망취소, 확정은 `APPROVING`에서만(`D-04`, 핵심 §5.7) |
| `CANCELLING`·망취소 거절·가상계좌 폐기가 환불로 바뀌는 경우 주문이 영구히 낀다 | payment 결과를 예외 없이 `failed {code}`로, `mode: VOID|REFUND` 분리, 시도 상한 뒤 `MANUAL_REVIEW` + 운영 `resolve`(핵심 §5.8·§5.10) |
| 실물 출고와 송장 등록 사이의 고객 취소로 환불과 출고가 함께 일어난다 | 품목 `PREPARING`(발주 확인) 뒤 고객 취소 409(핵심 §5.10·§5.11) |
| 반품 초기 배송비 이중 차감, 동시 클레임의 전체 반품 오판 | 초기 배송비 주문당 한 번, 주문 단위 잠금, `REFUND_PENDING` 품목을 반품됨으로 셈(claim 상세) |
| 웹훅 `duplicate`를 무시해 입금 반영이 빠진다 | `duplicate {first}`로 조건부 전이 재시도(order 상세 `JF-9`) |
| 교환 재발송 SKU가 order에 전달되지 않는다 | `markLineClaim(…, exchangeSkuIds)` + `order_lines.exchange_sku_id` |
| 카테고리 쿠폰 판정에 필요한 `categoryIds`가 없다 | catalog `getSkus` 출력에 추가 |
| 회원가입·비회원 견적이 인증 규칙에 막힌다 | mall-api 접근 규칙에 익명 경로 명시 |
| 클레임 알림 변수 누락으로 알림이 버려진다 | 템플릿 8종·변수 통일 |
| 스케줄러가 잇는 경계 간 호출(탈퇴 정리·보존 파기)이 §5에 없다 | 핵심 §5.17 신설, 5.1에 `Scheduler` 추가 |
| 타이머 이벤트에 반환값을 단 값 분기 | 종결 입구 노드 `Order.settle`로 재구성(핵심 §5.0·§5.7~§5.10) |
| 부분 환불 합이 잔액 0이 된 PG 통보를 남의 취소로 오판 | `ours` = 우리 취소 기록 합 = 결제액, order 판단표에 `.noop` 행 |
| 미결 폐기 기록이 남아 이후 환불이 「취소 진행 중」에 막힌다 | PG 입금 확인이 미결 `VOID` 기록을 `FAILED ALREADY_DEPOSITED`로 닫음 |
| 출고 뒤 운영 `RELEASE`가 재입고를 만든다 | 409 `NOT_RELEASABLE` |

**표현 교정·보강** — 오류 형식(`VALIDATION_FAILED`)·모듈 인터페이스 이름(`…Api`·`…Jobs`)·파기 계약 이름(`purgeExpired`) 통일, 작업 메모 제거, 단정형 문장을 「설계상 예상」으로, 외부 업체 동작에 「가정」 표시, 드릴다운 지도와 §5 노드 1:1 대조, 날짜 표기 `2026-10-19` 통일.

**고치지 않고 남긴 것과 이유**

- `(제안)` 표시를 계약마다 붙이지 않았다 — 모든 계약이 신규라 구별 기능이 없어, 핵심 머리 블록의 원칙으로 대신했다.
- 주기 정리 그림(핵심 §5.17)의 객체 수가 8개 기준을 넘는다 — 「모듈마다 같은 계약 한 번씩」이라 나누면 오히려 읽기 어렵다.
- 5.1 전체 한 장은 묶음 노드로 결제 확정 하류를 대표하고 트리거별로 다시 그리지 않았다(핵심 §5.1 불릿).
- 소셜 가입의 본인인증 미요구, 상품준비중 뒤 취소 요청 흐름, 적립금 등은 요구 확인이 필요해 핵심 §9.5에 남겼다.

## 7. 한계

1. 코드·실행 환경이 없는 신규 설계다 — 모든 런타임 서술은 설계상 예상이다.
2. 외부 업체(PG·본인인증·알림톡·택배 조회·소셜 로그인)를 정하지 않아 계약 형태가 가정이다(핵심 §9.5).
3. 법정 보존 기간 해석은 법무 검토를 거치지 않았다.
