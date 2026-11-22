import React, { useState } from "react";
import { go, demoEmail, money } from "./model";

const demoPass = "OpenMall2026!";
const cleanPhone = (value) => String(value || "").replace(/[^0-9]/g, "");
const emailOf = (value) => value.trim().toLowerCase();
const field = (form, name) => String(new FormData(form).get(name) || "").trim();
const randomId = () => crypto.randomUUID();
const time = () => Date.now();
async function proofKey(scope, recipient) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([scope, recipient])),
  );
  return (
    "openmall.proof." +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
function locked(key, operation) {
  return navigator.locks
    ? navigator.locks.request(key, operation)
    : operation();
}

async function passwordDigest(value, salt) {
  const encoder = new TextEncoder();
  const secret = await crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 100000,
    },
    secret,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function credential(value) {
  const salt = randomId();
  return { salt, digest: await passwordDigest(value, salt) };
}
async function matches(account, value) {
  if (!account) return false;
  if (account.digest)
    return (await passwordDigest(value, account.salt)) === account.digest;
  return account.demo && value === demoPass;
}
function session(db, account) {
  const current = db.memberId || "guest";
  const baskets = {
    ...db.baskets,
    [current]: {
      cart: db.cart,
      cartPrices: db.cartPrices,
      cartExcluded: db.cartExcluded || [],
      saved: db.saved,
    },
  };
  const next = baskets[account?.id || "guest"] || {
    cart: {},
    cartPrices: {},
    cartExcluded: [],
    saved: [],
  };
  return {
    ...db,
    ...next,
    baskets,
    member: !!account,
    memberId: account?.id || null,
    profile: account?.profile || {},
    direct: null,
    transfer: null,
    guestId: null,
    guestUntil: 0,
  };
}
// Each send replaces the previous challenge for that purpose and recipient.
function CodeCheck({
  scope,
  recipient,
  allowed = true,
  onVerified,
  onRequested,
}) {
  const [busy, setBusy] = useState(false),
    [challenge, setChallenge] = useState(null),
    [entry, setEntry] = useState(""),
    [error, setError] = useState("");
  async function send() {
    if (!recipient || busy) return;
    setBusy(true);
    try {
      const storageKey = await proofKey(scope, recipient);
      await locked(storageKey, async () => {
        const digits = String(
            100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
          ),
          id = randomId();
        for (const k of Object.keys(localStorage).filter((k) =>
          k.startsWith("openmall.proof."),
        )) {
          if (JSON.parse(localStorage.getItem(k) || "null")?.until <= time())
            localStorage.removeItem(k);
        }
        const token = {
          id,
          until: time() + 180000,
          tries: 0,
          hash: await passwordDigest(digits, id),
        };
        localStorage.setItem(storageKey, JSON.stringify(token));
        setChallenge({ id, digits });
        setError("");
        setEntry("");
        onRequested?.();
      });
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (busy) return;
    setBusy(true);
    try {
      const storageKey = await proofKey(scope, recipient);
      const ok = await locked(storageKey, async () => {
        const latest = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (
          !latest ||
          latest.id !== challenge?.id ||
          time() >= latest.until ||
          latest.tries >= 5
        ) {
          setError("인증번호가 만료되었습니다. 새 번호를 요청해 주세요.");
          return false;
        }
        latest.tries++;
        if (
          !allowed ||
          (await passwordDigest(entry, latest.id)) !== latest.hash
        ) {
          localStorage.setItem(storageKey, JSON.stringify(latest));
          setError("인증번호를 확인해 주세요.");
          return false;
        }
        localStorage.removeItem(storageKey);
        return true;
      });
      if (ok) {
        setChallenge(null);
        await onVerified();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="code-check">
      <button type="button" disabled={!recipient || busy} onClick={send}>
        {challenge ? "인증번호 재발급" : "인증번호 요청"}
      </button>
      {challenge && (
        <>
          <p>
            일치하는 정보가 있으면 등록한 연락처로 인증번호가 발급됩니다.
            유효시간은 3분입니다.
          </p>
          <details>
            <summary>가상 수신함 열기</summary>
            <p>
              새 인증번호 <b>{challenge.digits}</b>
            </p>
          </details>
          <label>
            인증번호
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </label>
          <button type="button" disabled={busy} onClick={check}>
            인증번호 확인
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function GuestProof({ phone, onVerified }) {
  const valid = /^01[016789]\d{7,8}$/.test(cleanPhone(phone));
  return (
    <CodeCheck
      key={phone}
      scope="checkout"
      recipient={valid ? cleanPhone(phone) : ""}
      onVerified={() => onVerified(phone)}
    />
  );
}
function GuestLookup({ db, update, copy = false, requested = "" }) {
  const [id, setId] = useState(requested),
    [phone, setPhone] = useState(""),
    [record, setRecord] = useState(null);
  const o = db.orders.find(
    (o) =>
      o.id === id.trim() &&
      (copy ? (db.withdrawn || []).includes(o.memberId) : !o.member) &&
      cleanPhone(o.contact || o.delivery?.phone) === cleanPhone(phone),
  );
  const [tick, setTick] = useState(time);
  React.useEffect(() => {
    if (!record) return;
    const timer = setTimeout(
      () => setTick(time()),
      Math.max(0, record.until - time() + 1),
    );
    return () => clearTimeout(timer);
  }, [record]);
  const receipt =
    record && record.until > Math.max(tick, time()) && o?.id === record.id
      ? o
      : null;
  return (
    <>
      <h2>{copy ? "탈퇴 후 거래기록 사본" : "비회원 주문 조회"}</h2>
      <p>주문번호와 주문할 때 인증한 연락처를 입력해 주세요.</p>
      <label>
        주문번호
        <input
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setRecord(null);
          }}
        />
      </label>
      <label>
        주문자 연락처
        <input
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setRecord(null);
          }}
        />
      </label>
      <CodeCheck
        key={id + phone}
        scope={(copy ? "receipt." : "lookup.") + id}
        recipient={
          id.trim() && cleanPhone(phone).length >= 9 ? cleanPhone(phone) : ""
        }
        allowed={!!o}
        onVerified={async () => {
          if (!o) return;
          if (copy) {
            if (
              !(await update({
                ...db,
                recordAccess: [
                  ...(db.recordAccess || []),
                  {
                    orderId: o.id,
                    at: new Date().toISOString(),
                    purpose: "탈퇴 회원 사본 교부",
                  },
                ],
              }))
            )
              return;
            setRecord({ id: o.id, until: time() + 180000 });
          } else {
            if (
              !(await update({
                ...db,
                guestId: o.id,
                guestUntil: time() + 900000,
              }))
            )
              return;
            go("/orders/" + o.id);
          }
        }}
      />
      {receipt && (
        <section>
          <h3>거래기록 사본</h3>
          <p>
            {receipt.id} · {receipt.method} · {receipt.stage}
          </p>
          <p>
            원거래 {receipt.paymentId} · 승인 시각{" "}
            {receipt.paidAt
              ? new Date(receipt.paidAt).toLocaleString("ko-KR")
              : "미승인"}
          </p>
          <p>
            주문 금액 {money(receipt.total)} · 확정 환불{" "}
            {money(receipt.refunded)} · 승인 잔액{" "}
            {money(receipt.paidAt ? receipt.total - receipt.refunded : 0)}
          </p>
          {receipt.claims
            .filter((c) => c.refundId)
            .map((c) => (
              <p key={c.id}>
                {c.refundId} · {money(c.amount)} ·{" "}
                {c.refundedAt ? "확정" : "처리 중"}
              </p>
            ))}
          <button onClick={() => window.print()}>인쇄·PDF 저장</button>
        </section>
      )}
    </>
  );
}
export function Access({
  db,
  update,
  target = "/my/account",
  mode = "login",
  orderId = "",
  resetId = "",
}) {
  const [step, setStep] = useState(mode),
    [error, setError] = useState(""),
    [signup, setSignup] = useState(null),
    [reset, setReset] = useState(null),
    [busy, setBusy] = useState(false);
  function move(s) {
    setError("");
    setStep(s);
  }
  async function login(account) {
    const next = session(db, account);
    if (!db.member && target === "/checkout") {
      const lines = Object.fromEntries(
        Object.entries(db.cart).filter(
          ([id]) => !(db.cartExcluded || []).includes(id),
        ),
      );
      if (await update({ ...next, direct: lines, transfer: lines }))
        go("/checkout/direct");
    } else {
      if (target === "/checkout/direct") next.direct = db.direct;
      if (await update(next)) go(target);
    }
  }
  const form = (callback) => async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await callback(event.currentTarget);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const loginForm = (
    <form
      onSubmit={form(async (f) => {
        const a = db.accounts.find(
          (a) => a.email === emailOf(field(f, "email")),
        );
        if (!(await matches(a, field(f, "password"))))
          throw Error("이메일 또는 비밀번호를 확인해 주세요.");
        await login(a);
      })}
    >
      <label>
        이메일
        <input type="email" name="email" autoComplete="username" required />
      </label>
      <label>
        비밀번호
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="primary" disabled={busy}>
        로그인
      </button>
    </form>
  );
  const tabs = [
    ["login", "로그인"],
    ["signup", "회원가입"],
    ["guest", "비회원 주문 조회"],
  ];
  return (
    <section className="identity-shell">
      <div className="identity-intro">
        <small>MY OPENMALL</small>
        <h1>계정과 주문 조회</h1>
        <p>
          회원으로 로그인하거나, 주문할 때 사용한 연락처로 비회원 주문 한 건을
          확인하세요.
        </p>
      </div>
      <div className="panel auth-panel">
        <div className="tabs">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={step === id}
              onClick={() => {
                setReset(null);
                setSignup(null);
                move(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {step === "login" && (
          <>
            <h2>이메일 로그인</h2>
            {loginForm}
            <div className="actions">
              <button onClick={() => move("reset")}>비밀번호 재설정</button>
              {db.accounts.some((a) => a.demo && !a.digest) && (
                <button onClick={() => login(db.accounts.find((a) => a.demo))}>
                  체험 회원 로그인
                </button>
              )}
            </div>
            <p className="muted">
              체험 계정 {demoEmail} · 초기 비밀번호 {demoPass}
            </p>
          </>
        )}
        {step === "signup" && (
          <form
            onSubmit={form(async (f) => {
              const email = emailOf(field(f, "email")),
                pw = field(f, "password"),
                name = field(f, "name"),
                marketing = new FormData(f).has("marketing");
              if (db.accounts.some((a) => a.email === email))
                throw Error("이미 가입한 이메일입니다.");
              setSignup({
                id: randomId(),
                email,
                profile: { name, address: "", phone: "" },
                marketing,
                consentedAt: new Date().toISOString(),
                ...(await credential(pw)),
              });
              move("verify");
            })}
          >
            <h2>계정 만들기</h2>
            <label>
              이름
              <input required name="name" pattern=".*\S.*" />
            </label>
            <label>
              이메일
              <input required type="email" name="email" />
            </label>
            <label>
              비밀번호 (8자 이상)
              <input
                required
                type="password"
                minLength={8}
                name="password"
                autoComplete="new-password"
              />
            </label>
            <p>
              가입 정보는 계정과 주문 관리에 사용하며 탈퇴 시 정리합니다.
              거래기록의 보존 기간은 판매자 정보에서 확인하세요.
            </p>
            <label className="check">
              <input type="checkbox" required />
              필수 이용약관에 동의합니다
            </label>
            <label className="check">
              <input type="checkbox" name="marketing" />
              선택 · 이메일 소식 받기 (철회 시까지)
            </label>
            <button className="primary" disabled={busy}>
              이메일 인증으로 계속
            </button>
          </form>
        )}
        {step === "verify" && signup && (
          <>
            <h2>가입 이메일 확인</h2>
            <p>{signup.email}</p>
            <CodeCheck
              scope="signup"
              recipient={signup.email}
              onVerified={async () => {
                if (db.accounts.some((a) => a.email === signup.email)) {
                  setError("이미 가입한 이메일입니다.");
                  return;
                }
                if (
                  !(await update({ ...db, accounts: [...db.accounts, signup] }))
                )
                  return;
                setSignup(null);
                move("login");
                setError("가입이 완료되었습니다. 로그인해 주세요.");
              }}
            />
          </>
        )}
        {step === "reset" && (
          <form
            onSubmit={form(async (f) => {
              const email = emailOf(field(f, "email")),
                a = db.accounts.find((a) => a.email === email);
              const token = {
                id: randomId(),
                accountId: a?.id,
                until: time() + 600000,
              };
              if (
                a &&
                !(await update({
                  ...db,
                  resets: { ...db.resets, [a.id]: token },
                }))
              )
                return;
              setReset(token);
              move("sent");
            })}
          >
            <h2>비밀번호 재설정</h2>
            <label>
              가입 이메일
              <input required name="email" type="email" />
            </label>
            <button>재설정 안내 요청</button>
          </form>
        )}
        {step === "sent" && (
          <>
            <h2>이메일을 확인해 주세요</h2>
            <p>등록된 계정이라면 재설정 링크를 보냈습니다.</p>
            <details>
              <summary>가상 메일함</summary>
              {reset ? (
                <a
                  className="button"
                  href={"#/access?mode=new-password&token=" + reset.id}
                >
                  재설정 링크 열기
                </a>
              ) : (
                <p>수신한 메일이 없습니다.</p>
              )}
            </details>
          </>
        )}
        {step === "new-password" && (
          <form
            onSubmit={form(async (f) => {
              const token = Object.values(db.resets || {}).find(
                (t) => t.id === resetId,
              );
              if (!token || token.until <= time())
                throw Error(
                  "만료되었거나 이미 사용한 링크입니다. 재설정 안내를 다시 요청해 주세요.",
                );
              const secret = await credential(field(f, "password")),
                resets = { ...db.resets };
              delete resets[token.accountId];
              if (
                !(await update({
                  ...session(db, null),
                  resets,
                  accounts: db.accounts.map((a) =>
                    a.id === token.accountId ? { ...a, ...secret } : a,
                  ),
                }))
              )
                return;
              setReset(null);
              move("login");
              setError("비밀번호를 변경했습니다.");
            })}
          >
            <h2>새 비밀번호 설정</h2>
            <label>
              새 비밀번호 (8자 이상)
              <input required minLength={8} type="password" name="password" />
            </label>
            <button disabled={busy}>저장하고 로그인하기</button>
            <button type="button" onClick={() => move("reset")}>
              안내 다시 요청
            </button>
          </form>
        )}
        {["guest", "copy"].includes(step) && (
          <GuestLookup
            key={step}
            db={db}
            update={update}
            requested={orderId}
            copy={step === "copy"}
          />
        )}
        {error && <p role="status">{error}</p>}
        <hr />
        <button onClick={() => move("copy")}>탈퇴 회원 거래기록 요청</button>
      </div>
    </section>
  );
}
export function Account({ db, update }) {
  const account = db.accounts.find((a) => a.id === db.memberId);
  const [edit, setEdit] = useState(false),
    [withdraw, setWithdraw] = useState(false),
    [msg, setMsg] = useState("");
  if (!account) return <Access db={db} update={update} />;
  function saveAccount(next) {
    return update({
      ...db,
      profile: next.profile,
      accounts: db.accounts.map((a) => (a.id === next.id ? next : a)),
    });
  }
  return (
    <>
      <small>MY OPENMALL</small>
      <h1>회원 정보</h1>
      <div className="split">
        <section className="panel">
          <h2>내 계정</h2>
          <p>{account.email}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={account.marketing}
              onChange={(e) =>
                saveAccount({
                  ...account,
                  marketing: e.target.checked,
                  consentHistory: [
                    ...(account.consentHistory || []),
                    {
                      at: new Date().toISOString(),
                      marketing: e.target.checked,
                    },
                  ],
                })
              }
            />
            이메일 소식 받기
          </label>
          <div className="actions">
            <a className="button" href="#/my/orders">
              내 주문 보기
            </a>
            <button
              onClick={async () => {
                if (await update(session(db, null))) go("/");
              }}
            >
              로그아웃
            </button>
          </div>
          <hr />
          <button
            onClick={() => {
              setWithdraw(!withdraw);
              setMsg("");
            }}
          >
            회원 탈퇴
          </button>
          {withdraw && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  !(await matches(account, field(e.currentTarget, "password")))
                ) {
                  setMsg("비밀번호를 확인해 주세요.");
                  return;
                }
                const next = session(db, null);
                delete next.baskets[account.id];
                next.resets = { ...db.resets };
                delete next.resets[account.id];
                if (
                  !(await update({
                    ...next,
                    accounts: db.accounts.filter((a) => a.id !== account.id),
                    withdrawn: [...(db.withdrawn || []), account.id],
                  }))
                )
                  return;
                go("/access?mode=copy");
              }}
            >
              <p>
                주소록과 회원 세션을 삭제합니다. 계약·결제·공급 기록은 5년,
                불만·분쟁 기록은 3년 동안 별도 보관합니다.
              </p>
              <label>
                현재 비밀번호
                <input required type="password" name="password" />
              </label>
              <button>탈퇴 확정</button>
            </form>
          )}
        </section>
        <section className="panel">
          <h2>기본 배송지</h2>
          {edit ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const profile = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                if (!(await saveAccount({ ...account, profile }))) return;
                setEdit(false);
                setMsg("기본 배송지를 저장했습니다. 다음 주문부터 적용됩니다.");
              }}
            >
              {[
                ["name", "수취인"],
                ["phone", "연락처"],
                ["zip", "우편번호"],
                ["address", "주소"],
                ["detail", "상세 주소 (선택)"],
              ].map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    defaultValue={db.profile[k] || ""}
                    required={k !== "detail"}
                    pattern={
                      k === "zip"
                        ? "[0-9]{5}"
                        : k === "detail"
                          ? undefined
                          : k === "phone"
                            ? "[0-9\\- ]{9,15}"
                            : ".*\\S.*"
                    }
                    name={k}
                  />
                </label>
              ))}
              <div className="actions">
                <button className="primary">배송지 저장</button>
                <button type="button" onClick={() => setEdit(false)}>
                  취소
                </button>
              </div>
            </form>
          ) : (
            <>
              <p>
                {db.profile.name} · {db.profile.phone}
                <br />
                {[db.profile.zip, db.profile.address, db.profile.detail]
                  .filter(Boolean)
                  .join(" ") || "등록된 주소가 없습니다."}
              </p>
              <button onClick={() => setEdit(true)}>배송지 편집</button>
            </>
          )}
        </section>
      </div>
      <p role="status">{msg}</p>
    </>
  );
}
