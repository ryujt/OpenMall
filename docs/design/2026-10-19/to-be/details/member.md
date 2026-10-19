# member (모듈) — TO-BE 상세

> **대상**: member 모듈 전체 — 로그인·세션·운영자 계정(`C-02`), 소셜 로그인(`C-03`), 본인인증 가입·비밀번호 재설정·탈퇴(`C-04`), 회원 개인정보 파기의 member 몫(`C-20`) · **기준**: DATE 2026-10-19·커밋 `6ace327`(코드가 없는 신규 설계 — 문서 기준점일 뿐이다)
> **근거 색인**: [`../../_evidence-brief.md`](../../_evidence-brief.md) · **상위**: [`../system-design-to-be.md`](../system-design-to-be.md)
> **표기**: 신규 설계라 모든 계약·클래스·테이블·설정이 제안이다 — `(제안)` 표시는 생략한다. 외부 업체(카카오·네이버·본인인증 업체)의 동작은 「가정」, 확인하지 못한 것은 「미확인」, 바꿀 여지가 큰 정책 수치는 「잠정」으로 적는다. 그림 근거 열은 `R`·`C`·`D` ID다. 클래스 이름은 상위 §9.5의 잠정 스택(Java 21 + Spring Boot 3)을 전제로 지었다

## 1. 책임 / 비책임

- **책임**: 회원·운영자 계정을 갖고, 「이 요청을 보낸 사람이 누구인가」에 답한다. 구체적으로 — 아이디·비밀번호 확인과 5회 실패 30분 잠금(`R-03`), 서버 세션의 발급·확인·연장·폐기(`D-05`), 카카오·네이버 로그인의 `state`(쿠키·저장값·쿼리 대조)·PKCE·코드 교환·기존/신규 분기와 소셜 가입 티켓(`R-04`·`C-03`), 휴대폰 본인인증 결과의 서버 조회와 CI 중복 차단(`R-05`), 약관 동의 이력(코드·버전·시각, 마케팅 수신 선택), 본인인증 비밀번호 재설정(`R-06`), 탈퇴 — 진행 중 주문 확인·로그인 차단·연락처 파기·소셜 연결 해제(`R-26`), 회원 표의 보존 기한 파기(`C-20`), 탈퇴 회원 ID 목록 제공(`listWithdrawnSince` — 다른 모듈의 정리는 mall-api 탈퇴 정리 작업이 잇는다), 요청 주체의 표시 이름(`displayName`).
- **비책임**: 인증 미들웨어·CSRF 토큰·`/api/admin/*` 권한 판정(mall-api — member는 `authenticate`로 주체만 돌려준다), 로그인 뒤 복귀 주소와 장바구니 병합 호출(storefront-web·cart), 진행 중 주문의 정의(order `hasActiveOrders`), 비회원 주문의 주문자 정보(order), 알림 발송(member는 알림을 적재하지 않는다 — 가입 환영·비밀번호 변경 알림 없음), 운영자 경로별 역할 매핑(mall-api), 탈퇴 회원의 장바구니·찜 삭제(cart `purgeMembers`)와 리뷰 작성자 익명화(review `anonymizeAuthors`) — mall-api 탈퇴 정리 작업이 `listWithdrawnSince`의 결과를 두 계약에 넘긴다, 회원 쿠폰 정리(promotion 보존 파기).
- **아무도 하지 않는 것**: 탈퇴 즉시 다른 모듈에 알리는 통지(정리는 다음 날 탈퇴 정리 작업 — §8), IP 단위의 로그인 시도 제한(계정 잠금만 있다), 운영자 2단계 인증, 회원정보(이메일·휴대폰) 수정, 마케팅 수신 동의의 철회 화면과 2년 주기 재확인 통지, 이미 로그인한 회원에게 소셜 계정을 더 연결하는 기능, 운영자 계정 관리 화면(첫 계정은 마이그레이션 시드로 넣는다).

## 2. 공개 계약

**결론**: 공개 계약은 17개다 — HTTP 라우트 14개(고객 11·운영자 3)와 서비스 메서드 3개(`authenticate`·`listWithdrawnSince`·`purgeExpired`). 서비스는 공개 인터페이스 `MemberApi`로 내놓고, `purgeExpired`는 공용 `RetentionTask`의 구현이다. 선언 위치는 모듈의 공개 패키지(`member.api`)이고, 나머지 클래스·표는 모듈 안에 감춘다(`D-01`). 오류 본문은 mall-api의 `{code, message, details}` 형식이다.

| 메서드·경로 | 입력 | 출력 | 오류 | 구현 |
|---|---|---|---|---|
| `POST /api/auth/login` | `{loginId, password, keepSignedIn}` | 200 `{memberId, displayName}` + `Set-Cookie: SID`(httpOnly·Secure·SameSite=Lax·Path=/, `keepSignedIn`이면 Max-Age 14일) | 401 `INVALID_CREDENTIALS`(아이디 없음·비밀번호 틀림·탈퇴 — 구분하지 않는다), 423 `LOCKED {until}`, 422 `VALIDATION_FAILED` | `AuthRoutes.login` → `LoginService.login` — `C-02` |
| `POST /api/auth/logout` | 쿠키 `SID` | 204 + `SID` 지움 | 없음(세션이 없어도 204) | `AuthRoutes.logout` → `SessionService.revoke` — `C-02` |
| `GET /api/oauth/{provider}/authorize` | path `provider` = `kakao`·`naver` | 302 IdP 동의 주소(`state`·PKCE `code_challenge`(S256) 포함) + `Set-Cookie: OAUTH_STATE=<state>`(httpOnly·Secure·SameSite=Lax·Path=/api/oauth·Max-Age 300) | 404 모르는 `provider` | `OAuthRoutes.authorize` → `SocialLoginService.startAuthorize` — `C-03` |
| `GET /api/oauth/{provider}/callback` | query `code`·`state` 또는 `error`, 쿠키 `OAUTH_STATE` | 기존 회원: 302 `/login/return` + `Set-Cookie: SID`. 신규: 302 `/signup/social`(쿼리 없음) + `Set-Cookie: SIGNUP_TICKET=<티켓>`(httpOnly·Secure·SameSite=Lax·Path=/api/signup·Max-Age 600). 모든 응답에서 `OAUTH_STATE`를 지운다 | 302 `/login?error=social`(쿠키·저장값·쿼리 `state` 불일치, 만료·재사용, 코드 교환 실패), 302 `/login?error=social_cancelled`(`error=access_denied` — 동의 취소) | `OAuthRoutes.callback` → `SocialLoginService.handleCallback` — `C-03` |
| `POST /api/signup/social` | 쿠키 `SIGNUP_TICKET`, `{termsAgreements[{code, version, agreed}], phone?}` | 201 `{memberId}` + `Set-Cookie: SID` + `SIGNUP_TICKET` 지움 | 410 `TICKET_EXPIRED`(쿠키 없음·만료·사용됨), 409 `SOCIAL_ALREADY_LINKED`, 422 `TERMS_REQUIRED`·`VALIDATION_FAILED` | `SignupRoutes.signupSocial` → `SignupService.signupSocial` — `C-03` |
| `POST /api/members/check-duplicate` | `{identityToken}`(본인인증 업체 거래 ID) | 200 `{status:'NEW', verificationId}` 또는 `{status:'EXISTING', maskedLoginId, socialProviders[]}` | 422 `VERIFICATION_FAILED`(업체 결과 실패·만료·재사용), 422 `UNDER_14`, 502 `IDV_UNAVAILABLE`(업체 조회 타임아웃·5xx) | `SignupRoutes.checkDuplicate` → `VerificationService.verifyForSignup` — `C-04` |
| `POST /api/signup` | `{verificationId, loginId, password, email, termsAgreements[]}` | 201 `{memberId}` + `Set-Cookie: SID` | 409 `LOGIN_ID_TAKEN`·`CI_TAKEN`, 410 `VERIFICATION_EXPIRED`(30분 경과·사용됨), 422 `TERMS_REQUIRED`·`PASSWORD_RULE`·`LOGIN_ID_RULE`·`VALIDATION_FAILED` | `SignupRoutes.signup` → `SignupService.signup` — `C-04` |
| `POST /api/password/reset` | `{identityToken, newPassword}` | 204 — 그 회원의 세션 전부 폐기, 잠금 해제 | 404 `MEMBER_NOT_FOUND`, 422 `VERIFICATION_FAILED`(업체 결과 실패·만료·재사용, 인증 시각 10분 초과 — 만료도 이 코드다. 화면은 본인인증부터 다시 시킨다)·`PASSWORD_RULE`, 502 `IDV_UNAVAILABLE` | `PasswordRoutes.reset` → `PasswordResetService.reset` — `C-04` |
| `GET /api/members/me` | 회원 세션 | 200 `{memberId, displayName, joinType:'PASSWORD'·'KAKAO'·'NAVER', maskedLoginId?}` | 401(미로그인 — 인증 미들웨어) | `MemberRoutes.getMe` → `MemberStore.getSummary` — `C-02` |
| `PUT /api/members/me/password` | 회원 세션, `{currentPassword, newPassword}` | 204 + 새 `SID` — 현재 세션을 새 ID로 바꾸고 다른 세션은 폐기 | 401 `INVALID_CREDENTIALS`, 409 `NO_PASSWORD`(소셜 전용 회원), 422 `PASSWORD_RULE` | `MemberRoutes.changePassword` → `PasswordResetService.change` — `C-04`·`R-06` |
| `DELETE /api/members/me` | 회원 세션, `{password?}` — 비밀번호 회원은 `password` 필수, 소셜 전용 회원은 보내지 않는다 | 204 + `SID` 지움 | 401 `INVALID_CREDENTIALS`(비밀번호 회원의 `password`가 없거나 틀림), 403 `REAUTH_REQUIRED`(소셜 전용 회원의 로그인이 10분보다 오래됨 — 화면이 소셜 로그인을 다시 시킨다), 409 `ACTIVE_ORDERS` | `MemberRoutes.withdraw` → `WithdrawalService.withdraw` — `C-04`·`R-26` |
| `POST /api/admin/auth/login` | `{loginId, password}` | 200 `{adminId, name, role}` + `Set-Cookie: ASID`(httpOnly·Secure·SameSite=Strict·Path=/api/admin) | 401 `INVALID_CREDENTIALS`, 423 `LOCKED {until}` | `AdminAuthRoutes.login` → `AdminAuthService.login` — `C-02` |
| `POST /api/admin/auth/logout` | 쿠키 `ASID` | 204 + `ASID` 지움 | 없음 | `AdminAuthRoutes.logout` → `SessionService.revoke` — `C-02` |
| `GET /api/admin/auth/me` | 운영자 세션 | 200 `{adminId, name, role}` — admin-web 진입 가드 | 401 | `AdminAuthRoutes.me` → `AdminUserStore.getSummary` — `C-02` |
| 서비스 `authenticate(sessionId)` | 쿠키 원문 값(`SID` 또는 `ASID`) | `authenticated {principal: Principal{subjectType:'MEMBER'·'ADMIN', subjectId, displayName, role?}, refreshCookie}` 또는 `anonymous` — `Principal`은 mall-api 공용 타입(`GUEST`·`ANONYMOUS`는 mall-api가 만든다) | 예외 없음 — 모르는·만료된 ID는 `anonymous` | `MemberApi.authenticate` → `SessionService.authenticate` — `C-02`·`D-05` |
| 서비스 `listWithdrawnSince(since, page)` | 기준 시각, 쪽 번호(쪽당 500) | `{memberIds[], hasNext}` — 기준 시각 뒤에 탈퇴한 회원 | 없음 | `MemberApi.listWithdrawnSince` → `WithdrawalService.listSince` — mall-api 탈퇴 정리 작업이 하루 1회 부른다([mall-api 상세 `JF-3`](mall-api.md#jf-3-주기-작업--mallscheduler)) — `C-20`·`R-26` |
| 서비스 `purgeExpired(now)` | 시각 | `PurgeResult {task:'member', deleted}` — 표별 지운 행 수는 로그로 남긴다 | 없음(다음 실행에 이어서) | `RetentionService.purgeExpired`(`RetentionTask` 구현) — mall-api 보존 작업이 하루 1회 부른다 — `C-20` |

- **불변조건**: 같은 CI(해시)로 활성 회원은 하나다. 같은 `(provider, providerUserId)`로 연결은 하나다. 로그인 ID는 대소문자 무시 유일이다. 활성 세션의 주체는 언제나 `ACTIVE` 회원이나 활성 운영자다 — 탈퇴·비밀번호 재설정은 같은 트랜잭션에서 세션을 지운다.
- **로그인 ID 규칙(잠정)**: 영문 소문자로 시작하는 영문 소문자·숫자 4~20자. 소셜 전용 회원은 로그인 ID가 없다.
- **비밀번호 규칙(잠정)**: 영문 대·소문자·숫자·특수문자 중 2종 이상이면 10자 이상, 3종 이상이면 8자 이상, 최대 64자. 로그인 ID를 포함하거나 같은 문자를 4번 넘게 잇지 않는다(KISA 「암호이용 안내서」의 조합 기준을 따른 값 — 법정 의무 수치는 아니다).
- **계정 존재 노출**: 로그인은 아이디 없음과 비밀번호 틀림을 같은 401로 답하고, 아이디가 없을 때도 더미 해시로 검증해 응답 시간을 맞춘다. 반면 `check-duplicate`의 `EXISTING`과 비밀번호 재설정의 404는 숨기지 않는다 — 두 응답 모두 요청자가 방금 본인인증으로 증명한 **자기 명의**의 계정 유무라서, 남의 계정을 알아내는 통로가 되지 않는다. `maskedLoginId`는 앞 2자와 끝 1자만 보인다(`ab***z`).
- **표시 이름 `displayName`**: `authenticate`·`GET /api/members/me`가 주는 화면·리뷰용 이름이다. 비밀번호 회원은 마스킹한 로그인 ID — 앞 3자 + `****`(예 `minsu77` → `min****`), 소셜 전용 회원은 `카카오 회원`·`네이버 회원`, 운영자는 `admin_users.name`. 원문 로그인 ID는 내보내지 않는다. review가 이 값을 작성자 표시(`authorLabel`)로 저장한다.
- **부작용 완료 시점**: 세션 발급·폐기·회원 생성·탈퇴는 응답 전에 커밋된다. IdP 연결 끊기(탈퇴)만 커밋 뒤 최선 노력으로 부른다(§6).
- **호환성**: 첫 버전이라 알려진 소비자는 storefront-web·admin-web·mall-api 미들웨어뿐이다. `Principal`에 필드를 더하는 것은 호환, 빼는 것은 mall-api와 함께 바꾼다.

## 3. 내부 Job Flow — 드릴다운

**결론**: 모듈 전체를 조율하는 단일 객체는 없다. 진입점마다 유스케이스 서비스 하나(`LoginService`·`SocialLoginService`·`SignupService`·`VerificationService`·`PasswordResetService`·`WithdrawalService`·`AdminAuthService`)가 조율하고, 세션은 모두 `SessionService`가 발급·확인·폐기한다. 바깥으로 나가는 객체는 셋 — `SocialOAuthGateway`(카카오·네이버), `IdentityVerificationGateway`(본인인증 업체), `OrderApi`(order 모듈 공개 계약)다.

상위 §5의 노드가 아래 그림의 시작점이다. 입력·출력·실패 의미가 같다([상위 §5](../system-design-to-be.md#5-흐름--경계끼리-어떻게-소통하나)).

**드릴다운 지도**

| 상위 §5 노드 | L1 그림 | L2 이하 |
|---|---|---|
| `Member.auth`(§5.1 묶음 — 고객용 라우트 전부) | 묶음 안의 계약은 아래 여덟 행이다. §5.1의 나가는 화살표 셋은 `Member.auth --> SocialIdP.exchangeToken` = [`JF-2`](#jf-2-소셜-로그인-시작과-콜백--socialloginservice)의 `exchangeCode`, `Member.auth --> IdVerify.getResult` = [`JF-4`](#jf-4-본인인증-결과-조회와-중복-확인--verificationserviceverifyforsignup)·[`JF-6`](#jf-6-비밀번호-재설정--passwordresetservicereset)의 `getResult`, `Member.auth --> Order.claimSupport` = [`JF-8`](#jf-8-회원-탈퇴--withdrawalservicewithdraw)의 `hasActiveOrders`다 | — |
| `Member.login`(§5.3) | [`JF-1` 일반 로그인](#jf-1-일반-로그인--loginservicelogin) | 세션 발급은 [`JF-10`](#jf-10-세션-확인--sessionserviceauthenticate) 아래 불릿 |
| `Member.oauthAuthorize`·`Member.oauthCallback`(§5.3) | [`JF-2` 소셜 로그인 시작과 콜백](#jf-2-소셜-로그인-시작과-콜백--socialloginservice) | — |
| `Member.signupSocial`(§5.3) | [`JF-3` 소셜 가입](#jf-3-소셜-가입--signupservicesignupsocial) | — |
| `Member.checkDuplicate`(§5.4) | [`JF-4` 본인인증 결과 조회와 중복 확인](#jf-4-본인인증-결과-조회와-중복-확인--verificationserviceverifyforsignup) | — |
| `Member.signup`(§5.4) | [`JF-5` 본인인증 가입](#jf-5-본인인증-가입--signupservicesignup) | — |
| (그림 밖) 비밀번호 재설정(§5.4 표) | [`JF-6` 비밀번호 재설정](#jf-6-비밀번호-재설정--passwordresetservicereset) | 로그인 중 비밀번호 변경(`change`)은 `JF-6` 아래 불릿 |
| `Member.getMe`(§5.5·§5.14) — 로그아웃도 이 행 | [`JF-7` 내 정보와 로그아웃](#jf-7-내-정보와-로그아웃--memberroutesauthroutes) | — |
| `Member.auth`의 탈퇴(§5.1 `Member.auth --> Order.claimSupport` — 자기 시나리오 소절은 없다) | [`JF-8` 회원 탈퇴](#jf-8-회원-탈퇴--withdrawalservicewithdraw) | — |
| `Member.adminLogin`(§5.1·§5.15) | [`JF-9` 운영자 로그인](#jf-9-운영자-로그인--adminauthservicelogin) | — |
| `Member.cleanupSupport`(§5.1 묶음), `Member.listWithdrawnSince`·`Member.purgeExpired`(§5.17) = `MemberApi.listWithdrawnSince` → `WithdrawalService.listSince`, `RetentionService.purgeExpired` | 그림 없음 — 둘 다 표 하나의 단순 조회·삭제다(계약은 §2, 파기 대상은 [§4.4](#44-보존과-파기)). 호출자 쪽 흐름은 [mall-api 상세 `JF-3`](mall-api.md#jf-3-주기-작업--mallscheduler) | — |
| `Member.authenticate`(상위 §5.0 본문 — 그림에는 없다. mall-api 인증 미들웨어가 요청마다 부른다) | [`JF-10` 세션 확인](#jf-10-세션-확인--sessionserviceauthenticate) | — |

외부 객체 대응 — 상위 `SocialIdP.exchangeToken` = `SocialOAuthGateway.exchangeCode`(토큰 교환 + 프로필 조회 두 HTTP), `IdVerify.getResult` = `IdentityVerificationGateway.getResult`, `Order.claimSupport`의 `hasActiveOrders` = `OrderApi.hasActiveOrders`(같은 프로세스 안의 서비스 호출). 상위 `SocialIdP.authorize`·`IdVerify.verifyWindow`는 브라우저가 여는 창이라 이 경계 안에 대응 코드가 없다 — member는 동의 주소만 만든다(`JF-2`).

**표기** 노드는 제안 클래스·메서드다. `*Routes`는 HTTP 라우트 클래스, `*Service`는 유스케이스(트랜잭션 경계), `*Store`는 이 모듈 표 하나를 맡는 저장소, `*Gateway`·`OrderApi`는 바깥 경계 쪽 객체다. 렌더 확인 범위: 아래 열 그림 모두 SVG → PNG로 봤다. 열지 않은 것: `SessionService.issue`·`revoke`·`revokeAll`(단순 쓰기 — §4.2와 `JF-10` 불릿), `PasswordHasher`·`CredentialPolicy`·`TermsLedger.validate`(순수 판정), `RetentionService.purgeExpired`(표별 `DELETE … WHERE 기한 < now` — §4.4), `WithdrawalService.listSince`(`withdrawn_at > since` 쪽 조회).

### JF-1 일반 로그인 — LoginService.login

```jobflow
orchestrator: LoginService
Object: AuthRoutes, LoginService, MemberStore, PasswordHasher, SessionService

AuthRoutes.login --> LoginService.login
LoginService.login --> MemberStore.findByLoginId
MemberStore.findByLoginId.locked
MemberStore.findByLoginId.result --> PasswordHasher.verify
PasswordHasher.verify.mismatch --> MemberStore.recordFailure
PasswordHasher.verify.match --> MemberStore.clearFailures
PasswordHasher.verify.match --> SessionService.issue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `AuthRoutes.login` | `R-03`·`C-02` | 상위 `Member.login`. 형식 검사(빈 값·길이) 뒤 서비스를 부른다. 결과를 200·401·423으로 바꾼다 |
| `MemberStore.findByLoginId`·`.locked` | `R-03` | 로그인 ID(소문자화)로 `ACTIVE` 회원을 읽는다. `locked_until > now`면 `.locked` → 423 `LOCKED {until}` — 비밀번호를 검증하지 않는다. 탈퇴·없음은 `null`을 `.result`로 넘긴다 |
| `PasswordHasher.verify` | `R-03`·`C-02` | 저장 해시의 알고리즘 접두(`{argon2}`·`{bcrypt}`)로 검증한다. 회원이 `null`이면 더미 해시로 검증하고 `mismatch`를 낸다 — 응답 시간으로 아이디 유무가 새지 않게 한다. 비밀번호가 없는 소셜 전용 회원도 `mismatch`다 |
| `.mismatch` → `MemberStore.recordFailure` | `R-03` | 조건부 갱신 `failed_login_count = failed_login_count + 1`. 5가 되면 같은 문장에서 `locked_until = now + 30분`, 그 요청은 423, 1~4회째는 401. 회원이 `null`이면 부르지 않는다 |
| `.match` → `MemberStore.clearFailures` | `R-03` | 실패 횟수 0·`locked_until` 지움. 저장 해시가 현재 설정보다 약하면 같은 갱신에서 새 해시로 바꾼다(재해시) |
| `.match` → `SessionService.issue` | `D-05`·`C-02` | 새 무작위 ID로 세션 행을 만든다. 요청에 이전 `SID`가 있으면 그 행을 지운다 — 세션 고정 방지(§4.2) |

- **트리거** 「로그인」(N2 `(/login)`). **완료 사실** 세션 행 1개 + `SID` 쿠키. 실패 횟수는 성공이나 잠금 만료 뒤 첫 시도에서 0부터 다시 센다.
- **실패 분기** 401·423 모두 `LoginForm`에 머문다. `.locked`는 응답으로 끝나는 단독 줄이다.
- `PasswordHasher.verify.match`에서 나가는 화살표 둘은 같은 성공 경로의 두 단계다(실패 횟수 정리 → 세션 발급). 두 단계는 한 트랜잭션이다.
- 동시에 같은 계정으로 틀린 비밀번호가 여럿 오면 `recordFailure`의 조건부 증가가 하나씩 센다 — 5회째를 넘긴 요청도 모두 423이다.

### JF-2 소셜 로그인 시작과 콜백 — SocialLoginService

`scope:`가 아닌 `orchestrator:`다 — 두 진입(`startAuthorize`·`handleCallback`)을 같은 서비스가 조율한다. 두 요청은 브라우저가 IdP 동의 화면을 거쳐 차례로 보낸다(상위 §5.3).

```jobflow
orchestrator: SocialLoginService
Object: OAuthRoutes, SocialLoginService, AuthTicketStore, SocialOAuthGateway, SocialAccountStore, SessionService

OAuthRoutes.authorize --> SocialLoginService.startAuthorize
SocialLoginService.startAuthorize --> AuthTicketStore.issueState
SocialLoginService.startAuthorize --> SocialOAuthGateway.authorizeUrl
OAuthRoutes.callback --> SocialLoginService.handleCallback
SocialLoginService.handleCallback --> AuthTicketStore.consumeState
AuthTicketStore.consumeState.invalid
SocialLoginService.handleCallback --> SocialOAuthGateway.exchangeCode
SocialOAuthGateway.exchangeCode.failed
SocialLoginService.handleCallback --> SocialAccountStore.findMember
SocialAccountStore.findMember.linked --> SessionService.issue
SocialAccountStore.findMember.notLinked --> AuthTicketStore.issueSignupTicket
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `OAuthRoutes.authorize` → `startAuthorize` | `C-03`·`R-04` | 상위 `Member.oauthAuthorize`. 302 동의 주소 + `OAUTH_STATE` 쿠키(httpOnly, 5분, `Path=/api/oauth`)로 끝난다 |
| `AuthTicketStore.issueState` | `C-03`·`R-04` | 32바이트 무작위 `state`와 PKCE `code_verifier`(43~128자 무작위). `state`는 해시만, `code_verifier`는 암호화해 `auth_tickets`(`OAUTH_STATE`, 5분)에 적는다. 같은 `state`를 응답 쿠키 `OAUTH_STATE`에도 담는다 |
| `SocialOAuthGateway.authorizeUrl` | `C-03` | provider별 동의 주소 조립(클라이언트 ID·복귀 주소 `/api/oauth/{provider}/callback`·`state`·`code_challenge = BASE64URL(SHA-256(code_verifier))`·`code_challenge_method=S256`). HTTP 호출 없음. PKCE를 받지 않는 IdP면 생략한다(가정 — §8) |
| `OAuthRoutes.callback` → `handleCallback` | `C-03`·`R-04` | 상위 `Member.oauthCallback`. 쿼리 `state`와 쿠키 `OAUTH_STATE`를 함께 넘기고, 응답마다 `OAUTH_STATE`를 지운다. query에 `error`가 있으면(동의 취소) `state`만 소비하고 302 `/login?error=social_cancelled` |
| `AuthTicketStore.consumeState`·`.invalid` | `R-04` | 셋을 대조한다 — ① 쿠키 값 = 쿼리 `state`(상수 시간 비교, 쿠키가 없으면 실패) ② 조건부 갱신 `used_at = now WHERE token_hash = ? AND kind = 'OAUTH_STATE' AND used_at IS NULL AND expires_at > now`가 1행. 하나라도 어기면 `.invalid`(쿠키 없음·불일치·없음·만료·재사용) → 302 `/login?error=social` — IdP를 부르지 않는다. 통과하면 저장한 `code_verifier`를 돌려준다 |
| `SocialOAuthGateway.exchangeCode`·`.failed` | `C-03`, 외부 계약은 가정 | 상위 `SocialIdP.exchangeToken`. 코드 + `code_verifier` → 액세스 토큰 → 프로필(`providerUserId`·이메일·닉네임). 두 호출 합 5초, 재시도 없음. 타임아웃·4xx·5xx는 `.failed` → 302 `/login?error=social`. 토큰은 저장하지 않는다(프로필만 쓰고 버린다) |
| `SocialAccountStore.findMember`·`.linked` → `SessionService.issue` | `R-04`·`D-05` | `(provider, providerUserId)`로 `ACTIVE` 회원을 찾는다. 있으면 세션 발급 + 302 `/login/return`. 비밀번호 잠금은 소셜 로그인을 막지 않는다(잠금은 비밀번호 추측을 막는 장치다) |
| `.notLinked` → `AuthTicketStore.issueSignupTicket` | `C-03`·`R-04` | 가입 티켓(`SIGNUP_TICKET`, 10분) — 32바이트 무작위 값의 해시를 적고, 내용은 provider·`providerUserId`·이메일·닉네임(암호화). 티켓 원문은 URL이 아니라 httpOnly 쿠키 `SIGNUP_TICKET`(`Path=/api/signup`, Max-Age 600)로 주고 302 `/signup/social`(쿼리 없음) — 주소창·방문 기록·`Referer`에 티켓이 남지 않는다 |

- **트리거** 소셜 로그인 버튼 → 동의 → 브라우저의 콜백 주소 이동(N2). **완료 사실** 기존 회원: 세션. 신규: 가입 티켓.
- **이메일이 같은 기존 회원과 자동 연결하지 않는다**: IdP가 준 이메일이 기존 회원 이메일과 같아도 연결하지 않고 신규 가입으로 보낸다. 이메일 확인 여부가 IdP마다 다르고(가정), 자동 연결은 남의 이메일로 IdP 계정을 만든 사람이 기존 계정을 차지하는 통로가 되기 때문이다. 그래서 이메일은 유일하지 않다(§4).
- `state`는 일회성이다 — 같은 콜백 주소를 다시 열면(뒤로 가기·새로 고침) `.invalid`다. 화면은 로그인 화면에서 다시 시작한다.
- **쿠키 대조와 PKCE를 함께 쓰는 이유**(`R-04`): 저장값 대조만으로는 공격자가 자기 브라우저에서 받은 `state`·`code`로 만든 콜백 주소를 피해자에게 열게 하는 로그인 위조를 막지 못한다 — 피해자 브라우저에는 그 `state`의 쿠키가 없어 ①에서 끊긴다. PKCE는 콜백 주소의 `code`가 새도 `code_verifier` 없이는 토큰으로 바꾸지 못하게 한다.
- `.invalid`·`.failed`는 302 응답으로 끝나는 단독 줄이다. `consumeState`가 IdP 호출보다 먼저라서, 위조 콜백은 IdP 코드 교환까지 가지 않는다.
- 상위 §5.3 `Member.oauthCallback --> SocialIdP.exchangeToken`이 이 그림의 `exchangeCode`다.

### JF-3 소셜 가입 — SignupService.signupSocial

```jobflow
orchestrator: SignupService
Object: SignupRoutes, SignupService, AuthTicketStore, MemberStore, SocialAccountStore, TermsLedger, SessionService

SignupRoutes.signupSocial --> SignupService.signupSocial
SignupService.signupSocial --> TermsLedger.validate
TermsLedger.validate.missingRequired
SignupService.signupSocial --> AuthTicketStore.consumeSignupTicket
AuthTicketStore.consumeSignupTicket.expired
SignupService.signupSocial --> MemberStore.create
SignupService.signupSocial --> SocialAccountStore.link
SocialAccountStore.link.duplicate
SignupService.signupSocial --> TermsLedger.record
SignupService.signupSocial --> SessionService.issue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SignupRoutes.signupSocial` | `C-03` | 상위 `Member.signupSocial`. 티켓은 본문이 아니라 쿠키 `SIGNUP_TICKET`에서 읽는다(쿠키가 없으면 410 `TICKET_EXPIRED`). 성공 응답에서 그 쿠키를 지운다 |
| `TermsLedger.validate`·`.missingRequired` | `R-05`·`R-25` | 필수 약관(`SERVICE`·`PRIVACY_COLLECT`·`AGE_14`)의 **현재 버전**에 모두 동의했는지 본다. 빠지면 422 `TERMS_REQUIRED` — 티켓을 소비하지 않는다. 소셜 가입은 생년월일이 없어 만 14세 이상을 `AGE_14` 자기 확인 약관으로 받는다 |
| `AuthTicketStore.consumeSignupTicket`·`.expired` | `C-03` | 쿠키 값의 해시로 `JF-2`의 `consumeState` ②와 같은 조건부 소비(`kind = 'SIGNUP_TICKET'`). 0행이면 410 `TICKET_EXPIRED` |
| `MemberStore.create` | `C-03` | `join_type` = provider, 로그인 ID·비밀번호·CI 없음. 이메일·닉네임은 티켓 값, 휴대폰은 입력값(본인인증 안 됨 — 형식 검사만) |
| `SocialAccountStore.link`·`.duplicate` | `R-04` | `(provider, providerUserId)` 유일 제약 위반이면 `.duplicate` → 409 `SOCIAL_ALREADY_LINKED`, 트랜잭션 롤백(회원 행·티켓 소비도 되돌아간다) |
| `TermsLedger.record` | `R-05`·`R-25` | 받은 약관마다 `(code, version, agreed, agreed_at)` 한 행 — 선택 약관(`MARKETING_SMS`·`MARKETING_EMAIL`)은 거절도 행으로 남긴다 |
| `SessionService.issue` | `D-05` | 201과 함께 `SID`. 그 뒤 복귀·장바구니 병합은 화면이 한다(상위 §5.3 `restoreReturnUrl`) |

- **완료 사실** 회원 1명 + 소셜 연결 1행 + 약관 동의 행 + 세션 — `consumeSignupTicket`부터 `issue`까지 한 트랜잭션이다.
- **두 번째 가입이 생기지 않는 이유**(`R-04`): 같은 티켓 쿠키로 두 탭에서 보내면 조건부 소비가 하나만 통과시킨다. 티켓이 둘이어도(콜백을 두 번 거침) `social_accounts` 유일 제약이 두 번째를 409로 돌린다.
- 소셜 가입은 본인인증을 하지 않아 CI가 없다 — 같은 사람이 본인인증 가입으로 두 번째 계정을 만들 수 있다(상위 §9.5, §8).
- `TermsLedger`를 저장소들 오른쪽에 둔 것은 배치 때문이다 — 왼쪽에 두면 `record` 칸이 `create`보다 위 행에 끼어들어 시간 순서가 뒤집혀 보였다(`job-flow-diagram-guide.md` 「렌더러 배치 특성」). `JF-5`도 같다.

### JF-4 본인인증 결과 조회와 중복 확인 — VerificationService.verifyForSignup

```jobflow
orchestrator: VerificationService
Object: SignupRoutes, VerificationService, IdentityVerificationGateway, VerificationStore, MemberStore

SignupRoutes.checkDuplicate --> VerificationService.verifyForSignup
VerificationService.verifyForSignup --> IdentityVerificationGateway.getResult
IdentityVerificationGateway.getResult.failed
VerificationService.verifyForSignup --> VerificationStore.save
VerificationStore.save.replayed
VerificationService.verifyForSignup --> MemberStore.findByCi
MemberStore.findByCi.existing
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SignupRoutes.checkDuplicate` | `R-05`·`C-04` | 상위 `Member.checkDuplicate` |
| `IdentityVerificationGateway.getResult`·`.failed` | `C-04`, 외부 계약은 가정 | 상위 `IdVerify.getResult`. 업체 거래 ID로 서버 대 서버 조회(5초, 재시도 없음) → 이름·생년월일·휴대폰·CI·인증 시각. 업체가 실패·만료라고 답하면 `.failed` → 422 `VERIFICATION_FAILED`, 타임아웃·5xx는 502 `IDV_UNAVAILABLE`. 인증 시각이 10분보다 오래됐으면 실패로 본다(잠정). 만 14세 미만이면 저장하지 않고 422 `UNDER_14` |
| `VerificationStore.save`·`.replayed` | `C-04`·`R-05` | `identity_verifications`에 `purpose='SIGNUP'`, `ci_hash`(HMAC), 이름·휴대폰(암호화), 생년월일, `expires_at = now + 30분`. 업체 거래 ID 유일 제약 위반이면 `.replayed` → 422 `VERIFICATION_FAILED` — 같은 인증 결과를 두 번 쓰지 못한다 |
| `MemberStore.findByCi`·`.existing` | `R-05` | `ci_hash`로 `ACTIVE` 회원을 찾는다. 있으면 `.existing` → 200 `EXISTING {maskedLoginId, socialProviders[]}`(그 행의 `verificationId`는 돌려주지 않고 30분 뒤 버린다). 없으면 200 `NEW {verificationId}` |

- **완료 사실** 본인인증 결과 1행(30분). 브라우저가 가진 것은 업체 거래 ID와 `verificationId`뿐이다 — CI·이름은 서버가 업체에 물어 얻고, 브라우저에 돌려주지 않는다(상위 §5.4 「브라우저가 CI를 위조할 수 없게」).
- `.failed`·`.replayed`·`.existing`은 응답으로 끝나는 단독 줄이다. `.existing`의 화면 이동은 `ExistingAccountNotice`(N3)다.
- `EXISTING`은 자기 명의 계정의 존재를 알리는 것이라 계정 존재 노출 문제가 아니다(§2 불릿).

### JF-5 본인인증 가입 — SignupService.signup

```jobflow
orchestrator: SignupService
Object: SignupRoutes, SignupService, CredentialPolicy, PasswordHasher, VerificationStore, MemberStore, TermsLedger, SessionService

SignupRoutes.signup --> SignupService.signup
SignupService.signup --> CredentialPolicy.validate
CredentialPolicy.validate.invalid
SignupService.signup --> TermsLedger.validate
TermsLedger.validate.missingRequired
SignupService.signup --> PasswordHasher.hash
SignupService.signup --> VerificationStore.consume
VerificationStore.consume.expired
SignupService.signup --> MemberStore.create
MemberStore.create.duplicate
SignupService.signup --> TermsLedger.record
SignupService.signup --> SessionService.issue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SignupRoutes.signup` | `R-05`·`C-04` | 상위 `Member.signup` |
| `CredentialPolicy.validate`·`.invalid` | `C-04` | 로그인 ID·비밀번호 규칙(§2). 422 `LOGIN_ID_RULE`·`PASSWORD_RULE` |
| `TermsLedger.validate`·`.missingRequired` | `R-05` | `JF-3`과 같다. 본인인증 가입은 생년월일로 만 14세를 이미 확인했으므로 `AGE_14`를 따로 받지 않는다 |
| `PasswordHasher.hash` | `C-02` | argon2id(잠정 — §4.3). 해시는 느리므로(수십~수백 ms, 미측정) 트랜잭션을 열기 전에 계산한다 |
| `VerificationStore.consume`·`.expired` | `R-05`·`C-04` | 조건부 갱신 `used_at = now WHERE id = ? AND purpose = 'SIGNUP' AND used_at IS NULL AND expires_at > now`. 0행이면 410 `VERIFICATION_EXPIRED`. 소비한 행의 이름·휴대폰·생년월일·`ci_hash`를 회원 행으로 옮긴다 |
| `MemberStore.create`·`.duplicate` | `R-05` | 로그인 ID 유일·`ci_hash` 유일 제약. 위반이면 409 `LOGIN_ID_TAKEN`·`CI_TAKEN`, 롤백(본인인증 소비도 되돌아가 다른 아이디로 다시 시도할 수 있다) |
| `TermsLedger.record` | `R-05`·`R-25` | `JF-3`과 같다 |
| `SessionService.issue` | `D-05` | 가입 직후 자동 로그인 — 201과 함께 `SID`. `SignupComplete`의 「쇼핑 시작」(N3)이 로그인 상태로 간다 |

- **완료 사실** 회원 1명(CI 유일) + 약관 동의 행 + 세션 — `consume`부터 `issue`까지 한 트랜잭션이다.
- **`CI_TAKEN`**: `check-duplicate`와 `signup` 사이에 같은 사람이 다른 탭에서 가입을 끝낸 경우다. 검사 시점이 아니라 `members.ci_hash` 유일 제약이 막는다(상위 §5.4 실패 분기).
- 이메일은 형식만 본다(유일하지 않음 — `JF-2` 불릿). 검증 메일은 보내지 않는다(member는 알림을 적재하지 않는다).

### JF-6 비밀번호 재설정 — PasswordResetService.reset

```jobflow
orchestrator: PasswordResetService
Object: PasswordRoutes, PasswordResetService, CredentialPolicy, IdentityVerificationGateway, VerificationStore, MemberStore, PasswordHasher, SessionService

PasswordRoutes.reset --> PasswordResetService.reset
PasswordResetService.reset --> CredentialPolicy.validate
CredentialPolicy.validate.invalid
PasswordResetService.reset --> IdentityVerificationGateway.getResult
IdentityVerificationGateway.getResult.failed
PasswordResetService.reset --> VerificationStore.saveUsed
VerificationStore.saveUsed.replayed
PasswordResetService.reset --> MemberStore.findByCi
MemberStore.findByCi.notFound
MemberStore.findByCi.found --> PasswordHasher.hash
PasswordHasher.hash.result --> MemberStore.updatePassword
MemberStore.updatePassword.result --> SessionService.revokeAll
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `PasswordRoutes.reset` | `R-06`·`C-04` | 상위 §5.4 표의 「(그림 밖) 비밀번호 재설정」 — `POST /api/password/reset` |
| `CredentialPolicy.validate`·`.invalid` | `C-04` | 새 비밀번호 규칙 중 회원과 무관한 부분. 로그인 ID 포함 검사는 회원을 찾은 뒤 `updatePassword` 직전에 한다 |
| `IdentityVerificationGateway.getResult`·`.failed` | `R-06`, 외부 계약은 가정 | `JF-4`와 같은 조회. 422·502도 같다 |
| `VerificationStore.saveUsed`·`.replayed` | `R-06` | `purpose='PASSWORD_RESET'`, `used_at = now`로 바로 소비한 행을 적는다. 업체 거래 ID 유일 제약이 재사용을 막는다 |
| `MemberStore.findByCi`·`.notFound`·`.found` | `R-06` | `ci_hash`로 `ACTIVE` 회원. 없으면 404 `MEMBER_NOT_FOUND`(자기 명의 계정 유무 — §2 불릿). 소셜 전용 회원은 CI가 없어 여기서 찾히지 않는다 |
| `.found` → `PasswordHasher.hash` → `MemberStore.updatePassword` | `R-06` | 새 해시 저장, `password_changed_at = now`, 실패 횟수·잠금 해제 |
| `.result` → `SessionService.revokeAll` | `R-06`·`D-05` | 그 회원의 세션 행을 모두 지운다 — `updatePassword`와 한 트랜잭션. 커밋 뒤 첫 요청부터 다른 기기는 `anonymous`다 |

- **완료 사실** 비밀번호 교체 + 잠금 해제 + 세션 전부 폐기 → 204. 재설정은 로그인을 시켜 주지 않는다 — 화면은 `LoginForm`으로 간다.
- **로그인 중 비밀번호 변경**(`PUT /api/members/me/password` → `PasswordResetService.change`): 본인인증 대신 현재 비밀번호를 `PasswordHasher.verify`로 확인하고(틀리면 401 — 실패 횟수에 넣지 않는다), `updatePassword` 뒤 `SessionService.revokeAll`과 `issue`를 같은 트랜잭션에서 불러 **현재 기기만 새 ID로** 남긴다. 그림은 위와 같은 모양이라 따로 그리지 않았다.
- `.invalid`·`.failed`·`.replayed`·`.notFound`는 응답으로 끝나는 단독 줄이다.

### JF-7 내 정보와 로그아웃 — MemberRoutes·AuthRoutes

`scope:`다 — 두 라우트는 서로 모르는 진입점이고 조율자가 없다.

```jobflow
scope: member 본인 확인과 로그아웃 라우트
Object: MemberRoutes, AuthRoutes, MemberStore, SessionService

MemberRoutes.getMe --> MemberStore.getSummary
AuthRoutes.logout --> SessionService.revoke
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `MemberRoutes.getMe` → `MemberStore.getSummary` | `R-03`·`R-17` | 상위 `Member.getMe`(§5.5 `check_auth`, §5.14 N8 진입 가드). 인증 미들웨어가 이미 `Principal`을 붙였으므로 회원 ID로 요약만 읽는다. 미로그인 401은 미들웨어가 낸다 — 이 라우트까지 오지 않는다 |
| `AuthRoutes.logout` → `SessionService.revoke` | `R-03`·`D-05` | 쿠키의 세션 행을 지우고 `SID`를 지운다. 행이 없어도 204 — 두 번 눌러도 같다 |

- 상위 `Member.getMe.unauthorized`는 이 경계의 코드가 아니라 mall-api 미들웨어의 401이다. 미들웨어가 쓰는 판정이 `JF-10`의 `anonymous`다.
- 로그아웃은 그 기기 하나만 끝낸다. 「모든 기기에서 로그아웃」은 비밀번호 변경·재설정이 대신한다.

### JF-8 회원 탈퇴 — WithdrawalService.withdraw

```jobflow
orchestrator: WithdrawalService
Object: MemberRoutes, WithdrawalService, ReauthPolicy, OrderApi, MemberStore, SessionService, SocialAccountStore, SocialOAuthGateway

MemberRoutes.withdraw --> WithdrawalService.withdraw
WithdrawalService.withdraw --> ReauthPolicy.check
ReauthPolicy.check.failed
WithdrawalService.withdraw --> OrderApi.hasActiveOrders
OrderApi.hasActiveOrders.true
WithdrawalService.withdraw --> MemberStore.anonymize
WithdrawalService.withdraw --> SessionService.revokeAll
WithdrawalService.withdraw --> SocialAccountStore.unlinkAll
SocialAccountStore.unlinkAll.result --> SocialOAuthGateway.unlink
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `MemberRoutes.withdraw` | `R-26`·`C-04` | `DELETE /api/members/me`. 상위 §5.1의 `Member.auth` 묶음에 든다 |
| `ReauthPolicy.check`·`.failed` | `R-26` | 비밀번호 회원은 본문 `password`를 검증(없거나 틀리면 401 `INVALID_CREDENTIALS`, 실패 횟수에 넣지 않는다). 소셜 전용 회원은 세션 발급이 10분 안이어야 한다(아니면 403 `REAUTH_REQUIRED` — 화면이 소셜 로그인을 다시 시킨다) |
| `OrderApi.hasActiveOrders`·`.true` | `R-26`·`D-02` | 상위 `Member.auth --> Order.claimSupport`. order의 `hasActiveOrders(memberId)` → 출고 전 주문이나 처리 중 클레임이 있으면 `true` → 409 `ACTIVE_ORDERS`. 판정 규칙은 order 소유다([order 상세 §2](order.md#2-공개-계약)) |
| `MemberStore.anonymize` | `R-26`·`C-20` | 회원 행을 `WITHDRAWN`으로 바꾸고 로그인 ID·비밀번호 해시·이름·휴대폰·이메일·생년월일·`ci_hash`를 즉시 지운다(NULL). 회원 ID와 `withdrawn_at`만 남는다 — 주문·클레임이 참조하는 키라서다 |
| `SessionService.revokeAll` | `D-05`·`R-26` | 그 회원의 세션 전부 삭제 — 로그인 불가는 `anonymize`(로그인 ID 없음)와 이 삭제로 보장된다 |
| `SocialAccountStore.unlinkAll` | `R-26` | 소셜 연결 행 삭제. 지운 연결 목록을 돌려준다 |
| `.result` → `SocialOAuthGateway.unlink` | `R-26`, 외부 계약은 가정 | 커밋 **뒤** provider별 연결 끊기 API(카카오 unlink·네이버 토큰 삭제형, 가정)를 연결마다 한 번, 5초, 최선 노력. 실패는 경고 로그만 — 탈퇴는 이미 끝났다. 로컬 연결을 지웠으므로 같은 소셜 계정이 다시 오면 신규 가입이 된다 |

- **완료 사실** `anonymize`·`revokeAll`·`unlinkAll`이 한 트랜잭션 → 204 + `SID` 지움. 약관 동의 이력은 탈퇴 후 3년 보관한 뒤 파기한다(잠정 — 상위 §6.2).
- **줄 순서와 실제 순서**: `unlink`는 그림에서 `unlinkAll` 바로 아래지만 실제로는 트랜잭션 커밋 뒤다. `hasActiveOrders` 확인과 탈퇴 커밋 사이에 같은 회원의 새 주문이 들어오는 경합은 막지 않는다(§8).
- `.failed`·`.true`는 응답으로 끝나는 단독 줄이다.
- 다른 모듈의 회원 데이터(장바구니·찜·회원 쿠폰·리뷰 작성자 표시)는 이 그림이 건드리지 않는다. 장바구니·찜과 리뷰 작성자 표시는 다음 날 mall-api 탈퇴 정리 작업이 `listWithdrawnSince`(이 모듈의 공개 계약 — `withdrawn_at`으로 고른다)의 결과를 `CartApi.purgeMembers`·`ReviewApi.anonymizeAuthors`에 넘겨 정리하고, 회원 쿠폰은 promotion 보존 파기가 지운다(§8).

### JF-9 운영자 로그인 — AdminAuthService.login

```jobflow
orchestrator: AdminAuthService
Object: AdminAuthRoutes, AdminAuthService, AdminUserStore, PasswordHasher, SessionService

AdminAuthRoutes.login --> AdminAuthService.login
AdminAuthService.login --> AdminUserStore.findByLoginId
AdminUserStore.findByLoginId.locked
AdminUserStore.findByLoginId.result --> PasswordHasher.verify
PasswordHasher.verify.mismatch --> AdminUserStore.recordFailure
PasswordHasher.verify.match --> AdminUserStore.clearFailures
PasswordHasher.verify.match --> SessionService.issue
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `AdminAuthRoutes.login` | `R-21`·`C-02` | 상위 `Member.adminLogin`(§5.1·§5.15) — `POST /api/admin/auth/login` |
| `AdminUserStore.findByLoginId`·`.locked` | `R-21` | `admin_users`의 활성 계정. 잠금 규칙은 회원과 같다(5회·30분) |
| `PasswordHasher.verify` → `recordFailure`·`clearFailures` | `C-02` | `JF-1`과 같다(더미 해시·재해시 포함) |
| `.match` → `SessionService.issue` | `D-05` | 같은 `sessions` 표에 `subject_type='ADMIN'`으로 적고 `ASID` 쿠키를 준다. 유휴 30분·절대 8시간, 로그인 유지 없음(잠정 — §4.2) |

- **완료 사실** 운영자 세션 1행 + `ASID`. 역할(잠정 `ADMIN` 하나 — 세분화는 §8)은 `Principal.role`로 나가고, 경로별 허용 판단은 mall-api가 한다.
- 고객 `SID`와 운영자 `ASID`는 다른 쿠키라, 같은 브라우저에서 고객으로 로그인한 채 운영 화면을 써도 서로의 세션을 덮지 않는다. `ASID`는 `Path=/api/admin`이라 고객 API 요청에 실려 가지 않는다.

### JF-10 세션 확인 — SessionService.authenticate

```jobflow
orchestrator: SessionService
Object: SessionService, SessionStore, SessionPolicy

SessionService.authenticate --> SessionStore.findByIdHash
SessionStore.findByIdHash.missing
SessionStore.findByIdHash.result --> SessionPolicy.judge
SessionPolicy.judge.expired
SessionPolicy.judge.stale --> SessionStore.touch
```

| 노드 | 근거 | 비고 |
|---|---|---|
| `SessionService.authenticate` | `D-05`·`C-02` | 공개 계약 `authenticate(sessionId)`. mall-api 인증 미들웨어가 요청마다 쿠키 값을 넘긴다(상위 §4.3). 쿠키가 없으면 미들웨어가 부르지 않는다 |
| `SessionStore.findByIdHash`·`.missing` | `D-05` | `SHA-256(sessionId)`로 `sessions` 기본 키 조회 1회. 주체 상태와 표시 이름 재료(`members.status`·`login_id`·`join_type`, `admin_users.active`·`name`)는 같은 문장에서 조인해 읽는다(모듈 안의 표끼리라 경계 위반이 아니다). `displayName`은 이 값으로 §2 규칙대로 만든다. 없거나 주체가 비활성이면 `.missing` → `anonymous` |
| `SessionPolicy.judge`·`.expired` | `D-05` | `now > idle_expires_at` 또는 `now > absolute_expires_at`이면 `.expired` → `anonymous`(행은 그대로 두고 보존 작업이 지운다 — 읽기 경로에서 쓰지 않는다) |
| `.stale` → `SessionStore.touch` | `D-05` | 마지막 연장 뒤 5분이 지났으면 `last_seen_at`·`idle_expires_at`를 늘린다(슬라이딩 갱신). 5분 안이면 쓰지 않는다 — 세션당 쓰기는 많아야 5분에 1번이다. 로그인 유지 세션은 이때 `refreshCookie = true`라 미들웨어가 `SID`의 Max-Age를 다시 14일로 쓴다 |

- **성능 판단**: 요청마다 기본 키 조회 1회(조인 포함)이고, 쓰기는 세션당 5분에 1번까지다. 캐시는 두지 않는다 — 두면 로그아웃·비밀번호 변경·탈퇴의 즉시 무효화(`D-05`의 선택 이유)를 캐시 무효화로 다시 풀어야 한다. 실제 지연은 측정하지 않았다(미확인).
- **세션 발급**(`SessionService.issue` — 열지 않음): 보안 난수 32바이트를 base64url로 쿠키에 넣고, DB에는 SHA-256만 적는다 — DB가 새어도 살아 있는 세션 ID는 나오지 않는다. 요청에 이전 쿠키가 있으면 그 행을 먼저 지운다(세션 고정 방지).
- `.missing`·`.expired`는 `anonymous`를 돌려주는 단독 줄이다. `authenticate`는 예외를 던지지 않는다 — DB 장애만 예외로 올라가 미들웨어가 503으로 바꾼다.

## 4. 소유 상태·데이터

**결론**: 표 7개 — 회원·약관·소셜 연결·세션·본인인증 결과·운영자 계정과, 소셜 `state`·가입 티켓을 담는 `auth_tickets`다. 모두 member만 쓴다. 다른 모듈은 이 표를 직접 읽지 않고 공개 계약(`authenticate` 등)만 부른다.

| 표 | 주요 열 | 비고 |
|---|---|---|
| `members` | `id`, `login_id`(유일·대소문자 무시, NULL 가능), `password_hash`(알고리즘 접두, NULL 가능), `join_type`(`PASSWORD`·`KAKAO`·`NAVER`), `status`(`ACTIVE`·`WITHDRAWN`), `name_enc`·`phone_enc`·`email_enc`·`birth_date_enc`, `ci_hash`(유일, NULL 가능), `failed_login_count`, `locked_until`, `password_changed_at`, `created_at`, `withdrawn_at` | 잠금은 별도 상태가 아니라 `locked_until > now`다. 탈퇴하면 개인정보 열과 `login_id`·`ci_hash`를 NULL로 — 같은 사람·같은 아이디로 바로 다시 가입할 수 있다 |
| `member_terms_agreements` | `member_id`, `terms_code`, `terms_version`, `agreed`, `agreed_at` | 유일 `(member_id, terms_code, terms_version)`. 약관 정의(코드·버전·필수 여부·시행일)는 설정 파일로 둔다(잠정). 새 버전 동의는 새 행 — 과거 행을 고치지 않는다 |
| `social_accounts` | `member_id`, `provider`, `provider_user_id`, `linked_at` | 유일 `(provider, provider_user_id)`, 유일 `(member_id, provider)`. IdP 토큰은 저장하지 않는다 |
| `sessions` | `id_hash`(기본 키, SHA-256), `subject_type`(`MEMBER`·`ADMIN`), `subject_id`, `keep_signed_in`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at` | 색인 `(subject_type, subject_id)` — `revokeAll`용. 폐기 = 행 삭제 |
| `identity_verifications` | `id`(`verificationId`, 무작위 UUID), `purpose`(`SIGNUP`·`PASSWORD_RESET`), `provider_tx_id`(유일), `ci_hash`, `name_enc`, `phone_enc`, `birth_date_enc`, `verified_at`, `expires_at`(+30분), `used_at` | CI 원문은 저장하지 않는다. 행은 만료·사용 1일 뒤 지운다 |
| `admin_users` | `id`, `login_id`(유일), `password_hash`, `name`, `role`(잠정 `ADMIN` 하나), `active`, `failed_login_count`, `locked_until`, `last_login_at` | 첫 계정은 마이그레이션 시드(초기 비밀번호는 배포 비밀값). 관리 화면 없음(§1) |
| `auth_tickets` | `token_hash`(기본 키), `kind`(`OAUTH_STATE`·`SIGNUP_TICKET`), `provider`, `payload_enc`(`OAUTH_STATE`: PKCE `code_verifier`, 티켓: `providerUserId`·이메일·닉네임), `expires_at`, `used_at` | `OAUTH_STATE` 5분, `SIGNUP_TICKET` 10분, 일회성. 원문은 브라우저의 같은 이름 httpOnly 쿠키에만 있다 |

- **개인정보 암호화(잠정)**: `*_enc` 열은 애플리케이션이 AES-256-GCM으로 암호화하고 키는 배포 비밀값(`MEMBER_PII_KEY`)으로 둔다. 휴대폰·이메일로 회원을 찾는 기능이 없어 검색용 해시는 두지 않는다. `ci_hash` = `HMAC-SHA256(CI, MEMBER_CI_HMAC_KEY)` — 유일 제약과 조회에만 쓴다.
- **트랜잭션**: 유스케이스 서비스 메서드가 경계다(`JF-1`~`JF-9`의 「한 트랜잭션」 불릿). 외부 호출(IdP·본인인증 업체)은 트랜잭션 밖에서 먼저 하고, 결과를 받은 뒤 트랜잭션을 연다(상위 §6.3).

### 4.1 회원 상태 기계

상태 소유자는 `MemberStore`(`members.status`와 `locked_until`)다. 초기화는 가입 커밋(`JF-3`·`JF-5`)이다. 운영자 계정(`admin_users`)도 `LOCKED` 전이는 같고, `WITHDRAWN` 대신 `active = false`다.

```state
<s> --> (ACTIVE) : 가입 — 본인인증 또는 소셜
(ACTIVE) --> (LOCKED) : 비밀번호 5회 연속 실패
(LOCKED) --> (ACTIVE) : 30분 경과
(LOCKED) --> (ACTIVE) : 비밀번호 재설정
(ACTIVE) --> (WITHDRAWN) : 탈퇴 — 진행 중 주문 없음
(LOCKED) --> (WITHDRAWN) : 탈퇴 — 진행 중 주문 없음
(WITHDRAWN) --> <e> : 약관 동의 이력 3년 보관 뒤 파기
```

**기호**: `<s>` 시작점, `(…)` 상태, `<e>` 회원 기록의 수명이 끝나는 곳, `A --> B : 글` A에서 B로 가는 전이와 그 조건(`state-diagram-guide.md` 「구성 요소」).

- **불변조건**: `WITHDRAWN` 행에는 개인정보 열·`login_id`·`ci_hash`·`password_hash`가 모두 NULL이고 세션·소셜 연결 행이 없다. `WITHDRAWN`에서 나가는 전이는 없다 — 재가입은 새 회원 ID다.
- `LOCKED`에서도 소셜 로그인과 비밀번호 재설정은 된다. 잠금 중 비밀번호 로그인은 검증 없이 423이다(`JF-1`).
- `WITHDRAWN`의 `<e>`는 회원 ID 행 자체를 지우는 것이 아니다 — 주문·클레임이 참조하므로 ID와 `withdrawn_at`은 남는다(잠정 — 주문 보존 기간 5년과 함께 법무 확인, 상위 §9.5).

### 4.2 세션 상태 기계와 수명

상태 소유자는 `SessionService`(`sessions` 행)다. 초기화는 로그인·가입·비밀번호 변경의 `issue`다.

```state
<s> --> (ACTIVE) : issue — 로그인·가입·비밀번호 변경
(ACTIVE) --> (ACTIVE) : touch — 마지막 연장 5분 경과 뒤 요청
(ACTIVE) --> (EXPIRED) : 유휴 기한 또는 절대 기한 경과
(ACTIVE) --> <e> : revoke — 로그아웃·재로그인·비밀번호 변경·탈퇴
(EXPIRED) --> <e> : 보존 작업이 삭제
```

**기호**: 위와 같다. `<e>`는 세션 행 삭제다.

| 종류 | 쿠키 | 유휴 기한(슬라이딩) | 절대 기한 | 근거 |
|---|---|---|---|---|
| 회원 일반 | `SID`, 브라우저 세션 쿠키(Max-Age 없음) | 2시간 | 24시간(잠정) | `D-05` |
| 회원 로그인 유지 | `SID`, Max-Age 14일(연장 때 다시 씀) | 14일 | 30일(잠정) | `D-05` |
| 운영자 | `ASID`, `Path=/api/admin`, SameSite=Strict | 30분(잠정) | 8시간(잠정) | `D-05`·`R-21` |

- **불변조건**: 활성 세션의 주체는 `ACTIVE` 회원이나 활성 운영자다. `EXPIRED` 행은 `authenticate`가 `anonymous`로 본다 — 지워지기 전에도 쓸 수 없다.
- **폐기 시점**: 로그아웃(그 행), 재로그인(요청에 실린 이전 행), 비밀번호 재설정(그 회원 전부), 비밀번호 변경(현재 행을 새 ID로 바꾸고 나머지 전부), 탈퇴(전부). 모두 커밋 즉시 다음 요청부터 `anonymous`다(`R-03`·`R-06`).

### 4.3 본인인증 결과 상태 기계

상태 소유자는 `VerificationStore`(`identity_verifications` 행)다. 초기화는 업체 결과 조회 성공(`JF-4`의 `save`, `JF-6`의 `saveUsed`)이다.

```state
<s> --> (VERIFIED) : 가입용 결과 조회 성공
<s> --> (USED) : 재설정용 결과 조회 성공 — 바로 소비
(VERIFIED) --> (USED) : 가입 커밋 — 일회 사용
(VERIFIED) --> (EXPIRED) : 30분 경과
(USED) --> <e> : 1일 뒤 삭제
(EXPIRED) --> <e> : 1일 뒤 삭제
```

**기호**: 위와 같다. `<e>`는 행 삭제다.

- **불변조건**: 업체 거래 ID 하나에 행 하나(유일 제약 — 재사용 차단). `USED`로 가는 전이는 조건부 갱신 하나뿐이라 동시 가입 두 건 중 하나만 통과한다. `auth_tickets`도 같은 모양(`ISSUED` → `USED`·`EXPIRED`)이고 기한만 5분·10분이다.
- **비밀번호 해시(잠정)**: argon2id(메모리 19MiB·반복 2·병렬 1 — OWASP 「Password Storage Cheat Sheet」의 최소 권장값). 저장 값에 알고리즘 접두를 붙여 bcrypt(비용 12)로 바꾸거나 매개변수를 올려도 로그인 때 재해시로 옮겨 간다(`JF-1`).

### 4.4 보존과 파기

`purgeExpired`(`RetentionTask` 구현)는 mall-api 스케줄러의 하루 1회 보존 작업이 부른다(상위 §6.2). 표마다 한 번에 1,000행씩 지우고, 남으면 다음 실행에 잇는다. 결과는 `PurgeResult {task:'member', deleted}`(네 표 합)이다.

| 대상 | 지우는 조건 | 근거 |
|---|---|---|
| `sessions` | `idle_expires_at` 또는 `absolute_expires_at` < now | `D-05` |
| `identity_verifications` | `used_at` 또는 `expires_at` + 1일 < now | `C-04` |
| `auth_tickets` | `expires_at` + 1일 < now | `C-03` |
| `member_terms_agreements` | 회원 `withdrawn_at` + 3년 < now(잠정) | `C-20`·`R-25` |

## 5. 의존 — 나가는 방향

**결론**: 나가는 의존은 셋이다 — 소셜 IdP 둘(카카오·네이버), 본인인증 업체 하나, order 모듈의 `hasActiveOrders` 하나. 알림·장바구니는 부르지 않는다(로그인 뒤 병합은 화면이 cart를 부른다).

| 상대 | 쓰는 계약 | 배선·설정 | 타임아웃 | 결합 |
|---|---|---|---|---|
| 카카오·네이버 로그인(`SocialOAuthGateway`) | 동의 주소(브라우저), 토큰 교환, 프로필 조회, 연결 끊기 — OAuth 2.0 인가 코드 방식(가정) | `member.oauth.{provider}.client-id`·`client-secret`·`redirect-uri` | 교환+프로필 합 5s, 연결 끊기 5s, 재시도 없음 | 프로필 필드 이름·이메일 제공 여부가 업체마다 다르다 — 게이트웨이가 `{providerUserId, email?, nickname?}`로 맞춘다 |
| 본인인증 업체(`IdentityVerificationGateway`) | 결과 조회(거래 ID → 이름·생년월일·휴대폰·CI·인증 시각, 서버 대 서버) — 가정 | `member.idv.base-url`·`api-key` | 5s, 재시도 없음 | 업체 미정(상위 §9.5). 서버 조회가 없는 업체면 `JF-4`·`JF-6`의 위조 방지가 무너진다 |
| order(`OrderApi`) | `hasActiveOrders(memberId) → boolean`([order 상세 §2](order.md#2-공개-계약)) | 같은 프로세스 안의 서비스 주입(mall-api 조립) | 해당 없음 — 같은 DB 트랜잭션 밖의 읽기 | 「진행 중」의 정의는 order가 갖는다. member → order 한 방향이고 order는 member를 부르지 않는다(상위 §3.1) |

- 들어오는 쪽: mall-api 미들웨어(`authenticate`), mall-api 스케줄러(보존 작업의 `purgeExpired`, 탈퇴 정리 작업의 `listWithdrawnSince`), 두 화면(HTTP). 다른 업무 모듈은 member를 부르지 않는다 — 요청 주체는 미들웨어가 넘긴 `Principal`로 안다.

## 6. 실패 경계

**결론**: 외부 호출은 모두 트랜잭션 밖에서 짧은 타임아웃으로 한 번만 부르고, 실패하면 사용자가 다시 시작한다. 결과 불명이 남는 곳은 탈퇴 뒤 IdP 연결 끊기 하나이고, 그것은 탈퇴 결과를 바꾸지 않는다.

| 항목 | 기본값 | 설정 키 | 위치 |
|---|---|---|---|
| 로그인 실패 잠금 | 5회 연속 → 30분 | `member.login.max-failures`·`member.login.lock-duration` | `MemberStore.recordFailure`·`AdminUserStore.recordFailure` |
| 회원 세션 유휴·절대 | 2시간·24시간 / 로그인 유지 14일·30일 | `member.session.idle`·`member.session.absolute`·`member.session.keep-idle`·`member.session.keep-absolute` | `SessionPolicy` |
| 운영자 세션 유휴·절대 | 30분·8시간 | `member.admin-session.idle`·`member.admin-session.absolute` | `SessionPolicy` |
| 슬라이딩 갱신 간격 | 5분 | `member.session.touch-interval` | `SessionPolicy.judge` |
| 소셜 `state` / 가입 티켓 — 저장 행과 쿠키 `OAUTH_STATE`·`SIGNUP_TICKET`의 Max-Age | 5분 / 10분 | `member.oauth.state-ttl`·`member.oauth.ticket-ttl` | `AuthTicketStore`, `OAuthRoutes` |
| PKCE | S256, `code_verifier` 64자 | `member.oauth.{provider}.pkce`(IdP가 받지 않으면 `false`) | `SocialOAuthGateway` |
| 본인인증 결과 유효 / 업체 인증 시각 허용 | 30분 / 10분 | `member.idv.result-ttl`·`member.idv.max-age` | `VerificationStore`·`VerificationService` |
| IdP 교환 / 본인인증 조회 / 연결 끊기 | 5s / 5s / 5s, 재시도 0 | `member.oauth.timeout`·`member.idv.timeout` | 두 게이트웨이 |
| 소셜 전용 회원의 재인증 기한 | 로그인 10분 이내 | `member.withdraw.reauth-window` | `ReauthPolicy` |

- **인증**: 모든 `/api/members/me*`는 회원 세션, `/api/admin/auth/me`·`logout`은 운영자 세션이 필요하다 — 판정은 mall-api 미들웨어다. 로그인·가입·재설정·콜백 라우트는 익명을 받는다. CSRF 토큰 확인은 mall-api가 하고, 콜백(`GET`)은 `state`의 쿠키·저장값·쿼리 대조와 PKCE가 같은 역할을 한다. 소셜 가입 티켓은 httpOnly 쿠키라 화면 스크립트가 읽지 못하고, `POST /api/signup/social`은 CSRF 이중 제출도 지난다.
- **동시성**: 일회성 자원(`state`·가입 티켓·본인인증 결과)은 모두 「`used_at IS NULL AND expires_at > now`」 조건부 갱신 하나로 소비한다 — 두 요청 중 하나만 1행을 바꾼다. 유일성(로그인 ID·CI·소셜 연결)은 검사가 아니라 DB 유일 제약이 최종 판정이다.
- **부분 실패**: 외부 조회 성공 뒤 트랜잭션이 실패하면 아무것도 남지 않고, 사용자는 처음부터 다시 한다. 본인인증 결과 행도 같은 트랜잭션에서 롤백되므로, 같은 업체 거래 ID로 다시 시도해도 `replayed`가 되지 않는다. 탈퇴 커밋 뒤 IdP 연결 끊기 실패는 로그만 남긴다.
- **최후 방어**: `authenticate`의 DB 장애는 예외로 올려 mall-api가 503을 낸다 — 장애 중에 요청을 익명으로 통과시키지 않는다.

## 7. 검증 계획

**결론**: 경계 안의 시험은 계약 단위(라우트·`authenticate`)로 두고, 외부 둘은 가짜 서버로 대신한다. 실제 업체 계약 확인은 상위 §9.2 「본인인증·소셜 계약 확인」이 원본이다.

| 검증 | 대상 계약·시나리오 | 방법·명령 | 시점 |
|---|---|---|---|
| 로그인 잠금 | `POST /api/auth/login` × 실패 4·5·6회, 잠금 30분 경과, 잠금 중 바른 비밀번호, 동시 실패 10건 | 시계를 주입한 통합 시험 — 1~4회 401, 5회째 423 `{until}`, 잠금 중 바른 비밀번호도 423, 30분 뒤 성공, 동시 10건 뒤 `failed_login_count`가 정확하다 | member 작업(상위 §9.1 순서 2) |
| 계정 존재 비노출 | 없는 아이디 vs 틀린 비밀번호 | 응답 코드·본문이 같은지, 응답 시간 중앙값 차이가 해시 1회 시간보다 훨씬 작은지(더미 해시 경로) | member 작업 |
| 세션 고정·즉시 무효화 | 로그인 전후 `SID`, 로그아웃·재설정·변경·탈퇴 뒤 이전 `SID` | 로그인 응답의 `SID`가 요청 쿠키와 다르다. 각 동작 뒤 이전 `SID`로 `GET /api/members/me` → 401. 비밀번호 변경 뒤 현재 기기는 새 `SID`로 200 | member 작업 |
| 세션 기한·슬라이딩 | `authenticate` | 시계 주입 — 4분 간격 요청은 쓰기 0회, 6분 뒤 요청은 `touch` 1회. 유휴 2시간·절대 24시간·로그인 유지 14일 경계값에서 `anonymous` | member 작업 |
| 소셜 `state`·PKCE | `GET /api/oauth/{provider}/callback` | 가짜 IdP — `state` 없음·다름·만료·두 번째 사용, `OAUTH_STATE` 쿠키 없음·쿼리와 다름 모두 302 `/login?error=social`이고 가짜 IdP 토큰 호출 0회. `error=access_denied`는 302 `/login?error=social_cancelled`. 토큰 교환 요청에 `code_verifier`가 실리고 가짜 IdP가 `code_challenge`와 맞춰 본다. 신규 회원 응답의 `Location`이 쿼리 없는 `/signup/social`이고 `SIGNUP_TICKET`이 httpOnly 쿠키다 | member 작업 |
| 소셜 가입 중복 | `POST /api/signup/social` | 같은 티켓 쿠키로 동시 2건 → 201 하나·410 하나. 티켓 둘로 같은 `providerUserId` → 201 하나·409 하나. 쿠키 없음 → 410 | member 작업 |
| CI 중복·본인인증 일회성 | `check-duplicate`·`signup`·`password/reset` | 가짜 업체 — 같은 거래 ID 두 번 → 둘째 422. 같은 CI로 동시 가입 2건 → 201 하나·409 `CI_TAKEN` 하나. 31분 뒤 `signup` → 410. 만 14세 미만 → 422 `UNDER_14` | member 작업 |
| 약관 동의 이력 | `signup`·`signupSocial` | 필수 하나 빠짐 → 422이고 본인인증·티켓 미소비. 성공 시 받은 약관 수만큼 행(선택 거절 포함), 버전·시각 일치 | member 작업 |
| 탈퇴 | `DELETE /api/members/me` | 비밀번호 회원 `password` 없음·틀림 → 401, 소셜 전용 회원 로그인 11분 뒤 → 403 `REAUTH_REQUIRED`. 가짜 `OrderApi`가 `true` → 409이고 아무것도 안 바뀜. `false` → 개인정보 열 NULL, 세션·소셜 행 0, 이전 `SID` 401, 같은 CI 재가입 가능. 가짜 IdP 연결 끊기 5xx → 그래도 204 | member 작업 |
| 외부 장애 | 두 게이트웨이 | 가짜 서버 지연 6초 → 콜백 302 `/login?error=social`, `check-duplicate` 502, DB 쓰기 0 | member 작업 |
| 경계 | 다른 모듈이 member 표를 참조하지 않음 | mall-api의 모듈 경계 검사 시험(상위 `C-21`)에 member 표 7개를 등록 | 순서 1부터 매 빌드 |

## 8. 위험·미확정

| 관련 ID | 분류 | 내용 | 근거 | 영향·대응 |
|---|---|---|---|---|
| `R-03` | 위험 | 계정 단위 잠금은 남의 아이디로 5번 틀려 그 회원을 30분 잠글 수 있다(잠금 남용). IP 단위 제한은 없다 | `JF-1` | 잠금 중에도 소셜 로그인·비밀번호 재설정은 된다. 남용이 보이면 mall-api에 IP·아이디 쌍 속도 제한을 더한다 |
| `C-03` | 미확정 | 카카오·네이버가 PKCE를 받는지, `state` 쿠키가 IdP에서 돌아오는 최상위 이동에 실리는지(SameSite=Lax) | §2·`JF-2` | 가정. PKCE를 받지 않는 IdP는 설정으로 끄고 `state` 3중 대조만 쓴다. 쿠키가 실리지 않는 브라우저가 보이면 소셜 로그인이 모두 `error=social`로 끝난다 — 업체 계약 확인(상위 §9.2)에서 본다 |
| `C-03`·`R-05` | 미확정 | 소셜 가입은 본인인증이 없어 CI 유일 원칙이 미치지 않는다 — 같은 사람이 계정 둘 | 상위 §9.5 | 잠정 허용. 소셜 가입에도 본인인증을 요구하면 `JF-3` 앞에 `JF-4`를 끼우고 티켓에 `verificationId`를 묶는다 |
| `C-03` | 위험 | 이메일 같은 기존 회원을 자동 연결하지 않아, 기존 회원이 소셜 버튼을 누르면 계정이 하나 더 생긴다 | `JF-2` | 화면이 소셜 가입 폼에 「이미 회원이면 기존 계정으로 로그인」 안내를 둔다. 로그인 상태에서 소셜을 연결하는 기능은 범위 밖(§1) |
| `D-05` | 미확정 | 절대 기한(24시간·30일), 운영자 세션(30분·8시간), 슬라이딩 간격 5분은 잠정값이다 | §4.2 | `D-05`가 정한 값은 유휴 2시간·로그인 유지 14일이다. 나머지는 운영 정책으로 확정한다 |
| `D-05`·`R-21` | 위험 | 운영자 계정에 2단계 인증이 없다 | §1 | 운영자 비밀번호 유출이 전체 주문·개인정보 노출로 이어진다. 첫 배포 뒤 TOTP 추가를 권한다 |
| `R-26`·`C-20` | 위험 | 탈퇴는 member 표만 즉시 정리한다. 장바구니·찜 삭제와 리뷰 작성자 익명화는 다음 날 mall-api 탈퇴 정리 작업이 `listWithdrawnSince` → `CartApi.purgeMembers`·`ReviewApi.anonymizeAuthors`로 한다(상위 §6.2) — 최대 하루 늦다. 회원 쿠폰은 로그인할 수 없어 쓰이지 않고 promotion 보존 기한에 지워진다 | `JF-8` | member가 다른 모듈을 부르지 않게 한 대가다. 즉시성이 필요하면 member → 각 모듈 통지 계약을 새로 둔다 |
| `R-26` | 미확정 | 상위 `R-26`의 「연락처·주소 즉시 파기」 중 주소는 member에 없다 — 배송지는 order의 주문 스냅숏(5년 보존)뿐이다 | 상위 §6.2 | 회원 배송지록을 두지 않는 한 member 쪽 파기 대상은 연락처뿐이다. 주문 스냅숏 파기는 order 상세가 정한다 |
| `R-26` | 위험 | `hasActiveOrders` 확인과 탈퇴 커밋 사이에 새 주문이 들어올 수 있다 | `JF-8` | 확률이 낮고(같은 회원의 동시 요청), 그 주문은 회원 ID로 남아 처리된다. 막으려면 order가 주문 생성 때 회원 상태를 확인해야 한다 — 의존 방향이 뒤집혀 택하지 않았다 |
| `R-26`·`C-20` | 미확정 | 재가입 제한이 없다 — 탈퇴 즉시 같은 CI로 가입해 1인 1매 쿠폰을 다시 받을 수 있다 | §4.1 | 막으려면 `ci_hash`를 탈퇴 뒤 일정 기간 남겨야 하는데, 그 보관 근거는 법무 확인이 필요하다(상위 §9.5) |
| `C-04` | 미확정 | 본인인증 업체의 결과 조회 응답 형식·인증 시각 제공 여부 | 상위 §9.5 | `IdentityVerificationGateway`가 흡수한다. 서버 조회가 없으면 이 설계의 CI 신뢰가 무너진다 |
| `C-02` | 미확정 | 비밀번호 해시 알고리즘·매개변수(argon2id 19MiB·2·1 vs bcrypt 12)와 로그인 ID·비밀번호 규칙 | §2·§4.3 | 접두 저장과 재해시로 나중에 바꿔도 이행 비용이 작다 |
| `R-25` | 미확정 | 개인정보 열 암호화 방식(애플리케이션 AES-GCM)과 키 관리(배포 비밀값 vs KMS), 마케팅 수신 동의 2년 재확인 통지 | §4 | 키 교체 시 재암호화 작업이 필요하다. `ci_hash`의 HMAC 키를 바꾸면 모든 CI 비교가 깨진다 — 바꾸지 않는 키로 둔다 |

## 9. 미확인·한계

1. 코드·실행 환경이 없는 신규 설계다 — 모든 수치(타임아웃·기한·해시 매개변수)는 설계값이고, `authenticate`의 지연과 해시 시간은 측정하지 않았다.
2. 카카오·네이버의 토큰·프로필·연결 끊기 API와 본인인증 업체의 결과 조회 API는 국내 보편 형태를 가정했다. 실제 응답 필드와 오류 코드는 확인하지 않았다.
3. 만 14세 미만 가입 거절, 약관 동의 이력 3년, 탈퇴 회원 ID 보존은 정보통신망법·개인정보보호법 해석에 기댄 잠정안이고 법무 검토를 거치지 않았다.
4. 같은 오리진에서 `SID`·`ASID` 두 쿠키를 나누는 동작은 브라우저에서 확인하지 않았다(설계상 예상).
5. jobflow 그림은 SVG·PNG로 배치를 봤지만, 그림이 실제 코드와 맞는지는 코드가 없어 확인할 수 없다.
