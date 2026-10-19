# payment (모듈) — TO-BE 상세

> **대상**: payment 모듈 전체 — PG 어댑터와 결제 기록(`C-12`), 승인 결과 불명·망취소의 payment 쪽(`C-10`), 가상계좌 발급·입금 웹훅 검증의 payment 쪽(`C-11`) · **기준**: 설계 기준 DATE 2026-10-19·커밋 `6ace327`
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·표·설정 키가 새 제안이다 — 그래서 `(제안)` 표시는 생략한다. PG 업체의 동작은 「가정」(토스페이먼츠형 계약), 확인하지 못한 것은 「미확인」이다. 금액 단위는 모두 원(정수 `long`). 심볼은 잠정 스택 Java 21 + Spring Boot 3 기준이다([상위 §9.5](../system-design-to-be.md#95-미확정필요-입력)). 그림의 근거 열은 `R`·`C`·`D` ID다

## 1. 책임 / 비책임

- **책임**: PG와 주고받는 모든 일을 이 모듈 하나가 한다 — 승인(`approve`), 상태 조회(`queryPayment`), 가상계좌 발급(`issueVirtualAccount`), 입금 웹훅 검증(`verifyNotice`), 전체·부분 취소와 미입금 가상계좌 폐기(`cancel`). PG 응답을 `paid`·`declined`·`unknown` 같은 업무 결과로 판정하는 규칙(§6)과, 결제·취소·웹훅 기록(§4)의 단일 쓰기 주체다. PG 호출 전에 자기 기록을 먼저 쓰고 결과를 뒤에 갱신해, 프로세스가 중간에 죽어도 「PG에 무엇을 보냈는지」가 남게 한다(`R-18`·`C-12`). 업체 차이는 포트 `PgGateway`와 업체 구현(`TossPgGateway`, 가정) 사이에 가둔다.
- **비책임**: 주문 상태와 그 전이(order — `APPROVING`·`PAID`·`CANCELLING` 판정과 대사·만료 타이머), 승인 금액이 주문 금액과 같은지의 검증(order가 승인 호출 전에 한다), 환불액 계산(order·claim — payment는 받은 금액만큼 취소한다), 재고·쿠폰·알림(order가 결과를 보고 부른다), 웹훅 HTTP 수신과 응답 코드(order의 `POST /api/webhooks/pg`), 결제창 열기(storefront-web), 다시 묻기·다시 누르기 같은 재시도(호출자 — payment는 자동 재시도를 하지 않는다, §6). 다른 모듈을 부르지 않는다(`D-02`).
- **아무도 하지 않는 것**: 가상계좌로 결제한 주문의 환불 계좌 실명 확인(계좌는 order·claim이 요청 본문으로 받아 `cancel`에 넘기고 payment는 PG에 그대로 싣는다 — 실명 확인은 미확정, §8·`C-12`), PG 콘솔에서 운영자가 직접 한 취소의 자동 정리(payment는 웹훅·조회로 사실만 기록하고 order가 `MANUAL_REVIEW` 경보를 남긴다), PG 정산 내역과 결제 기록의 대조(정산은 범위 밖 — 근거 브리프 §1.2), 닫힌 가상계좌에 들어온 입금의 자동 환불(payment는 사실만 기록하고 order가 경보를 남긴다 — [상위 §5.9](../system-design-to-be.md#59-가상계좌-발급과-입금-통보입금기한-만료)).

## 2. 공개 계약

서비스 메서드 여섯 — order·claim이 부르는 다섯과, mall-api 보존 작업이 공용 인터페이스 `RetentionTask`로 부르는 파기 하나다. HTTP 라우트는 없다. 공개 인터페이스는 `payment.api.PaymentApi`이고 구현은 `PaymentService`다. **업무 결과는 모두 반환 값이다** — 봉인 타입(sealed)의 갈래로 돌려주고, 거절·처리 불가·확인 불가도 갈래(`failed {code}`·`rejected`·`unavailable` 등)다. 오류 칸의 예외(`PaymentException(code)`)는 호출자의 프로그래밍 오류뿐이다 — 트랜잭션 안 호출, 같은 키에 다른 값, 호출자가 계산을 잘못한 금액처럼 고쳐야 할 코드가 있다는 신호다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `approve` | `paymentKey`, `orderRef {orderId, orderNo}`, `amount` | `paid {method, approvedAt, receiptUrl}` · `declined {code, message}` · `unknown` | 프로그래밍 오류만 — `PAYMENT_KEY_MISMATCH`(같은 주문에 다른 `paymentKey` 기록 — order의 조건부 `PENDING_PAYMENT → APPROVING`이 둘째 승인을 먼저 막으므로 여기까지 오면 호출자 버그), `AMOUNT_MISMATCH`(같은 주문에 다른 금액), `TRANSACTION_ACTIVE` | `PaymentService.approve` — 멱등 키 `approve:<orderId>`, PG 30s. `JF-1` |
| `queryPayment` | `orderRef {orderId, orderNo}` | `paid {method, approvedAt, receiptUrl, balanceAmount}` · `cancelled {cancelledAt}` · `notApproved` · `waitingDeposit {dueAt}` · `unknown` | `TRANSACTION_ACTIVE` | `PaymentService.queryPayment` — PG 5s. `JF-3` |
| `issueVirtualAccount` | `orderRef`, `amount`, `orderName`, `bankCode`, `depositorName`, `cashReceipt? {type, number}` | `issued {bank, accountNumber, dueAt}` · `failed {code, message}` · `unknown` | `AMOUNT_MISMATCH`(같은 주문에 다른 금액), `TRANSACTION_ACTIVE` | `PaymentService.issueVirtualAccount` — 멱등 키 `vbank:<orderId>`, 확정 실패 뒤 다음 시도·은행 변경은 `vbank:<orderId>#<n>` — 시도 번호 `n`은 payment만 센다(호출자는 같은 `orderRef`로 다시 부르기만 한다), 입금기한 72h, PG 30s. `JF-4` |
| `verifyNotice` | `headers`, `rawBody`(바이트 그대로 — 서명 확인용) | `deposited {orderRef, amount, depositedAt}` · `expired {orderRef}` · `cancelled {orderRef, cancelledAt, ours}`(`ours` = 부분 취소를 포함한 우리 취소 기록 금액 합이 결제액과 같음 — `JF-5` 판정 표) · `ignored {reason}` · `duplicate {first}` · `rejected {reason}`(형식·서명 불일치 — order가 400 `INVALID_SIGNATURE`) · `unavailable`(PG 조회·기록 실패 — order가 503) | `TRANSACTION_ACTIVE` | `PaymentService.verifyNotice` — PG 조회 5s. `JF-5` |
| `cancel` | `orderRef`, `amount`, `reason`, `idemKey`, `mode:'VOID'·'REFUND'`, `refundAccount? {bankCode, accountNumber, holderName}` | `cancelled {cancelledAmount, balanceAmount, cancelledAt}` · `failed {code}` · `unknown`. `failed.code` = `ALREADY_DEPOSITED`·`REFUND_ACCOUNT_REQUIRED`·`NOT_CANCELLABLE {status}`·`CANCEL_IN_PROGRESS`·`PG_REJECTED {pgCode}` | 프로그래밍 오류만 — `IDEMPOTENCY_CONFLICT`(같은 키에 다른 금액·모드), `AMOUNT_EXCEEDS_BALANCE`, `VOID_REQUIRES_FULL_AMOUNT`, `TRANSACTION_ACTIVE` | `PaymentService.cancel` — 멱등 키는 호출자가 준다(`cancel:<orderId>`·`vbank-void:<orderId>`·`netcancel:<orderId>`·`claim:<claimId>`), PG 30s. `JF-2` |
| `purgeExpired` | `now` | `PurgeResult {task:'payment', deleted}` — 세 표에서 지운 행 수의 합 | — | `PaymentRetention.purgeExpired`(`RetentionTask` 구현) — mall-api 보존 작업이 하루 1회 부른다(§4) |

- **`orderRef`**: `orderId`는 멱등 키와 기록의 유일 키이고, `orderNo`는 PG에 주문 번호로 넘기는 값이다(가정 — 업체의 주문 ID 칸, 6~64자). 모든 메서드가 주문을 이 값 하나로 가리킨다 — 주문당 결제 기록이 하나라 payment가 `paymentKey`를 찾는다. 문자열 참조 키는 쓰지 않는다.
- **멱등**: `approve`는 주문당 기록 하나라 같은 주문으로 다시 불러도 결과가 이미 정해졌으면 PG를 부르지 않고 그 결과를 돌려준다. 결과가 `unknown`이었으면 같은 멱등 키로 PG를 다시 부른다. `issueVirtualAccount`도 같고, 다만 앞 시도가 PG 거절(`ISSUE_FAILED`)로 끝났거나 고객이 다른 은행을 골랐으면 시도 번호를 올린 새 키 `vbank:<orderId>#<n>`(n = 2, 3, …)로 새 발급을 요청한다 — 같은 키에 다른 본문을 보내지 않으려는 것이다. 결과 불명만 같은 키·같은 본문으로 다시 보낸다. **시도 번호는 payment만 센다** — 호출자(order)는 번호나 키를 넘기지 않고 같은 `orderRef`로 「다시 요청」만 하며, `beginIssue`가 직전 시도가 확정 실패(`ISSUE_FAILED`)였거나 은행·입금자명이 바뀌었으면 `n`을 올린다(`JF-4`). `cancel`은 `idemKey`마다 취소 기록 하나다 — 같은 키·같은 금액이면 정해진 결과를 돌려주고, `unknown`이었으면 같은 PG 키로 다시 부르고, `failed`였으면 시도 번호를 올린 새 PG 키(`<idemKey>#<시도>`)로 다시 요청한다. 거절은 PG에서 아무 일도 일어나지 않았다는 사실이라 새 키로 다시 보내도 이중 취소가 없다.
- **기록 먼저, 응답 나중**: 모든 메서드는 PG 결과를 자기 기록에 쓴 뒤에 돌려준다. 결과를 쓰지 못하면 PG가 승인·취소했더라도 `unknown`을 돌려준다 — 기록하지 못한 사실을 호출자에게 넘기면 결제 기록과 주문이 어긋나기 때문이다. `verifyNotice`는 같은 경우 `unavailable`이다(PG가 웹훅을 다시 보낸다, 가정).
- **트랜잭션 밖 호출**: 다섯 메서드 모두 호출자 트랜잭션 밖에서 불러야 한다([상위 §6.3](../system-design-to-be.md#63-트랜잭션-경계)). 안에서 부르면 `TRANSACTION_ACTIVE`다(§6 최후 방어). payment는 PG 호출 앞뒤로 자기 짧은 트랜잭션을 따로 연다.
- **`duplicate {first}`**: 같은 이벤트 ID가 다시 오면 처음 검증한 사실(`deposited {…}`·`expired {…}`·`cancelled {…}`·`ignored {…}`)을 그대로 실어 돌려준다. PG를 다시 부르지 않는다. 호출자는 이 사실로 조건부 전이를 다시 시도해도 된다 — 첫 통보의 반영 트랜잭션이 롤백됐으면 두 번째 통보가 그것을 메운다(`R-19`).
- **`queryPayment` 갈래 판정**: PG 상태 `DONE`·`PARTIAL_CANCELED` → `paid`(잔액 포함), `CANCELED` → `cancelled`, `WAITING_FOR_DEPOSIT` → `waitingDeposit`, `ABORTED`·`EXPIRED`·주문 번호로 결제 없음(404) → `notApproved`, `READY`·`IN_PROGRESS`(인증만 끝난 상태)와 조회 타임아웃·5xx → `unknown`. 상태 이름은 토스페이먼츠형 가정이다. 인증만 끝난 상태를 `notApproved`로 보지 않는 것은, 늦게 도착한 승인 요청이 그 뒤에 통과할 수 있어서다 — PG가 인증 유효 시간이 지나 `ABORTED`·`EXPIRED`로 닫으면 그때 `notApproved`가 된다(`R-18`).
- **`cancel`의 두 모드 — 호출자가 정한다**: `mode`는 호출자가 기대하는 사실이고 payment는 그 모드를 바꾸지 않는다. `VOID`는 미입금 가상계좌 폐기(`amount`는 전액), `REFUND`는 결제된 돈의 환불이다(`amount`가 잔액과 같으면 전체, 작으면 부분 취소). 기록 상태와 모드가 맞지 않으면 PG를 부르지 않고 `failed`다 — `VOID`인데 기록이 `PAID`·`PARTIALLY_CANCELLED`면 `failed ALREADY_DEPOSITED`(**환불로 바꿔 진행하지 않는다** — 만료 타이머가 입금된 주문을 환불해 버리는 일을 막는다), `REFUND`인데 기록이 `WAITING_DEPOSIT`이면 `failed NOT_CANCELLABLE {status:'WAITING_DEPOSIT'}`. 가상계좌로 결제한 기록의 `REFUND`는 `refundAccount`가 있어야 하고 없으면 `failed REFUND_ACCOUNT_REQUIRED`다(order·claim이 요청 본문에서 먼저 받는다).
- **`cancel`의 `failed` 코드**: `ALREADY_DEPOSITED`(위, 또는 폐기 전 조회에서 PG가 입금됨이라고 답함), `REFUND_ACCOUNT_REQUIRED`(위), `NOT_CANCELLABLE {status}`(기록이 없거나 `APPROVE_REQUESTED`·`UNKNOWN`·`DECLINED`·`VBANK_REQUESTED`·`ISSUE_FAILED`, 또는 모드와 맞지 않는 상태 — 기록이 없으면 `status:'NONE'`), `CANCEL_IN_PROGRESS`(같은 결제에 다른 키의 취소가 `REQUESTED`·`UNKNOWN`으로 걸려 있음 — 걸린 폐기 `VOID`는 PG 입금 확인 때 닫히므로 입금된 결제의 환불을 영구히 막지 않는다, `JF-3`·`JF-5`), `PG_REJECTED {pgCode}`(PG가 거절). 모두 PG에서 돈이 움직이지 않았다는 사실이라, 호출자는 원인을 고친 뒤 같은 키로 다시 부를 수 있다(§4.2 시도 번호).
- **이미 취소·폐기된 건은 `cancelled`**: 같은 키의 취소가 이미 `CANCELLED`면 그 결과를, PG가 「이미 취소됨·이미 폐기됨」류 4xx를 주거나 폐기 전 조회에서 `CANCELED`·`EXPIRED`라고 답하면 `cancelled`를 돌려준다(멱등 성공). 그 사실로 결제 기록을 `CANCELLED`·`EXPIRED`로 맞춘다 — 우리 기록에 없는 전액 취소(PG 콘솔 취소 등)면 오류 로그 경보도 남긴다.
- **결과 불명 전액 취소·폐기는 조회로 닫을 수 있다**: 전액 취소·폐기가 `unknown`이면 호출자(order 대사)는 `cancel`을 다시 부르기 전에 `queryPayment`를 불러도 된다 — PG가 `CANCELED`라고 답하면 `syncFromPg`가 걸린 전액 취소·폐기 기록을 `CANCELLED`로 닫고 `cancelled`를 돌려준다. 폐기 중 PG가 `EXPIRED`(그 사이 입금기한이 지나 닫힘)라고 답하면 걸린 폐기 기록도 같이 닫고 `notApproved`를 돌려준다 — order는 이것을 「폐기 완료」로 본다(`JF-3`). `paid`(취소 안 됨)·`waitingDeposit`이면 같은 키로 `cancel`을 다시 부른다. 부분 취소는 조회로 닫지 않는다(`JF-3` 불릿).

## 3. 내부 Job Flow — 드릴다운

**결론**: 조율자는 `PaymentService` 하나다. 메서드마다 「자기 기록 시작 → PG 호출 → 결과 기록」 세 박자를 조율하고, 기록은 `PaymentStore`(표 셋의 저장소), PG는 포트 `PgGateway`로만 다룬다. PG 응답을 업무 결과로 바꾸는 판정은 업체 구현 `TossPgGateway` 안의 `PgResponseClassifier`가 한다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Payment.pay`([§5.1](../system-design-to-be.md#51-전체-한-장) 묶음 — `approve`·`queryPayment`·`issueVirtualAccount`·`verifyNotice`·`cancel`) | 아래 다섯 그림 `JF-1`~`JF-5` — 다른 경계는 이 메서드들을 `PaymentApi.approve`처럼 부른다 | PG 응답 판정은 [`JF-1.1`](#jf-11-pg-응답-판정--tosspggatewayconfirm) |
| `Payment.approve`([§5.7](../system-design-to-be.md#57-카드간편결제-승인--pg-인증-완료에서-주문-완료까지)) | [`JF-1` 승인](#jf-1-승인--paymentserviceapprove) | [`JF-1.1` PG 응답 판정](#jf-11-pg-응답-판정--tosspggatewayconfirm) |
| `Payment.cancel`([§5.7](../system-design-to-be.md#57-카드간편결제-승인--pg-인증-완료에서-주문-완료까지) 망취소·[§5.9](../system-design-to-be.md#59-가상계좌-발급과-입금-통보입금기한-만료) 가상계좌 폐기·[§5.10](../system-design-to-be.md#510-주문-취소--결제-전입금-대기결제-완료) 전액 환불·[§5.12](../system-design-to-be.md#512-반품교환--신청에서-검수-완료까지) 부분 환불) | [`JF-2` 취소·폐기](#jf-2-취소폐기--paymentservicecancel) | 판정은 `JF-1.1`과 같다 |
| `Payment.queryPayment`([§5.8](../system-design-to-be.md#58-결제-승인-결과-불명-회수--대사-타이머)) | [`JF-3` 상태 조회](#jf-3-상태-조회--paymentservicequerypayment) | — |
| `Payment.issueVirtualAccount`([§5.9](../system-design-to-be.md#59-가상계좌-발급과-입금-통보입금기한-만료)) | [`JF-4` 가상계좌 발급](#jf-4-가상계좌-발급--paymentserviceissuevirtualaccount) | 판정은 `JF-1.1`과 같다 |
| `Payment.verifyNotice`([§5.9](../system-design-to-be.md#59-가상계좌-발급과-입금-통보입금기한-만료)) | [`JF-5` 웹훅 검증](#jf-5-웹훅-검증--paymentserviceverifynotice) | — |
| `Payment.purgeExpired`([§5.17](../system-design-to-be.md#517-주기-정리--보존-파기탈퇴-정리)) | 그림 없음 — `PaymentRetention.purgeExpired`가 `retain_until`이 지난 행을 지우는 한 문장(§4 보존) | — |

상위 바깥 노드 ↔ 이 경계의 게이트웨이: `PG.confirm` = `PgGateway.confirm`, `PG.getPayment` = `PgGateway.getPayment`, `PG.issueVirtualAccount` = `PgGateway.issueVirtualAccount`, `PG.cancel` = `PgGateway.cancel`, `PG.api`(§5.1 묶음) = 이 넷. `PgGateway.parseNotice`·`authenticate`는 PG를 부르지 않는 업체별 해석이다.

**표기** 노드는 제안 심볼이다 — `PaymentService`(공개 인터페이스 `PaymentApi`의 구현), `PaymentStore`(표 `payments`·`payment_cancels`·`pg_webhook_events`의 저장소, 메서드마다 자기 짧은 트랜잭션), `PgGateway`(포트), `TossPgGateway`·`PgHttpClient`·`PgResponseClassifier`(업체 구현 쪽). 결과 칸 이름(`.proceed`·`.settled` 등)은 반환 갈래이고 표에 뜻을 적는다. 이 그림들은 PG 말고 다른 경계를 부르지 않는다(다른 모듈 호출 0 — `D-02`). 렌더 확인은 이 문서의 여섯 그림을 SVG → PNG로 그려 눈으로 봤다. 열지 않은 것: `PaymentStore`의 각 메서드(단일 트랜잭션 쓰기 — §4가 원본), `PaymentRetention.purgeExpired`(보존 기한 지난 행 삭제 한 문장 — §4), `TossPgGateway`의 요청 본문 조립(업체 형식 — §5).

### JF-1 승인 — PaymentService.approve

```jobflow
orchestrator: PaymentService
Object: PaymentService, PaymentStore, PgGateway

PaymentService.approve --> PaymentStore.beginApprove
PaymentStore.beginApprove.settled
PaymentStore.beginApprove.proceed --> PgGateway.confirm
PgGateway.confirm.approved --> PaymentStore.recordApproval
PgGateway.confirm.rejected --> PaymentStore.recordApproval
PgGateway.confirm.indeterminate --> PaymentStore.recordApproval
PaymentStore.recordApproval.result --> PaymentService.approve.result
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PaymentStore.beginApprove` | `C-12`·`R-18`·`D-04` | 자기 트랜잭션 하나 — `orderId`로 기록을 잠그고 읽는다. 없으면 `APPROVE_REQUESTED` 행(`paymentKey`·금액·멱등 키 `approve:<orderId>`)을 넣는다. 같은 주문에 다른 `paymentKey`·금액이 있으면 예외(`PAYMENT_KEY_MISMATCH`·`AMOUNT_MISMATCH`) |
| `.settled` | `C-12` | 기록이 이미 `PAID`·`DECLINED`다 — PG를 부르지 않고 그 결과를 `paid`·`declined`로 돌려준다(단독 줄) |
| `.proceed` → `PgGateway.confirm` | `C-12`·`D-04` | 기록이 새로 생겼거나 `APPROVE_REQUESTED`·`UNKNOWN`이다 — 같은 멱등 키로 PG 승인을 부른다(트랜잭션 밖, 30s). 상위 `PG.confirm` |
| `.approved`·`.rejected`·`.indeterminate` → `PaymentStore.recordApproval` | `C-12`·`R-10`·`R-18` | 판정 규칙은 `JF-1.1`. 기록을 `PAID`(결제수단·승인 시각·영수증 주소)·`DECLINED`(PG 코드·메시지)·`UNKNOWN`으로 바꾸고 PG 응답 원문을 덧붙인다 |
| `.result` → `approve.result` | `C-12` | `paid`·`declined`·`unknown`. 결과 쓰기가 실패하면 `unknown`(§2 「기록 먼저, 응답 나중」) |

- **트리거** 상위 `Order.approvePayment`가 주문을 `APPROVING`으로 바꾼 트랜잭션을 커밋한 뒤 부른다. **완료 사실** 결제 기록이 `PAID`·`DECLINED`·`UNKNOWN` 중 하나이고 원문이 남는다.
- `recordApproval`로 들어오는 화살표 셋은 택일 판정의 **합류**다 — 승인 한 번에 결과 쓰기는 한 번이다.
- **실패 분기** 프로세스가 `confirm` 도중이나 `recordApproval` 전에 죽으면 기록은 `APPROVE_REQUESTED`로 남는다. 주문은 `APPROVING`이라 대사가 `queryPayment`로 이 기록을 고친다(`JF-3`).
- 같은 주문의 승인이 겹쳐 들어오면 `beginApprove`의 행 잠금이 줄을 세운다. 둘째는 첫째가 남긴 결과를 보고 `.settled`나 같은 키의 `.proceed`가 된다 — PG 쪽 멱등 키가 두 번째 방어다(`R-18`).

### JF-1.1 PG 응답 판정 — TossPgGateway.confirm

```jobflow
orchestrator: TossPgGateway
Object: TossPgGateway, PgHttpClient, PgResponseClassifier

TossPgGateway.confirm --> PgHttpClient.post
PgHttpClient.post.result --> PgResponseClassifier.classify
PgResponseClassifier.classify.approved
PgResponseClassifier.classify.rejected
PgResponseClassifier.classify.indeterminate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `TossPgGateway.confirm` | `C-12`, 업체 계약은 가정 | `PgGateway.confirm`의 업체 구현. `POST /v1/payments/confirm {paymentKey, orderId: orderNo, amount}`, 헤더 `Authorization: Basic <비밀키:>`·`Idempotency-Key` |
| `PgHttpClient.post` | `C-12` | 연결 3s, 읽기는 호출 종류별(§6). 돌려주는 것은 HTTP 상태·본문, 또는 전송 실패(타임아웃·연결 거부·연결 끊김)다. 재시도하지 않는다 |
| `PgResponseClassifier.classify` | `D-04`·`R-18` | 2xx → `.approved`. 4xx → `.rejected`, 단 408·409·429와 「이미 처리 중·처리됨」류 업체 코드는 `.indeterminate`. 5xx·타임아웃·연결 끊김·본문 해석 실패 → `.indeterminate`. 401·403(비밀키 오류)은 `.rejected {code:'PG_AUTH_ERROR'}`이고 오류 로그 경보를 남긴다 — 승인이 일어나지 않았다는 사실은 같다 |
| `.approved`·`.rejected`·`.indeterminate` | `C-12` | 단독 줄 — 이 그림 밖으로 나가는 값이다. `JF-1`의 같은 이름 갈래가 된다 |

- 같은 판정을 `issueVirtualAccount`·`cancel`·`getPayment`도 쓴다. 예외는 둘이다 — `getPayment`의 404는 「결제 없음」이라는 사실이고(`JF-3`), `cancel`의 「이미 취소됨·이미 폐기됨」류 4xx는 `.approved`(취소가 이미 일어났다는 사실 → `cancelled`)다. 그 밖의 `cancel` 4xx `.rejected`는 `failed PG_REJECTED {pgCode}`가 된다.
- 판정의 원칙은 하나다 — PG가 「안 했다」고 분명히 답한 것만 거절이고, 답을 못 받았거나 PG 쪽 사정이면 결과 불명이다. 돈이 오가는 외부 호출의 타임아웃은 실패가 아니다(`D-04`).

### JF-2 취소·폐기 — PaymentService.cancel

```jobflow
orchestrator: PaymentService
Object: PaymentService, PaymentStore, PgGateway

PaymentService.cancel --> PaymentStore.beginCancel
PaymentStore.beginCancel.settled
PaymentStore.beginCancel.refused
PaymentStore.beginCancel.refund --> PgGateway.cancel
PaymentStore.beginCancel.voidAccount --> PgGateway.getPayment
PgGateway.getPayment.deposited --> PaymentStore.recordCancel
PgGateway.getPayment.closed --> PaymentStore.recordCancel
PgGateway.getPayment.waiting --> PgGateway.cancel
PgGateway.cancel.result --> PaymentStore.recordCancel
PaymentStore.recordCancel.result --> PaymentService.cancel.result
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PaymentStore.beginCancel` | `C-12`·`R-13`·`R-14` | 자기 트랜잭션 하나 — 결제 기록을 잠그고 검사한 뒤 취소 기록 `REQUESTED`(키·시도 번호·금액·모드)를 넣는다. 같은 키에 다른 금액·모드, 잔액 초과, 폐기인데 일부 금액은 프로그래밍 오류라 예외다(§2 오류 칸) |
| `.settled` | `C-12` | 같은 키의 취소가 이미 `CANCELLED`다 — PG를 부르지 않고 그 결과(`cancelled`)를 돌려준다(단독 줄). 같은 키가 `UNKNOWN`이면 같은 PG 키로, `FAILED`면 새 시도 번호로 아래 갈래를 다시 탄다 |
| `.refused` | `C-12`·`C-11`·`R-13` | 검사에서 PG를 부를 수 없다고 정해진 업무 결과 — 취소 기록을 넣지 않고(PG에 보낸 것이 없다) `failed {code}`를 돌려준다(단독 줄). 그래서 원인을 고친 같은 키 재호출은 처음 요청처럼 다룬다. `VOID`인데 기록 `PAID`·`PARTIALLY_CANCELLED`(`ALREADY_DEPOSITED` — 환불로 바꾸지 않는다), `REFUND`인데 가상계좌 결제이고 계좌 없음(`REFUND_ACCOUNT_REQUIRED`), 다른 키의 취소가 걸려 있음(`CANCEL_IN_PROGRESS`), 기록 없음·`UNKNOWN`·`APPROVE_REQUESTED`·`DECLINED`·모드와 맞지 않는 상태(`NOT_CANCELLABLE {status}`). `VOID`인데 기록이 이미 `CANCELLED`·`EXPIRED`면 거절이 아니라 `cancelled`다(이미 닫힘 — 멱등 성공, `.settled`와 같이 PG를 부르지 않는다) |
| `.refund` → `PgGateway.cancel` | `C-12`·`R-13`·`R-14` | `REFUND`이고 기록이 `PAID`·`PARTIALLY_CANCELLED` — PG 취소(`cancelAmount`, 가상계좌 결제면 `refundReceiveAccount`, 멱등 키 = 이 시도의 PG 키, 30s). 상위 `PG.cancel` |
| `.voidAccount` → `PgGateway.getPayment` | `C-11`·`R-19` | `VOID`이고 기록이 `WAITING_DEPOSIT` — 폐기 전에 PG 상태를 먼저 묻는다(5s). 상위 §5.9의 만료 경합(기한 직전 입금)에서 입금된 돈을 잘못 돌려주지 않으려는 확인이다 |
| `.deposited` → `PaymentStore.recordCancel` | `C-11`·`R-19` | PG가 이미 입금됨(`DONE`)이라고 답했다 — 취소를 부르지 않고 취소 기록을 `FAILED {code:'ALREADY_DEPOSITED'}`, 결제 기록을 `PAID`로 고친다 → `failed ALREADY_DEPOSITED`. 폐기 전 조회가 결과 불명이면(그리지 않은 갈래) 취소를 부르지 않고 취소 기록을 `UNKNOWN`으로 둔다 — 같은 키로 다시 부르면 조회부터 다시 한다 |
| `.closed` → `PaymentStore.recordCancel` | `C-11` | PG가 이미 `CANCELED`·`EXPIRED`라고 답했다 — 취소를 부르지 않고 취소 기록 `CANCELLED`, 결제 기록을 PG 사실대로 `CANCELLED`·`EXPIRED`로 맞춘다 → `cancelled`(폐기가 이미 끝났다는 멱등 성공) |
| `.waiting` → `PgGateway.cancel` | `C-11` | PG도 입금 대기라고 답했다 — 같은 취소 API로 가상계좌를 닫는다(가정 — 업체가 미입금 결제 취소를 폐기로 처리) |
| `.result` → `PaymentStore.recordCancel` | `C-12` | `JF-1.1` 판정 — `approved`(「이미 취소됨」 4xx 포함)면 취소 기록 `CANCELLED`, 잔액 차감, 결제 기록 `PARTIALLY_CANCELLED`·`CANCELLED`. `rejected`면 `FAILED {code:'PG_REJECTED', pgCode}`. `indeterminate`면 `UNKNOWN` — 결제 기록과 잔액은 그대로 |
| `.result` → `cancel.result` | `C-12` | `cancelled`·`failed {code}`·`unknown`. 결과 쓰기가 실패하면 `unknown` |

- **트리거** 넷 — 망취소(`netcancel:<orderId>`·`REFUND`, 상위 §5.7 `commitFailed`), 가상계좌 폐기(`vbank-void:<orderId>`·`VOID` — 만료 §5.9, 입금 대기 주문의 고객 취소 §5.10, 발급 중 주문 종료)와 결제 뒤 주문 취소(`cancel:<orderId>`·`REFUND`, §5.10), 반품 부분 환불(`claim:<claimId>`·`REFUND`, §5.12). 모두 호출자 트랜잭션 밖이다. **완료 사실** 취소 기록 하나가 `CANCELLED`·`FAILED`·`UNKNOWN`이고, 성공이면 결제 잔액이 줄었다. 업무상 안 되는 경우도 예외가 아니라 `failed {code}`다.
- `PgGateway.cancel`로 들어오는 화살표 둘(`.refund`·`.waiting`)은 모드 택일의 **합류**다. `recordCancel`로 들어오는 셋(`.deposited`·`.closed`·`cancel.result`)도 택일 합류다 — 취소 한 번에 PG 취소는 많아야 한 번, 결과 쓰기는 한 번이다.
- `PgGateway.cancel` 칸이 둘로, `recordCancel` 칸이 셋으로 그려지는 것은 위 합류 때문이다. `cancel.result`는 렌더러가 마지막(폐기 쪽) 칸 아래에 붙이지만 두 모드에 공통인 결과다. 폐기 모드의 실제 순서는 `getPayment` → `cancel` → `recordCancel`이다.
- **실패 분기** 결과 불명(`UNKNOWN`)인 취소는 같은 키로 다시 부르는 쪽이 닫는다 — claim의 `REFUND_PENDING` 재시도, order의 `CANCELLING` 대사. 전액 취소·폐기라면 대사가 먼저 `queryPayment`로 닫을 수도 있다(§2, `JF-3`). 걸려 있는 동안 같은 결제의 다른 키 취소는 `failed CANCEL_IN_PROGRESS`다. 부분 취소 결과를 잔액만으로 대조하지 않아도 되게 하려는 규칙이다.
- **걸린 폐기의 입금 확인 닫기** 폐기(`VOID`)가 `REQUESTED`·`UNKNOWN`으로 걸린 채 PG가 입금 완료(`DONE`)를 알리면 — 대사의 `queryPayment`(`JF-3` `syncFromPg`)든 입금 통보(`JF-5` `applyNotice`)든 — 그 쓰기가 걸린 폐기 기록을 `FAILED {code:'ALREADY_DEPOSITED'}`로 닫는다. 입금된 결제의 폐기는 일어날 수 없다는 사실이 확정됐기 때문이다. 그래서 그 뒤 고객 취소·반품의 `REFUND`(`cancel:`·`claim:`)가 `CANCEL_IN_PROGRESS`에 영구히 막히지 않는다. 같은 `vbank-void:` 키로 다시 부르면 결제 기록이 `PAID`라 `.refused` `failed ALREADY_DEPOSITED`다.

### JF-3 상태 조회 — PaymentService.queryPayment

```jobflow
orchestrator: PaymentService
Object: PaymentService, PgGateway, PaymentStore

PaymentService.queryPayment --> PgGateway.getPayment
PgGateway.getPayment.indeterminate
PgGateway.getPayment.result --> PaymentStore.syncFromPg
PaymentStore.syncFromPg.result --> PaymentService.queryPayment.result
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PgGateway.getPayment` | `C-12`·`R-18`·`D-04` | 주문 번호로 PG 결제를 조회한다(가정 — `GET /v1/payments/orders/{orderNo}`, 5s). 상위 `PG.getPayment`. 로컬 기록이 없어도 묻는다 — `beginApprove` 트랜잭션이 실패해 기록이 없는 주문도 대사가 닫을 수 있어야 해서다 |
| `.indeterminate` | `C-12` | 타임아웃·5xx — 기록을 건드리지 않고 `unknown`(단독 줄). 대사가 다음 틱에 다시 묻는다 |
| `.result` → `PaymentStore.syncFromPg` | `C-12`·`R-18` | 자기 트랜잭션 하나 — PG 상태를 §2의 갈래로 바꾸고, 기록을 그 사실에 맞춘다: `APPROVE_REQUESTED`·`UNKNOWN` → `PAID`·`DECLINED`, `WAITING_DEPOSIT` → `PAID`·`EXPIRED`·`CANCELLED`, PG `DONE`(입금 완료)이면 결제 기록 상태와 무관하게 같은 결제에 걸린 폐기 기록(`VOID`, `REQUESTED`·`UNKNOWN`)을 `FAILED {code:'ALREADY_DEPOSITED'}`로 닫고, 전액 취소가 확인되면 `CANCELLED`와 걸린 전액 취소·폐기 기록 `CANCELLED`, 폐기 중 `EXPIRED`면 걸린 폐기 기록도 `CANCELLED`. 404는 기록이 있으면 `DECLINED`, 없으면 쓰지 않는다. §4.1 상태 기계에 없는 전이(`CANCELLED → EXPIRED`, `DECLINED → PAID` 등)는 하지 않는다 — 기록은 그대로 두고 PG 사실을 갈래로만 돌려주며 오류 로그 경보를 남긴다 |
| `.result` → `queryPayment.result` | `C-12` | `paid`·`cancelled`·`notApproved`·`waitingDeposit`·`unknown`. 맞추기 쓰기가 실패하면 `unknown` |

- **트리거** 상위 `Order.OnReconcileTick`(1분 — `APPROVING`·`NET_CANCELLING`·`CANCELLING` 주문, 1시간마다 `WAITING_DEPOSIT` 주문)이 `OrderJobs.onReconcileTick`에서 부른다. **완료 사실** 결제 기록이 PG의 현재 사실과 같아지고 그 갈래를 돌려준다.
- 결과 불명인 **부분** 취소는 조회로 닫지 않는다 — PG의 취소 목록과 금액만으로는 어느 요청의 결과인지 단정할 수 없다. 같은 키로 `cancel`을 다시 부르면 PG 멱등 키가 원래 결과를 돌려준다(`JF-2`). 결과 불명인 **전액** 취소·폐기는 하나뿐이라 조회로 닫는다 — PG `CANCELED`면 걸린 취소 기록을 `CANCELLED`로 닫고 `cancelled`를 돌려주므로, 호출자는 `cancel`을 다시 부르지 않아도 된다(§2).
- 폐기가 결과 불명(`UNKNOWN`)으로 걸린 채 대사가 조회해 PG `DONE`을 보면, `paid`를 돌려주기 전에 걸린 폐기를 `FAILED {ALREADY_DEPOSITED}`로 닫는다(`JF-2` 「걸린 폐기의 입금 확인 닫기」) — 그 뒤 고객 취소·반품의 `REFUND`가 `CANCEL_IN_PROGRESS`에 막히지 않는다.
- 인증만 끝난 PG 상태(`READY`·`IN_PROGRESS`)는 `unknown`이다(§2 판정). 그래서 대사가 그 주문을 `PAYMENT_FAILED`로 닫는 것은 PG가 인증을 `ABORTED`·`EXPIRED`로 닫은 뒤다.

### JF-4 가상계좌 발급 — PaymentService.issueVirtualAccount

```jobflow
orchestrator: PaymentService
Object: PaymentService, PaymentStore, PgGateway

PaymentService.issueVirtualAccount --> PaymentStore.beginIssue
PaymentStore.beginIssue.settled
PaymentStore.beginIssue.proceed --> PgGateway.issueVirtualAccount
PgGateway.issueVirtualAccount.issued --> PaymentStore.recordIssue
PgGateway.issueVirtualAccount.rejected --> PaymentStore.recordIssue
PgGateway.issueVirtualAccount.indeterminate --> PaymentStore.recordIssue
PaymentStore.recordIssue.result --> PaymentService.issueVirtualAccount.result
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PaymentStore.beginIssue` | `C-11`·`C-12`·`R-11` | 자기 트랜잭션 하나 — 기록이 없으면 `VBANK_REQUESTED` 행(금액·입금자명·은행 코드·입금기한 = 지금 + 72h·시도 번호 1·멱등 키 `vbank:<orderId>`)을 넣는다. 기록이 `VBANK_REQUESTED`(결과 불명)이고 은행·입금자명이 같으면 키·본문·입금기한을 그대로 둔다 — 같은 키의 요청 본문이 같아야 PG 멱등이 성립한다(가정). 기록이 `ISSUE_FAILED`(PG 거절)이거나, `VBANK_REQUESTED`인데 고객이 다른 은행·입금자명을 골랐으면 **새 시도**다 — 시도 번호(`vbank_attempt`, payment만 센다 — 호출자는 번호를 넘기지 않는다)를 올리고 키를 `vbank:<orderId>#<n>`, 은행·입금자명·입금기한을 새 값으로 바꿔 `VBANK_REQUESTED`로 둔다 |
| `.settled` | `C-12` | 기록이 이미 `WAITING_DEPOSIT`다 — PG를 부르지 않고 저장한 은행·계좌·기한을 `issued`로 돌려준다(단독 줄) |
| `.proceed` → `PgGateway.issueVirtualAccount` | `C-11`·`R-11` | PG 가상계좌 발급(가정 — `POST /v1/virtual-accounts`, 30s, 이 시도의 멱등 키). 상위 `PG.issueVirtualAccount` |
| `.issued`·`.rejected`·`.indeterminate` → `PaymentStore.recordIssue` | `C-11`·`C-12` | `JF-1.1` 판정. `WAITING_DEPOSIT`(은행·계좌 번호·입금기한·웹훅 대조용 `secret`, 가정)·`ISSUE_FAILED`(코드)로 바꾸거나, 결과 불명이면 `VBANK_REQUESTED` 그대로 원문만 덧붙인다 |
| `.result` → `issueVirtualAccount.result` | `C-12` | `issued`·`failed`·`unknown`. 상위 `Order.issueVirtualAccount`는 `failed`·`unknown`을 모두 502 `PG_ERROR`로 바꾼다 — 고객이 다시 누르면 order는 같은 입력으로 다시 부르기만 하고, 결과 불명 뒤에는 같은 키라 PG가 같은 계좌를 돌려주고(가정, [상위 §6.3](../system-design-to-be.md#63-트랜잭션-경계)), 거절 뒤에는 `beginIssue`가 번호를 올린 새 키 `vbank:<orderId>#<n>`으로 새 발급을 요청한다 |

- **트리거** 고객이 「무통장입금」으로 주문을 만든 뒤 화면이 부르는 `Order.issueVirtualAccount`. **완료 사실** 결제 기록 `WAITING_DEPOSIT`와 은행·계좌·기한 — order가 그 값으로 주문을 `WAITING_DEPOSIT`로 바꾸고 가예약을 기한까지 늘린다.
- `recordIssue`로 들어오는 화살표 셋은 택일 판정의 **합류**다 — 발급 한 번에 결과 쓰기는 한 번이다.
- 결과 불명으로 끝난 발급은 PG에 계좌가 생겼을 수도 있다. 고객은 계좌 번호를 모르니 입금할 수 없고, PG가 입금기한에 닫는다(가정 — §8). 결과 불명 뒤 은행을 바꾼 새 시도도 같다 — 앞 시도의 계좌는 아무도 모르는 채 PG 기한에 닫힌다.
- 같은 키는 같은 본문일 때만 다시 쓴다. 거절 뒤 같은 키로 다시 보내면 업체가 저장한 거절 응답을 그대로 돌려줄 수 있어(가정 — 멱등 키가 응답을 보관) 시도 번호를 올린다.

### JF-5 웹훅 검증 — PaymentService.verifyNotice

```jobflow
orchestrator: PaymentService
Object: PaymentService, PgGateway, PaymentStore

PaymentService.verifyNotice --> PgGateway.parseNotice
PgGateway.parseNotice.malformed
PgGateway.parseNotice.result --> PaymentStore.findByOrderNo
PaymentStore.findByOrderNo.missing
PaymentStore.findByOrderNo.result --> PgGateway.authenticate
PgGateway.authenticate.invalid
PgGateway.authenticate.valid --> PaymentStore.findNotice
PaymentStore.findNotice.seen
PaymentStore.findNotice.new --> PgGateway.getPayment
PgGateway.getPayment.indeterminate
PgGateway.getPayment.result --> PaymentStore.applyNotice
PaymentStore.applyNotice.result --> PaymentService.verifyNotice.result
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PgGateway.parseNotice`·`.malformed` | `C-11` | 업체 본문을 이벤트 ID·주문 번호·이벤트 종류(결제 상태 변경 등)·`secret`으로 읽는다. 읽지 못하면 `rejected {reason:'MALFORMED'}`(order가 400 `INVALID_SIGNATURE`). 업체가 이벤트 ID를 주지 않으면 (주문 번호, 상태, 상태 시각)의 해시를 이벤트 ID로 쓴다(가정) |
| `PaymentStore.findByOrderNo`·`.missing` | `C-11` | 주문 번호로 결제 기록을 찾는다. 없으면 `ignored {reason:'UNKNOWN_ORDER'}` — 다른 환경의 통보 등이고, 서명을 확인할 기준(`secret`)도 없다 |
| `PgGateway.authenticate`·`.invalid` | `C-11`·`R-19` | 업체 방식으로 출처를 확인한다 — 헤더 서명(비밀키 HMAC, `rawBody` 기준) 또는 발급 때 받은 `secret`과의 상수 시간 비교(가정). 다르면 `rejected {reason:'SIGNATURE'}`(order가 400 `INVALID_SIGNATURE`) |
| `PaymentStore.findNotice`·`.seen` | `R-19` | 같은 이벤트 ID가 이미 검증돼 있다 → `duplicate {first}`(단독 줄). PG를 다시 부르지 않는다 |
| `.new` → `PgGateway.getPayment`·`.indeterminate` | `C-11`·`R-19` | 통보 본문을 믿지 않고 PG에 실제 상태를 묻는다(5s). 상위 `PG.getPayment`. 결과 불명이면 `unavailable`(order가 503) — 이벤트를 기록하지 않아 PG가 다시 보내면 처음처럼 검증한다(가정 — 재전송 정책) |
| `.result` → `PaymentStore.applyNotice` | `C-11`·`R-19` | 자기 트랜잭션 하나 — 결제 기록의 결제수단과 PG 상태로 판정하고 쓴다(아래 판정 표). 쓰기는 §4.1 상태 기계에 있는 전이만 한다 — 없는 전이(`CANCELLED → EXPIRED`, `DECLINED → PAID` 등)면 기록을 두고 PG 사실만 갈래로 돌려주며 오류 로그 경보를 남긴다. 이벤트 행을 같은 트랜잭션에 넣는다 — 이벤트 ID 유일 제약에 걸리면(같은 통보 동시 도착) 먼저 쓴 행을 읽어 `duplicate`로 돌려준다 |
| `.result` → `verifyNotice.result` | `C-11` | `deposited`·`expired`·`cancelled`·`ignored`·`duplicate`. 쓰기가 실패하면 `unavailable` |

**`applyNotice` 판정 표** — 통보 본문의 상태가 아니라 PG 조회 결과로 가른다(상태 이름은 토스페이먼츠형 가정).

| 결제수단(기록) | PG 상태 | 갈래 | 결제 기록 쓰기 |
|---|---|---|---|
| `VIRTUAL_ACCOUNT` | `DONE`(입금) | `deposited {orderRef, amount, depositedAt}` | `WAITING_DEPOSIT`·`EXPIRED`·`CANCELLED` → `PAID`(뒤 둘은 경보). 이미 `PAID`면 그대로. 결제 기록 상태와 무관하게 걸린 폐기 기록(`VOID`, `REQUESTED`·`UNKNOWN`)은 `FAILED {code:'ALREADY_DEPOSITED'}`로 닫는다 — 뒤의 `REFUND`가 `CANCEL_IN_PROGRESS`에 막히지 않게 |
| `VIRTUAL_ACCOUNT` | `EXPIRED`, 또는 입금기한이 지난 `WAITING_FOR_DEPOSIT` | `expired {orderRef}` | `WAITING_DEPOSIT` → `EXPIRED`. 걸린 폐기 기록(`REQUESTED`·`UNKNOWN`)이 있으면 `CANCELLED`로 닫는다(폐기 완료). `CANCELLED`·`EXPIRED`면 그대로 |
| 모든 수단 | `CANCELED` | `cancelled {orderRef, cancelledAt, ours}` | 우리 취소 기록과 대조한다 — 같은 결제의 취소 기록 중 `CANCELLED`·`UNKNOWN`·`REQUESTED`(부분 취소 포함) 금액 합이 결제액(`amount`)과 같으면 `ours:true`이고 걸린 기록(`REQUESTED`·`UNKNOWN`)을 `CANCELLED`로 닫는다(잔액 0이라는 PG 사실이 걸린 요청의 성공을 말한다). 판매자 귀책 전체 반품처럼 부분 취소들의 합이 잔액을 0으로 만든 경우도 `ours:true`다. 합이 다르면 `ours:false`(PG 콘솔 취소 등 — order가 `MANUAL_REVIEW` 경보). 기록은 상태 기계 안에서 `CANCELLED`·잔액 0으로(`PAID`·`PARTIALLY_CANCELLED`·`WAITING_DEPOSIT`에서만 — `ours:false`면 불변조건 ①의 예외라 경보) |
| `CARD`·`EASY_PAY` | `DONE` 등 | `ignored {reason:'NOT_HANDLED'}` | 쓰지 않는다 — 카드 승인은 `approve`·대사가 닫는다 |
| 모든 수단 | 그 밖(본문은 입금이라는데 PG는 대기, `PARTIAL_CANCELED` 등) | `ignored {reason}` | 쓰지 않는다. 우리 기록에 없는 부분 취소면 오류 로그 경보 |

- **트리거** 상위 `PG.OnDepositNotice` → `Order.handlePgWebhook`이 트랜잭션 밖에서 `PaymentApi.verifyNotice`로 부른다. **완료 사실** 검증한 사실이 이벤트 행과 결제 기록에 남고, order가 그 사실로 주문을 바꾼다. 금액이 주문 금액과 같은지는 order가 본다.
- 결제 기록이 `EXPIRED`·`CANCELLED`(가상계좌를 닫음)인데 PG가 `DONE`이라고 답하면 기록을 `PAID`로 바꾸고(§4.1) `deposited`를 돌려준다 — 돈이 들어왔다는 사실이 먼저다. 주문을 되살리지 않고 환불 경보를 남기는 판단은 order가 한다([상위 §5.9](../system-design-to-be.md#59-가상계좌-발급과-입금-통보입금기한-만료)).
- 이 그림의 PG 호출은 `getPayment` 하나다. `parseNotice`·`authenticate`는 네트워크를 쓰지 않는 업체별 해석이라 상위 그림에 없다.

## 4. 소유 상태·데이터

표 셋 — 결제 건, 취소 건, 웹훅 이벤트다. 모두 한 MySQL 안의 payment 전용 표이고 쓰기는 `PaymentStore`만 한다. 금액 열은 모두 `BIGINT`(원).

| 표 | 주요 열 | 비고 |
|---|---|---|
| `payments` | `id` PK, `order_id` 유일, `order_no`, `method`(`CARD`·`EASY_PAY`·`VIRTUAL_ACCOUNT`), `status`, `amount`, `balance_amount`, `payment_key` 유일(NULL 허용), `idem_key`(`approve:<orderId>`·`vbank:<orderId>`·`vbank:<orderId>#<n>`), `vbank_attempt`(발급 시도 번호 `n` — payment만 센다), `vbank_bank_code`·`vbank_account_number`·`vbank_due_at`·`vbank_secret`(암호화)·`depositor_name`, `approved_at`, `receipt_url`, `last_pg_code`·`last_pg_message`, `pg_raw_log`(JSON 배열 — 호출 종류·시각·HTTP 상태·응답 본문), `retain_until`, `created_at`·`updated_at`, `version` | 주문당 한 행. 응답 원문은 PG가 마스킹한 카드 번호 그대로 두고 비밀키·`secret`은 넣지 않는다. 행을 바꾸는 모든 쓰기는 `SELECT … FOR UPDATE`로 잠근 뒤 한다 |
| `payment_cancels` | `id` PK, `payment_id`, `idem_key` 유일, `attempt`, `mode`(`REFUND`·`VOID`), `amount`, `reason`, `status`, `pg_transaction_key`, `pg_code`·`pg_message`, `pg_raw`(JSON), `refund_account_enc`(가상계좌 결제 환불만, 암호화 — 취소가 `CANCELLED`·`FAILED`로 끝나는 쓰기에서 NULL로), `requested_at`·`completed_at`, `retain_until` | 호출자 멱등 키마다 한 행. PG에 보내는 키는 `<idem_key>#<attempt>`이고 `attempt`는 `FAILED` 뒤 다시 요청할 때만 오른다 |
| `pg_webhook_events` | `event_id` 유일, `order_no`, `event_type`, `verified_result`(`deposited`·`expired`·`cancelled`·`ignored`), `amount`, `raw_body`, `received_at`, `retain_until` | 검증을 마친 통보만 넣는다. 검증 전에 실패한 통보(서명 불일치·PG 조회 실패)는 로그만 남긴다 |

- **보존**: 세 표 모두 `retain_until` = 마지막 상태 변경 시각 + 5년이다(대금결제 기록, `R-25` — 기산점 해석은 잠정, [상위 §6.2](../system-design-to-be.md#62-권위-소유자와-생명주기)). mall-api 보존 작업이 하루 1회 `RetentionTask.purgeExpired(now)`로 부르면 `retain_until < now`인 행을 지우고 `PurgeResult {task:'payment', deleted}`를 돌려준다. 그 전에는 지우거나 고치지 않는다 — 돈이 오간 기록이라 되돌림 롤백도 하지 않는다([상위 §9.3](../system-design-to-be.md#93-이행롤백)).
- **불변조건**: ① `balance_amount` = `amount` − 그 결제의 `CANCELLED` 취소 금액 합, 0 이상(예외는 PG 콘솔 취소를 `ours:false`로 맞춘 경우뿐 — 경보가 남는다). ② 한 결제에 `REQUESTED`·`UNKNOWN` 취소는 많아야 하나. ③ `status`가 `CANCELLED`면 `balance_amount` = 0. ④ 같은 `order_id`·`idem_key`·`event_id`는 한 행뿐(유일 제약).

### 4.1 결제 건 상태 기계

상태 소유자는 payment(`payments.status`)다. 초기화는 `approve`(카드·간편결제)나 `issueVirtualAccount`(무통장입금)가 PG 호출 전에 행을 넣을 때다. 상태를 바꾸는 입력은 PG 응답과 PG 조회 결과뿐이다 — 주문 상태(order 소유)와 따로 움직이고, 둘의 대응은 [상위 §5.18](../system-design-to-be.md#518-주문-상태--여러-경계가-나눠-가진-기록)에 있다.

```state
<s> --> (APPROVE_REQUESTED) : approve — PG 호출 전 기록
(APPROVE_REQUESTED) --> (PAID) : 승인 응답
(APPROVE_REQUESTED) --> (DECLINED) : 거절 응답
(APPROVE_REQUESTED) --> (UNKNOWN) : 타임아웃·5xx·연결 끊김
(UNKNOWN) --> (PAID) : 같은 키 재승인·조회에서 승인 확인
(UNKNOWN) --> (DECLINED) : 조회에서 결제 없음·인증 만료 확인
<s> --> (VBANK_REQUESTED) : issueVirtualAccount — PG 호출 전 기록
(VBANK_REQUESTED) --> (VBANK_REQUESTED) : 결과 불명 — 같은 키로 다시 발급, 은행 변경은 새 시도 키
(VBANK_REQUESTED) --> (WAITING_DEPOSIT) : 발급 응답
(VBANK_REQUESTED) --> (ISSUE_FAILED) : 거절 응답
(ISSUE_FAILED) --> (VBANK_REQUESTED) : 다시 발급 — 새 시도 키 vbank:<orderId>#<n>
(WAITING_DEPOSIT) --> (PAID) : 입금 확인 — 웹훅·조회·폐기 전 조회
(WAITING_DEPOSIT) --> (EXPIRED) : PG 입금기한 만료 확인
(WAITING_DEPOSIT) --> (CANCELLED) : cancel — 가상계좌 폐기
(EXPIRED) --> (PAID) : 닫힌 계좌 입금 확인 — 가정
(CANCELLED) --> (PAID) : 폐기한 계좌 입금 확인 — 가정·경보
(PAID) --> (PARTIALLY_CANCELLED) : 부분 취소 확인
(PARTIALLY_CANCELLED) --> (PARTIALLY_CANCELLED) : 부분 취소 확인
(PAID) --> (CANCELLED) : 잔액 전액 취소 확인
(PARTIALLY_CANCELLED) --> (CANCELLED) : 잔액 전액 취소 확인
(DECLINED) --> <e> : 보존 기한 파기
(EXPIRED) --> <e> : 보존 기한 파기
(CANCELLED) --> <e> : 보존 기한 파기
(PAID) --> <e> : 보존 기한 파기
(PARTIALLY_CANCELLED) --> <e> : 보존 기한 파기
```

**기호**: `<s>` 행이 생기는 곳, `(…)` 상태, `<e>` 행이 파기되는 곳, `A --> B : 글` A에서 B로 가는 전이와 그 입력(`state-diagram-guide.md` 「구성 요소」).

- **확인 전이**: 「확인」이 붙은 전이는 PG 응답·조회가 그 사실을 말할 때만 일어난다. 호출자의 요청만으로는 상태가 바뀌지 않는다.
- **닫은 계좌의 입금**: 상위 §5.9의 경합에서 입금이 폐기보다 먼저면 `JF-2`의 폐기 전 조회가 `WAITING_DEPOSIT → PAID`로 잡는다. 폐기·만료 뒤 입금은 PG가 막는다고 가정했다. 그래도 PG가 `DONE`이라고 답하면 기록은 PG 사실대로 `PAID`가 되고(`EXPIRED`·`CANCELLED → PAID`), `CANCELLED`에서 온 경우는 오류 로그 경보도 남긴다 — 주문을 되살리지 않고 환불하는 판단은 order다(§8).
- `ISSUE_FAILED`·`UNKNOWN`에서 끝나는 행은 주문이 만료되면 더 바뀌지 않는다. 그 행도 보존 기한이 지나면 같은 작업이 지운다.

### 4.2 취소 건 상태 기계

상태 소유자는 payment(`payment_cancels.status`)다. 초기화는 `cancel`의 `beginCancel`이다. 결제 건의 잔액·상태는 이 기계가 `CANCELLED`로 갈 때 같은 트랜잭션에서 바뀐다.

```state
<s> --> (REQUESTED) : cancel — PG 호출 전 기록
(REQUESTED) --> (CANCELLED) : 취소 응답
(REQUESTED) --> (CANCELLED) : 폐기 전 조회에서 이미 취소·만료 확인
(REQUESTED) --> (FAILED) : 거절 응답·폐기 중 입금 확인(폐기 전 조회·대사 조회·입금 통보)
(REQUESTED) --> (UNKNOWN) : 타임아웃·5xx·연결 끊김
(UNKNOWN) --> (CANCELLED) : 같은 키 재호출·전액 취소 조회·PG 취소·만료 통보에서 확인
(UNKNOWN) --> (FAILED) : 같은 키 재호출에서 거절·폐기 중 입금 확인(대사 조회·입금 통보)
(FAILED) --> (REQUESTED) : 같은 키로 다시 요청 — 시도 번호 +1
(CANCELLED) --> <e> : 보존 기한 파기
(FAILED) --> <e> : 보존 기한 파기
```

**기호**: 4.1과 같다.

- **폐기 중 입금 확인**: `VOID` 기록이 `REQUESTED`·`UNKNOWN`인 채 PG `DONE`이 확인되면 그 확인을 쓰는 트랜잭션(`syncFromPg`·`applyNotice`)이 기록을 `FAILED {code:'ALREADY_DEPOSITED'}`로 닫는다 — 불변조건 ②의 「걸린 취소」가 풀려 뒤의 `REFUND`가 진행된다.
- `UNKNOWN`에서 `REQUESTED`로 돌아가는 전이는 없다 — 같은 키로 다시 부르면 시도 번호를 바꾸지 않고 같은 PG 키로 보낸다. PG 쪽에서 원래 요청이 늦게 처리돼도 이중 환불이 생기지 않는다(가정 — 업체 멱등 키 보존 기간 안).

## 5. 의존 — 나가는 방향

다른 모듈을 부르지 않는다(`D-02`). 나가는 곳은 PG와 자기 표뿐이다.

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| PG(토스페이먼츠형, 가정) | 승인 `POST /v1/payments/confirm`, 조회 `GET /v1/payments/orders/{orderNo}`, 가상계좌 발급 `POST /v1/virtual-accounts`, 취소 `POST /v1/payments/{paymentKey}/cancel {cancelReason, cancelAmount, refundReceiveAccount?}` | `TossPgGateway`가 `PgGateway`를 구현한다. `payment.pg.base-url`, `payment.pg.secret-key`(Basic 인증), `payment.pg.webhook-secret`(헤더 서명을 쓰는 업체일 때), 요청마다 `Idempotency-Key` 헤더 | 연결 3s, 읽기 — 승인·발급·취소 30s, 조회 5s | 업체의 상태 이름·오류 코드·본문 형식은 `TossPgGateway`·`PgResponseClassifier` 밖으로 나가지 않는다. 업체를 바꾸면 이 둘과 `parseNotice`·`authenticate`만 다시 쓴다. 멱등 키 지원이 계약의 전제다(§8) |
| MySQL(자기 표 셋) | `payments`·`payment_cancels`·`pg_webhook_events` | mall-api가 만든 데이터 소스와 트랜잭션 관리자. `PaymentStore`가 메서드마다 `TransactionTemplate`으로 짧은 트랜잭션을 연다 | 잠금 대기 5s(`innodb_lock_wait_timeout`과 별도로 쿼리 타임아웃) | 다른 모듈 표를 읽거나 조인하지 않는다(경계 검사 시험 — `C-21`) |

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| PG 연결 | 3s | `payment.pg.connect-timeout` | `PgHttpClient` |
| 승인 읽기 | 30s | `payment.pg.confirm-timeout` | `TossPgGateway.confirm` |
| 가상계좌 발급 읽기 | 30s | `payment.pg.issue-timeout` | `TossPgGateway.issueVirtualAccount` |
| 취소 읽기 | 30s | `payment.pg.cancel-timeout` | `TossPgGateway.cancel` |
| 조회 읽기(대사·웹훅 검증·폐기 전 조회) | 5s | `payment.pg.query-timeout` | `TossPgGateway.getPayment` |
| 자동 재시도 | 0회 — 다시 묻기는 호출자(대사 1분·웹훅 재전송·운영자 재시도) | — | `PgHttpClient` |
| 입금기한 | 발급 시각 + 72h | `payment.vbank.due-hours` | `PaymentStore.beginIssue` |
| 보존 기간 | 5년 | `payment.retention.years` | `PaymentStore`, `PaymentRetention.purgeExpired` |
| 기록 잠금 대기 | 5s — 넘으면 `unknown`·`unavailable` | `payment.store.lock-timeout` | `PaymentStore.begin*`·`applyNotice` |

- **인증**: payment는 HTTP 라우트가 없어 사용자 인증을 하지 않는다 — 부르는 쪽은 같은 프로세스의 order·claim·mall-api이고, 호출 권한은 모듈 경계 검사(`C-21`)가 공개 인터페이스 `PaymentApi`만 허용하는 것으로 지킨다. PG 비밀키는 환경 변수나 비밀 저장소로만 넣고 DB·로그·응답 원문에 남기지 않는다. HTTP 로그에서 `Authorization` 헤더와 계좌 번호를 가린다. 웹훅의 출처는 `authenticate`와 PG 조회 두 겹으로 확인한다 — 서명이 맞아도 본문의 상태를 믿지 않는다(`C-11`).
- **동시성**: 같은 주문의 승인·발급은 `payments.order_id` 유일 제약과 행 잠금으로 줄을 선다. 같은 결제의 취소는 행 잠금 + 「걸린 취소 하나」 규칙(§4 불변조건 ②)으로 줄을 선다 — 잔액 검사와 차감이 겹치지 않는다. 같은 웹훅의 동시 도착은 `event_id` 유일 제약이 하나만 통과시킨다. 잠금은 PG 호출 동안 쥐지 않는다 — `begin*` 트랜잭션을 커밋한 뒤 PG를 부르고, 결과 쓰기에서 다시 잠근다.
- **최후 방어**: 공개 메서드는 `@Transactional(propagation = NEVER)`로 둬 호출자 트랜잭션 안에서 불리면 `TRANSACTION_ACTIVE`로 바로 실패한다 — PG 호출이 DB 트랜잭션을 30초 붙잡는 일과, 호출자 롤백이 payment 기록까지 지우는 일을 막는다([상위 §6.3](../system-design-to-be.md#63-트랜잭션-경계)). 결과를 기록하지 못하면 `unknown`을 돌려주고(§2), 행은 `APPROVE_REQUESTED`·`REQUESTED`로 남아 대사·재시도가 PG 사실로 맞춘다. `PG_AUTH_ERROR`(비밀키 오류)와 상태 기계에 없는 PG 사실(`DECLINED`인데 PG `DONE`, `CANCELLED`인데 PG `EXPIRED`, 우리 기록에 없는 취소 등)은 기록을 바꾸지 않고 오류 로그 경보를 남긴다. 업무상 안 되는 취소(입금됨·계좌 없음·진행 중 취소 등)는 예외가 아니라 `failed {code}`라, 호출자가 예외 처리를 빠뜨려 트랜잭션이 엉뚱하게 롤백되는 일이 없다.

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 응답 판정 | `JF-1.1` — 2xx, 4xx, 401·403, 408·409·429, 「이미 처리됨」 코드, 5xx, 읽기 타임아웃, 연결 끊김, 깨진 본문 | 가짜 HTTP 서버(WireMock 등)로 각 응답을 주고 `approved`·`rejected`·`indeterminate`를 단언한다. `./gradlew :payment:test`(잠정 — 스택 확정 뒤 명령 고정) | payment 작업(상위 §9.1 순서 2) |
| 승인 멱등·기록 순서 | `JF-1` — 같은 주문 두 번(첫 결과 `paid`·`declined`·`unknown`), 다른 `paymentKey`, 결과 쓰기 실패 주입 | 가짜 `PgGateway` 호출 수를 센다 — 정해진 결과면 0회, `unknown` 뒤면 같은 멱등 키로 1회. 결과 쓰기 실패 → `unknown`, 행 `APPROVE_REQUESTED` → `queryPayment`가 `PAID`로 맞춘다 | payment 작업 |
| 취소 멱등·모드 | `JF-2` — 부분 취소 둘(다른 키), 같은 키 재요청, 같은 키 다른 금액(예외), 걸린 취소 중 다른 키, 잔액 초과(예외), 폐기 전 조회 `DONE`·`CANCELED`·`EXPIRED`, `VOID`인데 기록 `PAID`, `REFUND`인데 기록 `WAITING_DEPOSIT`, 가상계좌 결제 환불에 계좌 없음, 기록 없음, PG 거절, 「이미 취소됨」 4xx, `UNKNOWN` 뒤 재호출, `FAILED` 뒤 재요청 | 잔액·상태 단언, 업무 결과는 예외 없이 `failed {code}`(`CANCEL_IN_PROGRESS`·`ALREADY_DEPOSITED`·`NOT_CANCELLABLE`·`REFUND_ACCOUNT_REQUIRED`·`PG_REJECTED`)인지, `VOID` + `PAID`는 취소 API 0회(환불로 바뀌지 않음), 폐기 전 조회 `DONE`이면 취소 API 0회 + `failed ALREADY_DEPOSITED` + 결제 `PAID`, `CANCELED`·`EXPIRED`·「이미 취소됨」은 `cancelled`, PG 키가 `UNKNOWN` 뒤엔 같고 `FAILED` 뒤엔 `#2`인지 | payment 작업 |
| 조회 맞추기 | `JF-3` — PG 상태 9종(§2 판정)과 404·타임아웃, 로컬 기록 없음, 결과 불명 전액 취소·폐기가 걸린 채 PG `CANCELED`·`EXPIRED`, 결과 불명 폐기(`VOID`)가 걸린 채 PG `DONE`, 기록 `CANCELLED`인데 PG `EXPIRED` | 갈래와 맞춘 상태를 표로 단언. `IN_PROGRESS` → `unknown`. 걸린 전액 취소 기록이 `CANCELLED`로 닫히는지, 걸린 폐기 + `DONE`이면 폐기 기록 `FAILED ALREADY_DEPOSITED`·결제 `PAID`이고 이어서 `claim:` `REFUND`가 `CANCEL_IN_PROGRESS` 없이 PG 취소까지 가는지, 상태 기계에 없는 전이는 기록 그대로 + 경보인지 | payment 작업 |
| 웹훅 검증 | `JF-5` — 깨진 본문, 서명 불일치, 모르는 주문, 같은 이벤트 2회(순차·동시), PG 조회 타임아웃, 본문은 입금인데 PG는 대기, 닫은 계좌에 `DONE`, 카드 `DONE`, `CANCELED`(우리 전액 취소·폐기 있음, 부분 취소 합 = 결제액인 전체 반품, 우리 취소 없음), 폐기가 걸린 채 `DONE`, 폐기 중 `EXPIRED`, 기록 `CANCELLED`에 `EXPIRED` | 판정 표대로 `rejected`·`ignored`·`duplicate {first}`(PG 조회 1회)·`unavailable`(이벤트 행 0)·`ignored`·`deposited` + 경보·`ignored NOT_HANDLED`·`cancelled {ours:true}`·`cancelled {ours:true}`·`cancelled {ours:false}`·`deposited` + 폐기 기록 `FAILED ALREADY_DEPOSITED`(이어서 다른 키 `REFUND`가 `CANCEL_IN_PROGRESS` 아님)·`expired` + 폐기 기록 `CANCELLED`·기록 그대로 | payment 작업 |
| 가상계좌 재발급 | `JF-4` — 결과 불명 뒤 재발급(같은 은행), 결과 불명 뒤 은행 변경, 거절 뒤 재발급 | 호출자 입력에 시도 번호가 없어도 PG 멱등 키가 각각 `vbank:<orderId>`·`vbank:<orderId>#2`·`vbank:<orderId>#2`이고(번호는 `beginIssue`만 올린다), 같은 키의 본문이 같은지 | payment 작업 |
| 트랜잭션 밖 전제 | 다섯 메서드 | 시험에서 트랜잭션을 연 채 부르면 `TRANSACTION_ACTIVE` | payment 작업 |
| 업체 계약 확인 | `TossPgGateway` 전체, 멱등 키 동작, 웹훅 서명·`secret`, 미입금 결제 취소 = 폐기 | 고른 PG 시험 환경(테스트 키)에서 승인 → 같은 키 재승인 → 조회 → 부분 취소 → 같은 키 재취소, 가상계좌 발급 → 시험 입금 → 웹훅 수신. 상위 §9.2 「외부 계약 확인」 행과 같은 작업 | payment 작업 **전** |
| 보존 파기 | `purgeExpired` | 시계를 옮긴 시험 DB에서 5년 1일 지난 행만 지워지고 `PurgeResult.deleted`가 지운 행 수와 같은지 | 상위 §9.1 순서 6 |

경계를 넘는 끝단 시험(결제·가상계좌·취소·반품 끝단)은 [상위 §9.2](../system-design-to-be.md#92-검증)가 원본이다. 이 표의 시험은 order 없이 payment만으로 돈다(`D-02`).

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-12` | 미확정 | 가상계좌로 결제한 주문의 환불 계좌 실명 확인 — 계좌는 order(주문 취소 본문)·claim(반품 신청 본문)이 받아 `cancel`의 `refundAccount`로 넘기고, payment는 PG `refundReceiveAccount`에 싣는다. 예금주와 계좌가 맞는지 미리 확인하는 곳이 없다 | [상위 §9.5](../system-design-to-be.md#95-미확정필요-입력) | 계좌가 틀리면 PG가 거절해 `failed PG_REJECTED`가 된다(가정 — 업체가 환불 시점에 확인). 호출자는 계좌를 고쳐 같은 키로 다시 부른다(시도 번호 +1). 업체 환불 API의 계좌 형식이 다르면 `TossPgGateway`만 바뀐다 |
| `D-04`·`R-18` | 위험 | PG가 멱등 키를 지원하지 않거나 보존 기간이 짧으면(가정 15일) 같은 키 재호출이 이중 승인·이중 취소가 될 수 있다 | §2 멱등, §4.2 | 업체 계약 확인(§7)에서 본다. 지원하지 않으면 `TossPgGateway`가 재호출 전에 `getPayment`로 먼저 확인하도록 바꾼다 — 공개 계약은 그대로다 |
| `C-11` | 미확정 | 웹훅 출처 확인 방식(헤더 서명·발급 응답 `secret`)과 이벤트 ID 유무 | [상위 §9.5](../system-design-to-be.md#95-미확정필요-입력) | `parseNotice`·`authenticate`만 바뀐다. 이벤트 ID가 없으면 해시 키라 같은 상태 통보가 다른 시각으로 오면 `duplicate`가 아닌 새 이벤트가 된다 — order의 조건부 전이가 막는다 |
| `R-19` | 위험 | 첫 통보를 검증·기록한 뒤 order의 반영 트랜잭션이 롤백되면, 재전송은 `duplicate`가 된다 | `JF-5` | `duplicate`에 첫 사실을 실어 order가 `first`의 사실로 조건부 전이를 다시 시도한다(이미 반영됐으면 전이가 0행 → 200) |
| `R-13`·`R-14` | 위험 | 결과 불명인 취소가 걸려 있는 동안 같은 결제의 다른 취소가 `CANCEL_IN_PROGRESS`로 막힌다 | §4 불변조건 ② | 걸린 취소는 같은 키 재호출로만 닫힌다 — claim은 `REFUND_PENDING` 재시도, order는 `CANCELLING` 대사에서 `queryPayment`를 먼저 불러 전액 취소·폐기가 PG에서 끝났으면(`cancelled`) 그것으로 닫고, `paid`(취소 안 됨)면 같은 `cancel:<orderId>` 키로 `cancel`을 다시 부른다. 부분 취소(반품)는 같은 키 재호출로만 닫힌다. 걸린 폐기(`VOID`)는 PG 입금 확인(대사 조회·입금 통보)이 `FAILED ALREADY_DEPOSITED`로 닫아, 입금된 주문의 취소·반품 환불이 영구히 막히지 않는다 |
| `C-10` | 위험 | 결과 쓰기 실패 → PG는 승인했는데 `unknown` | §2 「기록 먼저, 응답 나중」 | 고객은 「결제 확인 중」을 보고, 대사(1분)가 `PAID`로 닫는다. DB 장애가 길면 대사도 쓰지 못해 `APPROVING`이 길어진다 — order의 10분 경보가 알린다 |
| `R-25` | 미확정 | 5년 보존의 기산점(결제일·마지막 취소일)과 응답 원문 속 개인정보(입금자명·마스킹 카드 번호·현금영수증 번호)의 보관 범위 | [상위 §6.2](../system-design-to-be.md#62-권위-소유자와-생명주기) | 잠정은 마지막 상태 변경 + 5년, 원문 그대로 보관. 법무 검토 뒤 원문에서 지울 필드를 정하면 `pg_raw_log`를 쓸 때 가린다 |
| `C-11` | 위험 | 결과 불명인 가상계좌 발급은 PG에 계좌가 생겼을 수 있다 | `JF-4` | 고객이 계좌 번호를 모르고, 같은 키 재발급이 같은 계좌를 돌려준다(가정). 재발급 없이 주문이 만료되거나 은행을 바꿔 새 시도를 하면 앞 계좌는 PG 입금기한에 닫힌다 — 그 사이 입금은 `JF-5`의 「닫은 계좌에 `DONE`」 경보로 드러난다 |
| `C-11` | 미확인 | 새 시도(`vbank:<orderId>#<n>`)가 PG에서 같은 주문 번호로 받아들여지는가 | `JF-4`, 업체 계약 | 업체가 주문 번호당 결제 하나만 받으면 새 시도마다 PG 주문 번호에 접미사를 붙여야 하고, 조회(`getPayment`)도 시도별 주문 번호로 해야 한다. 업체 계약 확인(§7)에서 본다 — 공개 계약은 그대로다 |
| `C-11` | 위험 | PG 콘솔에서 운영자가 직접 한 취소·부분 취소는 우리 취소 기록에 없다 | `JF-5` 판정 표 | `cancelled {ours:false}`로 order에 알려 `MANUAL_REVIEW` 경보가 나게 한다. 부분 취소는 `ignored` + 경보 로그뿐이라 결제 잔액이 PG와 어긋날 수 있다 — 콘솔 취소를 금지하는 운영 규칙을 둔다 |

## 9. 미확인·한계

1. 코드와 실행 환경이 없다 — 계약·상태·수치(타임아웃 30s·5s, 입금기한 72h, 보존 5년)는 설계값이고 실행으로 확인한 것이 없다.
2. PG 업체를 정하지 않았다 — 엔드포인트·상태 이름(`DONE`·`WAITING_FOR_DEPOSIT` 등)·오류 코드·멱등 키 보존 기간·웹훅 서명과 재전송 정책·미입금 결제 취소의 폐기 처리는 토스페이먼츠형 공개 문서의 형태를 가정했고 시험 환경에서 확인하지 않았다.
3. 「이미 처리됨」류 4xx 코드 목록은 업체마다 달라 정하지 않았다 — `PgResponseClassifier`의 표는 업체 계약 확인(§7)에서 채운다.
4. 잠정 스택(Java·Spring) 기준의 심볼과 설정 키다 — 스택이 바뀌면 `propagation = NEVER` 같은 최후 방어의 구현 수단이 바뀐다(계약은 같다).
5. 렌더 확인은 이 문서의 jobflow 여섯 그림을 SVG → PNG로 본 것까지다. `state` 두 블록은 렌더하지 않았다(정적 검토).
