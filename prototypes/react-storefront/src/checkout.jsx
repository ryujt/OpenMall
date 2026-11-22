import React, { useEffect, useState } from "react";
import { shippingPolicy, zoneForAddress } from "./delivery-policy";
import { GuestProof } from "./identity";
import { basketLines, go, money } from "./model";
import { createOrder, quote, couponAvailable } from "./commerce";
import { Empty, Lines, Summary } from "./order-ui";

const addressSamples = {
  서울: { zip: "03925", address: "서울 마포구 월드컵북로 12" },
  제주: { zip: "63000", address: "제주 제주시 한림읍 한림로 12" },
  배송제한: { zip: "00000", address: "배송 제한 권역" },
};
function quoteChanges(previous, current) {
  if (!current) return ["구매할 수 없는 품목 또는 배송 조건을 확인해 주세요."];
  const changes = [];
  for (const line of previous.lines) {
    const latest = current.lines.find((p) => p.id === line.id);
    if (!latest) {
      changes.push(line.name + " · 주문 대상에서 제외");
      continue;
    }
    if (line.price !== latest.price)
      changes.push(
        line.name + " 단가 " + money(line.price) + " → " + money(latest.price),
      );
    if (line.qty !== latest.qty)
      changes.push(
        line.name + " 수량 " + line.qty + "개 → " + latest.qty + "개",
      );
    if (line.option !== latest.option || line.version !== latest.version)
      changes.push(line.name + " · 상품 고시 또는 옵션 변경");
  }
  for (const added of current.lines.filter(
    (p) => !previous.lines.some((l) => l.id === p.id),
  ))
    changes.push(added.name + " " + added.qty + "개 추가");
  if (previous.shippingPolicy?.version !== current.shippingPolicy?.version)
    changes.push(
      "배송 정책 v" +
        previous.shippingPolicy.version +
        " → v" +
        current.shippingPolicy.version,
    );
  if (previous.fare !== current.fare)
    changes.push(
      "배송비 " + money(previous.fare) + " → " + money(current.fare),
    );
  if (previous.discount !== current.discount)
    changes.push(
      "쿠폰 할인 " + money(previous.discount) + " → " + money(current.discount),
    );
  return changes;
}
const newId = () => "OM-" + crypto.randomUUID().slice(0, 8).toUpperCase();
export function Checkout({ db, update, direct }) {
  const [contact, setContact] = useState(
      db.member ? db.profile.phone || "" : "",
    ),
    [proof, setProof] = useState(""),
    [proofUntil, setProofUntil] = useState(0);
  useEffect(() => {
    if (!proofUntil) return;
    const id = setTimeout(
      () => {
        setProof("");
        setProofUntil(0);
        setReview(null);
        setAccepted(false);
      },
      Math.max(0, proofUntil - Date.now()),
    );
    return () => clearTimeout(id);
  }, [proofUntil]);
  const [delivery, setDelivery] = useState(() => ({
    name: "",
    phone: "",
    address: "",
    detail: "",
    ...(db.member ? db.profile : {}),
    zip: db.member ? db.profile.zip || db.profile.postcode || "" : "",
  }));
  const [method, setMethod] = useState("신용·체크카드"),
    [coupon, setCoupon] = useState(false),
    [review, setReview] = useState(null),
    [accepted, setAccepted] = useState(false),
    [delay, setDelay] = useState(false),
    [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [id, setId] = useState(newId);
  const lines = basketLines(
    db.products,
    (direct ? db.direct : db.cart) || {},
  ).filter((p) => direct || !(db.cartExcluded || []).includes(p.id));
  const eligible =
    couponAvailable(db) &&
    lines.reduce((s, p) => s + p.price * p.qty, 0) > 2000;
  const policy = shippingPolicy(db);
  const zone = zoneForAddress(db, delivery),
    discount = db.member && coupon && eligible ? 2000 : 0;
  const blocked = lines.filter((p) => p.active === false || p.qty > p.stock);
  let current, issue;
  try {
    current = quote(db, { lines, zone, discount });
  } catch (e) {
    issue = e.message;
  }
  if (!lines.length) return <Empty title="주문할 상품이 없습니다" />;
  if (!db.member && (!proof || proof !== contact || proofUntil <= Date.now()))
    return (
      <>
        <h1>주문 방법 선택</h1>
        <div className="split">
          <section className="panel">
            <h2>비회원 주문</h2>
            <p>
              주문 조회에 사용할 연락처를 먼저 확인합니다. 수취인의 전화번호는
              다음 단계에서 따로 입력합니다.
            </p>
            <label>
              주문 연락처
              <input
                type="tel"
                value={contact}
                onChange={(e) => {
                  setContact(e.target.value);
                  setProof("");
                }}
                placeholder="010-1234-5678"
              />
            </label>
            <GuestProof
              phone={contact}
              onVerified={() => {
                setProof(contact);
                setProofUntil(Date.now() + 15 * 60 * 1000);
              }}
            />
          </section>
          <aside className="summary">
            <h2>회원 주문</h2>
            <p>기본 배송지와 사용 가능한 쿠폰을 불러옵니다.</p>
            <a
              className="button primary"
              href={
                "#/access?return=" +
                encodeURIComponent(direct ? "/checkout/direct" : "/checkout")
              }
            >
              회원 로그인
            </a>
          </aside>
        </div>
      </>
    );
  function modify(patch) {
    setReview(null);
    setAccepted(false);
    setError("");
    setDelivery({ ...delivery, ...patch });
  }
  function reviewQuote(e) {
    e.preventDefault();
    if (!current || blocked.length) {
      setError(issue || "상품 조건이 변경되었습니다.");
      return;
    }
    setError("");
    setReview(current);
    setAccepted(false);
    setId(newId());
  }
  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (!db.member && (proof !== contact || proofUntil <= Date.now()))
        throw Error("주문 연락처를 다시 인증해 주세요.");
      if (
        !current ||
        !accepted ||
        blocked.length ||
        current.signature !== review.signature
      )
        throw new Error(
          "주문 조건이 변경되었습니다. 새 금액과 재고를 다시 확인해 주세요.",
        );
      const next = createOrder(db, {
        id,
        lines,
        zone,
        discount,
        signature: review.signature,
        member: db.member,
        ownerId: db.memberId,
        memberId: db.memberId,
        delivery,
        method,
        source: direct ? "direct" : "cart",
        receptionPending: delay,
        contact: db.member ? contact.trim() : proof,
      });
      await update({
        ...next,
        ...(!db.member
          ? { guestId: id, guestUntil: Date.now() + 15 * 60 * 1000 }
          : {}),
      });
      go("/orders/" + id + "/payment");
    } catch (e) {
      setError(e.message);
      setReview(null);
      setAccepted(false);
    } finally {
      setSubmitting(false);
    }
  }
  const canReview = !blocked.length && !!current && zone !== "blocked";
  const changed = review && review.signature !== current?.signature;
  return (
    <>
      <small>CHECKOUT</small>
      <h1>{review ? "주문 조건 확인" : "주문서"}</h1>
      {error && <p role="alert">{error}</p>}
      {blocked.length > 0 && (
        <section className="panel" role="alert">
          <h2>상품 조건이 변경되었습니다</h2>
          <p>
            {blocked.map((p) => p.name + " (" + p.option + ")").join(", ")}의
            수량을 조정해 주세요.
          </p>
          <a
            className="button"
            href={direct ? "#/products/" + blocked[0].id : "#/cart"}
          >
            상품·수량 수정
          </a>
        </section>
      )}
      {review ? (
        <section className="split">
          <div className="panel">
            <h2>주문할 상품</h2>
            <Lines lines={review.lines} />
            <h3>배송지</h3>
            <p>
              {delivery.name} · {delivery.phone}
              <br />
              {delivery.zip} {delivery.address} {delivery.detail}
            </p>
            <p>{method} · 국내 일반택배</p>
            <button
              onClick={() => {
                setReview(null);
                setAccepted(false);
              }}
            >
              입력 수정
            </button>
          </div>
          <Summary {...review}>
            {changed && (
              <div role="alert">
                <p>
                  견적이 변경되었습니다. 이전 합계 {money(review.total)} · 현재{" "}
                  {current ? money(current.total) : "구매 조건 재확인 필요"}
                </p>
                <ul>
                  {quoteChanges(review, current).map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              미성년자는 법정대리인의 동의가 없으면 계약을 취소할 수 있습니다.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              상품·수량·주소·결제 금액을 확인했습니다.
            </label>
            {changed ? (
              <button
                onClick={() => {
                  setReview(null);
                  setAccepted(false);
                }}
              >
                새 견적 확인하기
              </button>
            ) : (
              <button
                className="primary"
                disabled={submitting || !accepted || !canReview}
                onClick={submit}
              >
                {money(review.total)} 결제 인증
              </button>
            )}
            <details>
              <summary>주문 접수 상황 선택</summary>
              <label className="check">
                <input
                  type="checkbox"
                  checked={delay}
                  onChange={(e) => setDelay(e.target.checked)}
                />
                예약 응답 지연 체험
              </label>
            </details>
          </Summary>
        </section>
      ) : (
        <form onSubmit={reviewQuote} className="split checkout-form">
          <section className="panel">
            <h2>배송 정보</h2>
            {db.member && (
              <label>
                주문 연락처
                <input
                  type="tel"
                  required
                  pattern={"[0-9\\- ]{9,15}"}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </label>
            )}
            {!db.member && (
              <p>
                인증한 주문 연락처 {proof}{" "}
                <button type="button" onClick={() => setProof("")}>
                  연락처 변경
                </button>
              </p>
            )}
            <div className="actions">
              {Object.entries(addressSamples).map(([k, d]) => (
                <button type="button" key={k} onClick={() => modify(d)}>
                  {k === "배송제한" ? "제한 지역 예시" : k + " 주소 예시"}
                </button>
              ))}
            </div>
            {[
              ["name", "받는 분"],
              ["phone", "수취인 연락처"],
              ["zip", "우편번호"],
              ["address", "도로명 주소"],
              ["detail", "상세 주소 (선택)"],
            ].map(([k, label]) => (
              <label key={k}>
                {label}
                <input
                  required={k !== "detail"}
                  value={delivery[k] || ""}
                  onChange={(e) => modify({ [k]: e.target.value })}
                  type={k === "phone" ? "tel" : "text"}
                  pattern={
                    k === "phone"
                      ? "[0-9\\- ]{9,15}"
                      : k === "zip"
                        ? "[0-9]{5}"
                        : undefined
                  }
                  maxLength={k === "zip" ? 5 : 100}
                />
              </label>
            ))}
            {delivery.zip.length === 5 && zone === "blocked" && (
              <p role="alert">
                배송할 수 없는 주소입니다. 국내 배송지와 우편번호를 확인해
                주세요.
              </p>
            )}
            <label>
              결제 수단
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option>신용·체크카드</option>
                <option>간편결제</option>
              </select>
            </label>
            {db.member && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    disabled={!eligible}
                    checked={coupon && eligible}
                    onChange={(e) => setCoupon(e.target.checked)}
                  />
                  2,000원 정액 쿠폰 적용
                </label>
                {!eligible && (
                  <p>
                    사용 가능한 쿠폰이 있고 상품 합계가 2,000원을 초과할 때
                    적용할 수 있습니다.
                  </p>
                )}
              </>
            )}
            <button className="primary" disabled={!canReview}>
              주문 조건 확인
            </button>
          </section>
          <Summary
            lines={lines}
            fare={
              zone === "island"
                ? policy.islandFare
                : zone === "base"
                  ? policy.baseFare
                  : 0
            }
            discount={discount}
          >
            <Lines lines={lines} />
            <p>
              배송 정책 v{policy.version} · 출고 마감 {policy.cutoff}
            </p>
            <p>
              {zone === "blocked"
                ? "배송지 확인 후 운임을 확정합니다."
                : zone === "island"
                  ? "기본 " +
                    money(policy.baseFare) +
                    " + 도서산간 " +
                    money(policy.islandFare - policy.baseFare)
                  : "일반 지역 배송비 " + money(policy.baseFare)}
            </p>
          </Summary>
        </form>
      )}
    </>
  );
}
