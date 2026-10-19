# notification (모듈) — TO-BE 상세

> **대상**: notification 모듈 전체 — 호출자 트랜잭션 안의 알림 적재(아웃박스), 템플릿 8종과 변수 검증, 디스패치 타이머의 알림톡 발송·재시도·고착 복구, 발송 끝난 행 정리(`C-18`·`D-06`·`R-22`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드 없는 신규 설계의 문서 기준점)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·심볼·테이블·설정이 제안이다 — 그래서 `(제안)` 표시는 생략한다. 알림톡 대행사의 동작은 「가정」, 확인하지 못한 것은 「미확인」으로 적는다. 그림 근거 열은 `R`·`C`·`D` ID다. 심볼 이름은 상위 §9.5의 잠정 스택(Java 21 + Spring Boot 3, MySQL 8)을 따른 예시다

## 1. 책임 / 비책임

- **책임**: 다른 모듈이 업무 트랜잭션 안에서 부르는 `enqueue(template, recipient, vars, dedupKey)`로 알림 한 건을 같은 커넥션으로 `notification_outbox`에 적는다 — 업무가 커밋되면 알림이 반드시 남고, 롤백되면 남지 않는다. 같은 `dedupKey`는 한 번만 적는다. 템플릿 8종을 소유하고, 적재 때 변수·수신 번호를 검사해 심사받은 문구로 메시지를 완성한다. 디스패치 타이머(10초)가 대기 알림을 20건씩 잠가 꺼내(한 틱 시간 예산 1분) 알림톡 대행사로 보내고 결과를 적는다 — 성공 `SENT`, 일시 오류는 1·5·30분 뒤 다시(최대 3회), 영구 오류는 `FAILED`. 처리 중 프로세스가 죽어 `SENDING`에 멈춘 행을 리스 만료로 되살린다. 발송 끝난 행을 90일 뒤 지운다(`C-18`, `D-06`, `R-22`).
- **비책임**: 언제 어떤 알림을 보낼지와 수신 번호·변수 값(호출자 — order·claim), `dedupKey`의 모양(호출자가 업무 ID로 만든다), 알림톡 실패 시 문자 대체발송과 실제 도달(대행사 — 가정), 템플릿 심사(카카오·대행사, 운영 주체의 절차 — 상위 §9.3), 타이머 주기 실행과 다중 인스턴스 조정(mall-api 스케줄러), 수신 동의(정보성 알림이라 받지 않는다 — §6).
- **아무도 하지 않는 것**: 대행사 접수 뒤 실제 도달 결과(알림톡 성공·문자 대체·실패) 수신과 기록(범위 밖 — §9), `FAILED` 알림의 운영자 재발송 화면, 템플릿 편집 화면(템플릿은 마이그레이션으로 넣는다), 입금기한 만료 알림(템플릿이 없다 — §8), 광고성 메시지(친구톡 등). 교환 접수·교환 완료·교환 거절은 `CLAIM_REQUESTED`·`CLAIM_COMPLETED`·`CLAIM_REJECTED`가 `claimType`으로 반품과 함께 덮는다.

## 2. 공개 계약

전수 3개 — 서비스 2(`enqueue`, `purgeExpired`)와 타이머 진입점 1(`onDispatchTick`). HTTP 라우트는 없다. 서비스 인터페이스는 `NotificationApi`(공개 패키지)이고 조립 지점이 order·claim에 주입한다. 타이머 진입은 따로 `NotificationJobs`(공개 패키지)이고 mall-api 스케줄러가 부른다. `purgeExpired`는 공용 `RetentionTask`의 구현이다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| 서비스 `enqueue(template, recipient, vars, dedupKey)` | `template` = 템플릿 코드(§2.1의 8종), `recipient` = 휴대폰 번호 문자열(`010-1234-5678`·`01012345678` 모두 받아 숫자만 남긴다), `vars` = 문자열 맵, `dedupKey` = 1~120자. **호출자 트랜잭션 안에서만** 부른다 | `{outboxId, outcome}` — `QUEUED`(대기 행 적재), `DUPLICATE`(같은 `dedupKey`가 이미 있어 아무것도 안 함), `REJECTED`(템플릿 없음·비활성, 변수 누락, 번호 형식 오류 — `FAILED` 행으로 적고 경보 로그) | 내용 문제로는 던지지 않는다. 트랜잭션 밖 호출은 `IllegalTransactionStateException`(프로그래밍 오류), DB 오류는 그대로 던져 호출자 트랜잭션이 롤백된다 | `NotificationApi.enqueue` → `NotificationService.enqueue` — `C-18`·`D-06`·`R-22` |
| 타이머 `onDispatchTick()` | 없음 — mall-api 스케줄러가 앞 실행이 끝난 뒤 10초마다 부른다 | 없음(로그 `claimed, sent, retried, failed, recovered, budgetExceeded`) — 20건씩 꺼내기를 시간 예산 1분 안에서 되풀이 | 대행사 오류는 행 상태로 남기고 던지지 않는다. DB 오류는 이번 틱만 끝내고 다음 틱에 다시 | `NotificationJobs.onDispatchTick` → `NotificationDispatcher.dispatchDue` — `C-18`·`R-22` |
| 서비스 `purgeExpired(now)` | 기준 시각 | `PurgeResult {task:'notification', deleted}` | 없음 | `NotificationMaintenance.purgeExpired`(`RetentionTask` 구현) — mall-api 보존 작업이 하루 1회 부른다 — `C-18` |

- **트랜잭션 계약**: `enqueue`는 호출자 트랜잭션에 참여한다(`@Transactional(propagation = MANDATORY)`) — 같은 커넥션이라 업무 행과 알림 행이 함께 커밋·롤백된다(`D-06`). 대행사는 부르지 않는다.
- **내용 오류에 던지지 않는 이유**: `enqueue`가 예외를 던지면 호출자의 업무 트랜잭션이 롤백된다. 결제 확정 중이면 망취소까지 간다(상위 §5.7 `commitFailed`). 알림 템플릿 실수가 주문을 막지 않게, 내용 오류는 `REJECTED`(`FAILED` 행 + 경보)로 남기고 업무는 계속한다. 이 오류는 시험에서 잡는 것이 원칙이다(§7).
- **중복**: `dedupKey` 유일 제약 + `INSERT … ON DUPLICATE KEY UPDATE outbox_id = outbox_id`(아무것도 안 바꾸는 갱신)로 중복을 조용히 무시한다. 예외를 잡는 방식은 쓰지 않는다 — 호출자 트랜잭션을 롤백 전용으로 만들 수 있어서다. `REJECTED`도 같은 `dedupKey`를 차지한다.
- **`dedupKey` 규약**(호출자가 만든다 — 아래 §2.1 열): `<알림 종류>:<업무 ID>`. 업무 사건 하나에 키 하나다. 같은 사건이 다른 트리거로 다시 와도(대사·웹훅 재전송) 같은 키라 한 건이다.
- **호환성**: 템플릿을 더할 때는 행을 더하는 마이그레이션 + 호출 쪽 배포 순서다(템플릿 행이 먼저). 기존 템플릿 문구를 바꾸면 대행사 재심사가 필요하다 — 심사 전에는 `active=false`로 두지 않고 옛 문구를 유지한다(§8).

### 2.1 템플릿 목록

템플릿 8종(상위 §9.5). 문구 원본은 `notification_templates` 행이고 대행사 심사를 받은 문구와 글자까지 같아야 한다(가정 — 알림톡 규칙). 버튼 주소는 `mall.notification.link-base-url`(예: `https://<도메인>`) 뒤에 붙인다.

| 코드 | 알림 | 호출자·상위 그림 | 필수 변수 | 버튼 | `dedupKey` |
|---|---|---|---|---|---|
| `ORDER_PAID` | 주문 완료(카드·간편결제 결제 완료) | order — §5.7 `approvePayment.paid`, §5.8 `OnReconcileTick.paid` | `ordererName`, `orderNo`, `orderName`, `amount`, `orderId` | 「주문 상세」 `/orders/#{orderId}` | `order-paid:<orderId>` |
| `VBANK_ISSUED` | 입금 안내 | order — §5.9 `issueVirtualAccount` | `ordererName`, `orderNo`, `bankName`, `accountNumber`, `amount`, `dueAt` | 「주문 상세」 | `vbank-issued:<orderId>` |
| `VBANK_DEPOSITED` | 입금 확인 | order — §5.9 `handlePgWebhook.deposited` | `ordererName`, `orderNo`, `amount`, `orderId` | 「주문 상세」 | `vbank-deposited:<orderId>` |
| `SHIPPING_STARTED` | 배송 시작 | order — §5.11 `registerShipment` | `ordererName`, `orderNo`, `carrierName`, `trackingNumber`, `orderId` | 「배송 조회」 `/orders/#{orderId}`(N8 직접 진입) | `shipping-started:<shipmentId>` |
| `ORDER_CANCELLED` | 주문 취소(결제한 주문만) | order — §5.10 `cancelOrder.cancelled` | `ordererName`, `orderNo`, `refundAmount`, `orderId` | 「주문 상세」 | `order-cancelled:<orderId>` |
| `CLAIM_REQUESTED` | 반품·교환 접수 | claim — §5.12 `requestReturn`(교환 신청 포함) | `orderNo`, `orderId`, `claimType`, `productSummary` | 「주문 상세」 | `claim-requested:<claimId>` |
| `CLAIM_COMPLETED` | 반품 완료(환불)·교환 완료 | claim — §5.12 `completeReturn`, 교환 완료 | `orderNo`, `orderId`, `claimType`, `refundAmount`(`claimType`이 반품일 때만 필수) | 「주문 상세」 | `claim-completed:<claimId>` |
| `CLAIM_REJECTED` | 반품·교환 거절 | claim — §5.12 그림 밖 거절 | `orderNo`, `orderId`, `claimType`, `reasonText` | 「주문 상세」 | `claim-rejected:<claimId>` |

- 상위 그림에 이름이 나온 `ORDER_PAID`·`VBANK_ISSUED`·`SHIPPING_STARTED`는 그대로 썼다. 클레임 셋은 [claim 상세](claim.md#2-공개-계약)의 적재 지점과 같은 이름이고, 셋 모두 `orderNo`·`orderId`·`claimType`(`RETURN`·`EXCHANGE` → 문구 「반품」·「교환」)을 늘 받는다 — 교환 접수·완료·거절도 이 셋이 덮는다. `CLAIM_COMPLETED`는 반품이면 `refundAmount`를, `CLAIM_REJECTED`는 `reasonText`를 더 받는다. 템플릿 8종이 상위 §9.5의 목록이다.
- **조건부 필수 변수**: `required_vars`는 `{name, when?}` 목록이다 — `CLAIM_COMPLETED`의 `refundAmount`는 `when: claimType=RETURN`. 조건이 맞을 때 비어 있으면 누락(`MISSING_VAR`)이다.
- 금액 변수는 호출자가 원 단위 정수 문자열로 넘기고, 적재 때 `12,300원` 꼴로 바꾼다. 시각 변수(`dueAt`)는 ISO-8601을 받아 `10월 22일(수) 23:59`로 바꾼다. 형식 변환 실패도 `REJECTED`다.
- 필수 변수에 없는 변수가 더 오면 무시한다. 변수 값이 비어 있으면 누락으로 본다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 실제 조율자는 셋이고 서로 부르지 않는다 — 적재의 `NotificationService`(`NotificationApi` 구현), 발송의 `NotificationDispatcher`(타이머 진입 `NotificationJobs`가 부르고, 한 건 발송은 `OutboxSender`가 맡는다), 정리의 `NotificationMaintenance`. 바깥으로 나가는 객체는 알림톡 대행사를 부르는 `AlimTalkGateway` 하나다. 다른 모듈은 부르지 않는다(워커 — `D-02`).

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Notification.enqueue`(§5.1·§5.7·§5.8·§5.9·§5.10·§5.11·§5.12) = `NotificationApi.enqueue` | [`JF-1` 알림 적재](#jf-1-알림-적재--notificationserviceenqueue) | — |
| `Notification.OnDispatchTick`(§5.1·§5.16) = `NotificationJobs.onDispatchTick` | [`JF-2` 디스패치 틱](#jf-2-디스패치-틱--notificationjobsondispatchtick) | [`JF-2.1` 한 건 발송과 결과 판정](#jf-21-한-건-발송과-결과-판정--outboxsendersend) |
| `Notification.cleanupSupport`(§5.1 묶음)·`Notification.purgeExpired`(§5.17) = `NotificationMaintenance.purgeExpired` | [`JF-3` 발송 끝난 행 정리](#jf-3-발송-끝난-행-정리--notificationmaintenancepurgeexpired) | — |

상위 바깥 노드 ↔ 이 경계의 객체: `AlimTalk.send`(§5.1·§5.16) = `AlimTalkGateway.send`(대행사 발송 API 1회, 5s). `AlimTalk.send.failed`(§5.16)는 `JF-2.1`의 `.retryable`·`.rejected` 두 갈래로 열린다.

**표기** 노드는 제안 클래스·메서드다. 타이머 진입 `NotificationJobs.onDispatchTick`은 상위 `Notification.OnDispatchTick`과 같은 계약이고 자바 메서드 이름 규칙에 맞춰 소문자로 시작했다 — 렌더러는 `on`으로 시작하는 이름을 이벤트 모양(`DispatchTick`)으로 그린다. `OutboxStore`는 `notification_outbox` 저장소, `TemplateStore`는 `notification_templates` 저장소다. 렌더 확인은 이 문서의 jobflow 블록 전부를 대상 렌더러로 SVG·PNG로 그려 봤다. 열지 않은 것: `MessageComposer`의 변수 치환·형식 변환(순수 함수), `RetryPolicy.next`(순수 함수 — 표가 원본).

### JF-1 알림 적재 — NotificationService.enqueue

```jobflow
orchestrator: NotificationService
Object: NotificationService, TemplateStore, MessageComposer, OutboxStore

NotificationService.enqueue --> TemplateStore.find
TemplateStore.find.unavailable --> OutboxStore.insertRejected
TemplateStore.find.result --> MessageComposer.compose
MessageComposer.compose.invalid --> OutboxStore.insertRejected
MessageComposer.compose.result --> OutboxStore.insertPending
OutboxStore.insertPending.duplicate
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `NotificationService.enqueue` | `C-18`·`D-06` | 상위 `Notification.enqueue(template, recipient, vars, dedupKey)`. 호출자 트랜잭션에 참여한다(MANDATORY). `dedupKey` 길이가 틀리면 `REJECTED` 행을 만들 수 없어 경보 로그만 남기고 `REJECTED`를 돌려준다(그리지 않음) |
| `TemplateStore.find` | `C-18` | 템플릿 코드로 행을 읽는다(기본키, 같은 트랜잭션). 행이 없거나 `active=false`면 `.unavailable` |
| `MessageComposer.compose` | `C-18`·`R-22` | 수신 번호를 숫자만 남기고 `^01[016789][0-9]{7,8}$` 확인, 필수 변수 확인, 금액·시각 형식 변환, 본문·버튼 주소·대체발송 문구 완성. 어기면 `.invalid {reason:'MISSING_VAR'·'BAD_PHONE'·'BAD_FORMAT', detail}` |
| `OutboxStore.insertPending` | `C-18`·`D-06` | `PENDING`, `attempts=0`, `next_attempt_at=지금`, 완성된 메시지 저장. 같은 `dedupKey`가 있으면 `.duplicate` → `DUPLICATE`(아무것도 안 바뀜) |
| `OutboxStore.insertRejected` | `C-18` | `FAILED`, `fail_reason`(`TEMPLATE_UNAVAILABLE`·`MISSING_VAR`·…), `finished_at=지금`, 메시지 없이 수신 번호와 템플릿 코드만 저장 + 경보 로그. 같은 `dedupKey`면 아무것도 안 한다 |

- **트리거** order·claim의 업무 트랜잭션 안 호출(상위 §5.7~§5.12). **완료 사실** 호출자가 커밋하면 알림 행 1건(`PENDING` 또는 `FAILED`), 롤백하면 0건(`R-22`).
- `insertRejected`로 들어오는 화살표 둘은 택일 경로(템플릿 없음·내용 오류)의 **합류**다 — 적재 한 번에 행 하나다.
- 메시지를 적재 때 완성하는 이유: 검사를 한 번에 끝내고(`REJECTED`가 업무 시점에 바로 보인다), 디스패치는 행만 읽어 보내면 된다. 대신 적재 뒤 템플릿 문구를 고쳐도 이미 쌓인 행에는 반영되지 않는다 — 대기 시간이 길어야 몇십 분이라 받아들인다.
- 이 그림의 모든 쓰기는 호출자 트랜잭션 안이다. 대행사·네트워크 호출이 없어 호출자 트랜잭션을 늘리지 않는다(행 하나 삽입).

### JF-2 디스패치 틱 — NotificationJobs.onDispatchTick

```jobflow
orchestrator: NotificationDispatcher
Object: NotificationJobs, NotificationDispatcher, OutboxStore, OutboxSender

NotificationJobs.onDispatchTick --> NotificationDispatcher.dispatchDue
NotificationDispatcher.dispatchDue --> OutboxStore.releaseExpiredLeases
NotificationDispatcher.dispatchDue --> OutboxStore.claimDue
OutboxStore.claimDue.empty
OutboxStore.claimDue.result --> OutboxSender.send
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `NotificationJobs.onDispatchTick` → `NotificationDispatcher.dispatchDue` | `C-18`·`R-22` | 상위 `Notification.OnDispatchTick`. mall-api 스케줄러가 고정 지연 10초로 부른다 — 앞 틱이 끝나야 다음 틱이 돈다. `dispatchDue`는 틱 시작 시각을 재고 시간 예산 1분을 지킨다 |
| `OutboxStore.releaseExpiredLeases` | `C-18` | 고착 복구 — `SENDING`이고 `lease_until < 지금`인 행: `attempts < 4`면 `PENDING`(`next_attempt_at=지금`), `attempts = 4`면 `FAILED`(`fail_reason='LEASE_EXPIRED'`). 한 문장의 조건부 갱신이다 |
| `OutboxStore.claimDue` | `C-18` | 한 트랜잭션 — `SELECT … WHERE status='PENDING' AND next_attempt_at <= 지금 ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED` → 고른 행을 `SENDING`, `attempts = attempts + 1`, `lease_until = 지금 + 5분`으로 바꾸고 커밋. 없으면 `.empty` — 이번 틱 끝 |
| `OutboxSender.send` | `C-18` | 잠근 행마다 한 번. 동시 10건까지(작업 스레드 10). 안쪽은 `JF-2.1`. 20건을 다 보내면 `dispatchDue`가 경과 시간을 보고 예산(1분) 안이고 방금 20건이 꽉 찼으면 `claimDue`를 다시 부른다 — 예산을 넘었으면 새 건을 고르지 않고 틱을 끝낸다 |

- **트리거** 디스패치 타이머 10초(상위 §5.16). **완료 사실** 꺼낸 행이 모두 `SENT`·`PENDING`(재시도 예약)·`FAILED` 중 하나가 된다(상위 §5.16 「알림 `SENT` 또는 재시도·`FAILED`」).
- 잠금 트랜잭션은 꺼내고 표시하는 데까지만이다. 대행사 호출은 커밋 뒤라 DB 잠금을 쥔 채 외부를 기다리지 않는다. `SKIP LOCKED` 덕분에 인스턴스가 둘 이상이어도 같은 행을 두 번 꺼내지 않는다 — mall-api가 작업마다 하나만 돌리더라도 이 모듈은 그것에 기대지 않는다.
- **시간 예산 1분과 리스 5분** 한 묶음은 20건 ÷ 동시 10 × 7s(연결 2s + 응답 5s) = 최악 14초다. 예산 1분 직전에 꺼낸 묶음까지 끝내도 틱은 최악 약 74초라, 리스 5분 안에 정상 처리 중인 행이 복구되지 않고 mall-api 잠금 `lockAtMostFor` 5분보다도 짧다. 한 틱이 행을 오래 쥐지 않아 다른 인스턴스·다음 틱이 나머지를 고르게 가져간다. 처리 중 프로세스가 죽으면 그 행들은 5분 뒤 다음 틱의 `releaseExpiredLeases`가 되살린다 — 대행사가 이미 받았을 수 있어 같은 알림이 두 번 갈 수 있다(§6·§8).
- `releaseExpiredLeases`를 `claimDue`보다 먼저 써서 되살린 행이 같은 틱에 바로 꺼내진다. 두 줄 순서가 실제 실행 순서다. `claimDue` → `send`의 되풀이(예산 안의 다음 묶음)는 그리지 않았다.

### JF-2.1 한 건 발송과 결과 판정 — OutboxSender.send

```jobflow
orchestrator: OutboxSender
Object: OutboxSender, AlimTalkGateway, RetryPolicy, OutboxStore

OutboxSender.send --> AlimTalkGateway.send
AlimTalkGateway.send.accepted --> OutboxStore.markSent
AlimTalkGateway.send.rejected --> OutboxStore.markFailed
AlimTalkGateway.send.retryable --> RetryPolicy.next
RetryPolicy.next.retry --> OutboxStore.scheduleRetry
RetryPolicy.next.exhausted --> OutboxStore.markFailed
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `AlimTalkGateway.send` | `C-18`·`R-22` | 상위 `AlimTalk.send`. 대행사 발송 API 1회 — `{clientMsgId: outboxId, senderKey, templateCode, to, message, buttons, fallback{type:'LMS', text}}`, 연결 2s + 응답 5s. 2xx + 접수 ID → `.accepted`, 4xx(템플릿 불일치·번호 오류·발신 프로필 오류) → `.rejected {code}`, 5xx·타임아웃·연결 실패·429 → `.retryable`(가정 — 대행사 오류 체계) |
| `OutboxStore.markSent` | `C-18` | `SENT`, `vendor_message_id`, `finished_at`. 조건 `WHERE outbox_id=? AND status='SENDING' AND attempts=?` — 리스가 만료돼 다른 틱이 다시 꺼낸 행이면 0행 갱신으로 무시한다 |
| `RetryPolicy.next` | `C-18` | `attempts` 1·2·3이면 `.retry` — 다음 시도 시각 = 지금 + 1분·5분·30분. `attempts = 4`면 `.exhausted` |
| `OutboxStore.scheduleRetry` | `C-18`·`R-22` | `PENDING`, `next_attempt_at`, `last_error`. 조건은 `markSent`와 같다 |
| `OutboxStore.markFailed` | `C-18` | `FAILED`, `fail_reason`(대행사 코드 또는 `RETRY_EXHAUSTED`), `finished_at` + 경보 로그. 조건은 `markSent`와 같다 |

- **트리거** `JF-2`가 잠근 행 하나. **완료 사실** 행이 `SENT`·`PENDING`·`FAILED` 중 하나 — 시도 수는 처음 1회 + 다시 보내기 최대 3회 = 4회다(상위 §5.16 「1·5·30분 뒤 다시」, `R-22` 「3회까지 다시 보낸다」).
- `markFailed`로 들어오는 화살표 둘은 택일 경로(영구 오류·재시도 소진)의 **합류**다 — 한 시도에 한 번이다.
- 대행사 접수(`SENT`)는 도달이 아니다. 알림톡이 실패하면 대행사가 `fallback`으로 LMS를 보낸다(가정). 실제 도달 결과는 받지 않는다(§9).
- 결과를 적는 갱신이 실패하면(DB 오류) 행은 `SENDING`으로 남고 5분 뒤 복구된다 — 이미 접수된 알림이 한 번 더 갈 수 있다(§8).

### JF-3 발송 끝난 행 정리 — NotificationMaintenance.purgeExpired

```jobflow
orchestrator: NotificationMaintenance
Object: NotificationMaintenance, OutboxStore

NotificationMaintenance.purgeExpired --> OutboxStore.deleteFinishedBefore
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `NotificationMaintenance.purgeExpired` | `C-18`·`R-25` | `RetentionTask` 구현. mall-api 하루 1회 보존 작업이 부른다(상위 §6.2 「발송 끝난 행 90일」). 상위 §5.17 `Notification.purgeExpired`. 결과 `PurgeResult {task:'notification', deleted}` |
| `OutboxStore.deleteFinishedBefore` | `C-18`·`R-25` | `status IN ('SENT','FAILED') AND finished_at < 지금 − 90일`을 1,000건씩 지운다(한 문장마다 커밋 — 긴 잠금을 피한다) |

- **완료 사실** 90일 지난 끝난 행이 사라진다 — 행에 든 수신 번호·이름·주소 같은 개인정보도 함께 사라진다. `PENDING`·`SENDING`은 지우지 않는다.

## 4. 소유 상태·데이터

**결론**: 표 둘(`notification_outbox`·`notification_templates`)을 소유한다. 알림 한 건의 상태는 아웃박스 행의 `status` 하나다.

| 표 | 주요 열 | 비고 |
|---|---|---|
| `notification_outbox` | `outbox_id` BIGINT PK, `dedup_key` VARCHAR(120) **UNIQUE**, `template_code`, `vendor_template_code`, `recipient_phone`, `message_body` TEXT, `buttons` JSON, `fallback_text`, `status` `PENDING`·`SENDING`·`SENT`·`FAILED`, `attempts` TINYINT, `next_attempt_at`, `lease_until`, `vendor_message_id`, `last_error`, `fail_reason`, `created_at`, `finished_at` | 색인 `(status, next_attempt_at)`(꺼내기), `(status, lease_until)`(복구), `(finished_at)`(정리). 호출자의 업무 ID는 `dedup_key` 안에만 있다 — 다른 모듈 표에 FK를 걸지 않는다 |
| `notification_templates` | `template_code` PK, `vendor_template_code`(대행사 심사 코드), `body`(`#{변수}` 자리표시), `required_vars` JSON(`[{name, when?}]`), `buttons` JSON(이름·주소 틀), `fallback_text`(대체발송 문구 틀), `active`, `updated_at` | 8행(§2.1의 8종), 마이그레이션으로 넣는다. 쓰기 라우트가 없다 |

- **보존**: 끝난 행(`SENT`·`FAILED`)은 `finished_at`에서 90일 뒤 지운다(상위 §6.2). 수신 번호와 완성된 메시지(이름·주문번호·계좌번호·송장번호)는 개인정보라 이 기간만 둔다. 끝나지 않은 행은 기한이 없다 — 최악도 마지막 시도(약 36분 뒤)나 리스 복구 뒤에 끝난다.
- **템플릿 행**은 지우지 않는다. 문구를 바꿀 때는 대행사 재심사 뒤 같은 행을 갱신한다.

### 4.1 아웃박스 행 상태 기계

상태 소유자는 notification 모듈(`notification_outbox.status`)이다. 초기화는 `enqueue`의 삽입(호출자 트랜잭션), 전이 입력은 디스패치 틱과 대행사 응답, 수명 끝은 90일 정리다.

```state
<s> --> (PENDING) : enqueue — 내용 검사 통과
<s> --> (FAILED) : enqueue — 템플릿 없음·변수 누락·번호 오류
(PENDING) --> (SENDING) : claimDue — 잠금, attempts+1
(SENDING) --> (SENT) : 대행사 접수
(SENDING) --> (PENDING) : 5xx·타임아웃 — attempts 3 이하, 1·5·30분 뒤
(SENDING) --> (FAILED) : 4xx 또는 attempts 4
(SENDING) --> (PENDING) : 리스 만료 — attempts 3 이하
(SENDING) --> (FAILED) : 리스 만료 — attempts 4
(SENT) --> <e> : 90일 뒤 정리
(FAILED) --> <e> : 90일 뒤 정리
```

**기호**: `<s>` 시작점, `(…)` 상태, `<e>` 행이 사라지는 곳, `A --> B : 글` 전이와 그 조건(`state-diagram-guide.md` 「구성 요소」).

- **불변조건**: `dedup_key`당 행 하나. `SENDING`이면 `lease_until`이 있다. `attempts`는 `SENDING`으로 갈 때만 오르고 4를 넘지 않는다. `SENT`·`FAILED`면 `finished_at`이 있고 다시 바뀌지 않는다.
- **우선순위**: 같은 행에 늦은 결과 갱신과 리스 복구가 겹치면, 결과 갱신의 조건(`status='SENDING' AND attempts=?`)이 먼저 이긴 쪽 하나만 남긴다. 리스 복구 뒤 다시 꺼내진 행에 옛 시도의 결과가 오면 `attempts`가 달라 무시된다.

## 5. 의존 — 나가는 방향

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| 알림톡 대행사 | 발송 API `POST <base>/alimtalk/send`(템플릿 코드·발신 프로필 키·수신 번호·본문·버튼·대체발송 문자·클라이언트 메시지 ID) → 접수 ID(가정 — 대행사 미정) | `mall.notification.alimtalk.base-url`, `mall.notification.alimtalk.api-key`·`sender-key`(비밀 — 환경 변수), `mall.notification.alimtalk.fallback-type=LMS` | 연결 2s, 응답 5s | 템플릿 코드와 문구가 대행사 심사분과 같아야 한다. 오류 코드의 4xx·5xx 구분, 클라이언트 메시지 ID로 중복을 거르는지는 가정이다(§8) |
| mall-api(들어오는 쪽) | 스케줄러의 `NotificationJobs.onDispatchTick`(고정 지연 10초, 잠금 `lockAtMostFor` 5분), 보존 작업의 `purgeExpired`(하루 1회), 트랜잭션 관리자(호출자 트랜잭션 전파) | 조립 지점 | — | 이 모듈은 다른 업무 모듈을 부르지 않는다(상위 §3.1 — 워커). order·claim이 `NotificationApi`만 안다 |

### 5.1 발송 채널과 야간 발송

- **채널**: 알림톡 1차, 대행사 대체발송(LMS) 2차(가정 — 대행사 기능). 대체발송 문구는 적재 때 템플릿의 `fallback_text`로 완성해 함께 보낸다. 버튼 링크는 LMS 본문 끝에 주소로 붙인다.
- **야간 발송**: 제한하지 않는다. 여덟 알림은 모두 고객의 거래에 따른 정보성 메시지다. 정보통신망법의 야간(21시~다음 날 8시) 광고성 정보 전송 제한은 광고성 정보에만 걸리고, 알림톡도 정보성 템플릿만 심사를 통과한다(가정 — 법무 확인 필요, 상위 §9.5 「법정 보존·파기 해석」과 함께). 그래서 수신 동의 확인과 야간 보류 큐를 두지 않는다.

## 6. 실패 경계

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 디스패치 주기 | 고정 지연 10초 | `mall.notification.dispatch.delay` | mall-api 스케줄러 → `NotificationJobs.onDispatchTick` |
| 한 번 꺼내기 | 20건 | `mall.notification.dispatch.batch-size` | `OutboxStore.claimDue` |
| 한 틱 시간 예산 | 1분 — 넘으면 새 묶음을 고르지 않는다 | `mall.notification.dispatch.budget` | `NotificationDispatcher.dispatchDue` |
| 동시 발송 | 10 | `mall.notification.dispatch.concurrency` | `OutboxSender` 작업 스레드 |
| 행 리스 | 5분 | `mall.notification.dispatch.lease` | `claimDue`·`releaseExpiredLeases` |
| 대행사 호출 | 연결 2s, 응답 5s | `mall.notification.alimtalk.connect-timeout`·`read-timeout` | `AlimTalkGateway.send` |
| 재시도 | 4회 시도(처음 + 1·5·30분 뒤), 5xx·타임아웃·연결 실패·429만 | `mall.notification.retry.delays=1m,5m,30m` | `RetryPolicy.next` |
| 보존 | 끝난 행 90일, 1,000건씩 삭제 | `mall.notification.retention`·`purge-batch-size` | `OutboxStore.deleteFinishedBefore` |

- **인증** HTTP 진입점이 없다 — 다른 모듈은 같은 프로세스의 `NotificationApi`로만 들어온다. 대행사 API 키·발신 프로필 키는 설정 파일이 아니라 환경 변수로 넣는다.
- **동시성** 꺼내기는 `FOR UPDATE SKIP LOCKED` + `SENDING` 표시로 한 행을 한 작업자만 잡는다. 결과 갱신은 `status`·`attempts` 조건부라 늦은 결과가 새 시도를 덮지 않는다. 적재는 `dedup_key` 유일 제약으로 같은 사건의 두 번째 적재를 막는다.
- **부분 실패** 대행사 장애 = 행이 재시도로 쌓이고 업무는 영향 없음(`D-06`), 내용 오류 = `FAILED` + 경보로 업무 계속, 결과 기록 실패·처리 중 종료 = 리스 만료로 복구(중복 발송 가능), DB 장애 = 이번 틱 포기·다음 틱.
- **최후 방어** `FAILED` 행과 오래된 `PENDING`(5분 넘게 대기)은 경보 로그로 드러난다. 운영자가 원인을 고친 뒤 다시 보내는 도구는 없다 — SQL로 `PENDING`·`attempts=0`으로 되돌리는 운영 절차만 있다(§8).
- **중복 vs 유실** 이 설계는 유실보다 중복을 고른다. 대행사가 접수했는데 우리가 결과를 못 적으면 같은 알림이 한 번 더 간다. 대행사가 클라이언트 메시지 ID(`outboxId`)로 중복을 거르면 사라진다(가정).

## 7. 검증 계획

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 같은 트랜잭션 적재 | `enqueue` × 호출자 커밋·롤백 | 시험 트랜잭션에서 업무 행 + `enqueue` 뒤 롤백 → 알림 0건, 커밋 → 1건. 트랜잭션 밖 호출 → 예외(상위 §9.2 「알림 끝단」) | 알림 아웃박스 작업(상위 §9.1 순서 2) |
| 중복 적재 | `dedupKey` | 같은 키 2회(같은 트랜잭션·다른 트랜잭션) → 행 1건, 두 번째 `DUPLICATE`, 호출자 트랜잭션은 커밋 가능 | 같음 |
| 내용 검사 | `JF-1` `.unavailable`·`.invalid` | 없는 템플릿, 비활성 템플릿, 변수 하나 누락, 번호 `0101234`, 금액 `abc` → 각각 `REJECTED`, `FAILED` 행, 경보 로그, 호출자 커밋 성공 | 같음 |
| 템플릿 계약 시험 | 호출자 × 템플릿 8종 | order·claim의 각 적재 지점이 넘기는 변수 맵이 `required_vars`를 모두 채우는지 — 호출 쪽 단위 시험에서 `REJECTED`가 0인지 단언 | order·claim 작업 |
| 재시도·판정 | `JF-2.1` | 가짜 대행사가 5xx 4회 → 시도 4회(가상 시계 1·5·30분 간격) → `FAILED RETRY_EXHAUSTED`. 4xx → 1회 시도 `FAILED`. 타임아웃 6s → `.retryable` | 같음 |
| 고착 복구 | `releaseExpiredLeases` | `SENDING`·`lease_until` 지남·`attempts` 2 → `PENDING`, `attempts` 4 → `FAILED LEASE_EXPIRED`. 복구 뒤 옛 시도의 결과 갱신 → 0행 | 같음 |
| 다중 작업자 | `claimDue` | 두 연결에서 동시에 `claimDue` → 겹치는 행 0, 한 번에 20건 이하 | 같음 |
| 시간 예산 | `dispatchDue` | 대기 300건, 가짜 대행사 응답 5s·가상 시계 → 예산 1분을 넘긴 뒤 새 묶음을 고르지 않음, 남은 행은 `PENDING` 그대로·다음 틱이 꺼냄 | 같음 |
| 정리 | `purgeExpired` | 시계를 옮긴 시험 DB에서 91일 지난 `SENT`·`FAILED`만 삭제, `PENDING`은 남음 | 상위 §9.1 순서 6 |
| 대행사 계약 | `AlimTalkGateway.send` | 고른 대행사 시험 환경에서 템플릿 발송, 번호 오류의 응답 코드, 같은 클라이언트 메시지 ID 재전송의 동작, 대체발송 | 대행사 선정 뒤, 첫 배포 전 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `C-18`·`R-22` | 위험 | 처리 중 종료·결과 기록 실패 뒤 리스 복구로 같은 알림이 두 번 갈 수 있다 | §6 「중복 vs 유실」 | 정보성 알림이라 유실보다 중복을 받아들인다. 대행사가 클라이언트 메시지 ID로 중복을 거르면 사라진다 — 대행사 계약 확인(§7) |
| `C-18` | 미확정 | 상위 §5.16의 「3회 실패나 4xx는 `FAILED`」와 「1·5·30분 뒤 다시」의 시도 수 | 상위 §5.16·`R-22` | 잠정: 처음 1회 + 다시 3회 = 4회(지연 셋을 모두 쓴다). 「3회 시도」로 읽으면 30분 지연은 쓰이지 않는다 — 상위 §5.16 문구를 이 해석으로 맞춰야 한다 |
| `C-18` | 미확정 | 템플릿 심사 전·재심사 중 발송 | 상위 §9.5 「알림톡 템플릿」 | 잠정: 심사 전 템플릿은 `active=false` → `REJECTED`(기록만). 문자로 대신 보낼지 정하면 `fallback_text`만 보내는 경로를 더한다 |
| `C-18` | 미확정 | 가상계좌 입금기한 만료 알림 | 상위 §5.9 | 템플릿 8종에 없다 — 만료를 알릴지는 운영 정책이다(상위 §9.5). 교환 접수·완료·거절은 `CLAIM_*`가 `claimType`으로 덮어 따로 두지 않는다 |
| `D-06` | 미확정 | `enqueue`가 내용 오류에 던지지 않는다 | §2 | 잘못된 변수로 알림이 조용히 `FAILED`가 될 수 있다. 경보 로그와 호출 쪽 계약 시험(§7)으로 막는다. 엄격하게 던지게 바꾸면 알림 실수가 결제 확정을 롤백시킨다 |
| `C-18` | 위험 | 대행사 오류 코드의 4xx·5xx 구분이 가정이다 | §5 | 대행사가 일시 오류를 4xx로 주면 다시 보내지 않고 `FAILED`가 된다. 대행사 선정 뒤 코드 표로 `.rejected`·`.retryable`을 다시 나눈다 |
| `C-18`·`R-25` | 미확정 | 야간 발송을 제한하지 않는 판단 | §5.1 | 정보성 알림의 야간 전송은 허용된다고 보았다(가정). 법무 검토 결과 제한이 필요하면 `next_attempt_at`을 다음 날 8시로 미루는 규칙을 `RetryPolicy` 앞에 둔다 |
| `C-18` | 위험 | 대기 행이 쌓이면 처리량은 한 틱 예산 1분 안의 묶음 수 × 20건이다 — 대행사 응답이 1s면 틱당 약 600건(묶음당 2s), 5s면 틱당 약 120건(묶음당 10s)(설계상 예상, 미측정) | §6 | 교육용 규모에 충분하다고 본다. 넘치면 동시 수를 늘리거나 예산을 늘린다(예산은 `lockAtMostFor` 5분보다 짧게) |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 주기·리스·타임아웃·재시도 간격은 설계값이고 측정하지 않았다.
2. 알림톡 대행사를 정하지 않았다 — 발송 API 형식, 오류 코드 체계, 클라이언트 메시지 ID 중복 거르기, 대체발송(LMS) 동작, 템플릿 문구 일치 규칙은 국내 대행사의 보편 형태를 가정했다.
3. 대행사 접수 뒤 실제 도달 결과(알림톡 성공, 문자 대체, 수신 실패)는 받지 않는다 — 대행사의 결과 조회·웹훅 계약을 확인하지 않았고 이 설계의 범위 밖이다. `SENT`는 접수일 뿐이다.
4. 정보성 알림의 야간 발송 허용과 수신 번호 보관 90일은 법무 검토를 거치지 않았다.
5. 렌더 확인은 대상 jobflow 렌더러로 만든 SVG·PNG를 눈으로 본 것이고, 문서 사이트 안의 표시는 확인하지 않았다.
