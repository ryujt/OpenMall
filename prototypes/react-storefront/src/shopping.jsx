import React, { useState } from "react";
import { go, money, demo, basketLines } from "./model";
export function Empty({ title }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <a className="button" href="#/">
        쇼핑 계속하기
      </a>
    </div>
  );
}
function Lines({ lines, children }) {
  return lines.map((p) => (
    <div className="line" key={p.id}>
      <img src={"/images/" + p.photo + ".webp"} alt="" />
      <div>
        <strong>{p.name}</strong>
        <p>
          {p.option} · {p.qty}개
        </p>
        {children?.(p)}
      </div>
      <b>{money(p.qty * p.price)}</b>
    </div>
  ));
}
function Summary({ lines, fare, discount = 0, children }) {
  const amount = lines.reduce((s, p) => s + p.price * p.qty, 0);
  return (
    <aside className="summary">
      <h2>결제 명세</h2>
      {[
        ["상품 금액", amount],
        ["배송비", fare],
        ["쿠폰 할인", -discount],
      ].map(([s, n]) => (
        <p key={s}>
          {s}
          <b>{money(n)}</b>
        </p>
      ))}
      <hr />
      <p>
        결제 금액<strong>{money(amount + fare - discount)}</strong>
      </p>
      {children}
    </aside>
  );
}
export function Cart({ db, update }) {
  const lines = basketLines(db.products, db.cart);
  function change(id, n) {
    const cart = { ...db.cart };
    if (n) cart[id] = n;
    else delete cart[id];
    update({ ...db, cart });
  }
  return (
    <>
      <h1>장바구니</h1>
      {!lines.length ? (
        <Empty title="담은 상품이 없습니다" />
      ) : (
        <div className="split">
          <div>
            <Lines lines={lines}>
              {(p) => (
                <div className="qty">
                  <button
                    aria-label="수량 줄이기"
                    disabled={p.qty <= 1}
                    onClick={() => change(p.id, p.qty - 1)}
                  >
                    −
                  </button>
                  <span>{p.qty}</span>
                  <button
                    aria-label="수량 늘리기"
                    disabled={p.qty >= p.stock}
                    onClick={() => change(p.id, p.qty + 1)}
                  >
                    +
                  </button>
                  <button onClick={() => change(p.id, 0)}>삭제</button>
                </div>
              )}
            </Lines>
          </div>
          <Summary lines={lines} fare={3000}>
            <a className="button primary" href="#/checkout">
              주문하기
            </a>
          </Summary>
        </div>
      )}
    </>
  );
}
export function AddressFields({ profile = {} }) {
  return (
    <>
      {[
        ["name", "받는 분"],
        ["phone", "연락처"],
        ["address", "배송지 주소"],
      ].map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            name={key}
            type={key === "phone" ? "tel" : "text"}
            pattern={key === "phone" ? "[0-9\\- ]{9,15}" : ".*\\S.*"}
            defaultValue={profile[key]}
            required
          />
        </label>
      ))}
    </>
  );
}
export function Checkout({ db, update, direct }) {
  const lines = basketLines(db.products, (direct ? db.direct : db.cart) || {});
  const [fare, setFare] = useState(3000),
    [coupon, setCoupon] = useState(false),
    [guest, setGuest] = useState(false);
  if (!lines.length) return <Empty title="주문할 상품이 없습니다" />;
  if (!db.member && !guest)
    return (
      <div className="formbox">
        <small>CHECKOUT</small>
        <h1>주문 방법 선택</h1>
        <p>회원은 기본 배송지와 쿠폰을 사용할 수 있습니다.</p>
        <button
          className="primary"
          onClick={() => {
            update({ ...db, member: true });
          }}
        >
          체험 회원으로 계속
        </button>
        <button onClick={() => setGuest(true)}>비회원으로 계속</button>
      </div>
    );
  const valid = lines.every((p) => p.qty <= p.stock);
  function pay(e) {
    e.preventDefault();
    if (!valid) return;
    const f = Object.fromEntries(new FormData(e.target));
    const order = {
      id: "OM-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
      date: new Date().toISOString(),
      member: db.member,
      lines,
      fare,
      discount: coupon ? 2000 : 0,
      method: f.method,
      delivery: { name: f.name, address: f.address, phone: f.phone },
      stage: "결제완료",
    };
    update({
      ...db,
      orders: [order, ...db.orders],
      products: db.products.map((p) => ({
        ...p,
        stock: p.stock - (lines.find((l) => l.id === p.id)?.qty || 0),
      })),
      cart: direct ? db.cart : {},
      direct: null,
      guestId: db.member ? db.guestId : order.id,
    });
    go("/orders/" + order.id);
  }
  return (
    <>
      <h1>주문서</h1>
      <form onSubmit={pay} className="split">
        <section className="panel">
          <h2>배송 정보</h2>
          <AddressFields profile={db.member ? db.profile : demo} />
          <label>
            배송 지역
            <select onChange={(e) => setFare(+e.target.value)}>
              <option value="3000">일반 지역</option>
              <option value="6000">도서산간</option>
            </select>
          </label>
          {db.member && (
            <label className="check">
              <input
                type="checkbox"
                checked={coupon}
                onChange={(e) => setCoupon(e.target.checked)}
              />
              2,000원 쿠폰 적용
            </label>
          )}
          <label>
            결제 수단
            <select name="method">
              <option>카드</option>
              <option>간편결제</option>
            </select>
          </label>
          <Lines lines={lines} />
        </section>
        <Summary lines={lines} fare={fare} discount={coupon ? 2000 : 0}>
          <p>가상 결제로 주문을 완료합니다.</p>
          <button disabled={!valid} className="primary">
            {valid ? "결제하기" : "재고 부족"}
          </button>
          {!valid && <a href="#/cart">장바구니로 이동</a>}
        </Summary>
      </form>
    </>
  );
}
export function Access({ db, update, target }) {
  const [error, setError] = useState("");
  function lookup(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const o = db.orders.find(
      (o) =>
        !o.member &&
        o.id === f.get("id").trim() &&
        o.delivery.phone === f.get("phone"),
    );
    if (!o) {
      setError("주문번호와 연락처를 확인해 주세요.");
      return;
    }
    update({ ...db, guestId: o.id });
    go("/orders/" + o.id);
  }
  return (
    <div className="formbox">
      <small>MY OPENMALL</small>
      <h1>계정</h1>
      <p>김서윤 회원으로 쇼핑을 체험합니다.</p>
      <button
        className="primary"
        onClick={() => {
          update({ ...db, member: true });
          go(target || "/my/account");
        }}
      >
        체험 회원 로그인
      </button>
      <hr />
      <h2>비회원 주문 조회</h2>
      <form onSubmit={lookup}>
        <label>
          주문번호
          <input name="id" required />
        </label>
        <label>
          주문 연락처
          <input name="phone" required />
        </label>
        <button>주문 조회</button>
        <p role="status">{error}</p>
      </form>
    </div>
  );
}
export function Account({ db, update }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="formbox">
      <small>MY OPENMALL</small>
      <h1>회원 정보</h1>
      <h2>기본 배송지</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({
            ...db,
            profile: Object.fromEntries(new FormData(e.target)),
          });
          setMsg("배송지를 저장했습니다.");
        }}
      >
        <AddressFields profile={db.profile} />
        <button className="primary">배송지 저장</button>
        <p role="status">{msg}</p>
      </form>
      <hr />
      <a href="#/my/orders">내 주문 보기 →</a>
      <button
        onClick={() => {
          update({ ...db, member: false, guestId: null });
          go("/");
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
export function Orders({ db }) {
  const orders = db.orders.filter((o) => o.member);
  return (
    <>
      <h1>내 주문</h1>
      {orders.length ? (
        orders.map((o) => (
          <a key={o.id} className="orderlink" href={"#/orders/" + o.id}>
            <small>{o.id}</small>
            <h3>{o.lines.map((p) => p.name).join(", ")}</h3>
            <span>{o.stage} →</span>
          </a>
        ))
      ) : (
        <Empty title="아직 주문이 없습니다" />
      )}
    </>
  );
}
export function Order({ o, claim, updateOrder }) {
  const [reason, setReason] = useState("단순변심"),
    [kind, setKind] = useState("반품");
  const eligible = ["결제완료", "배송완료"].includes(o.stage);
  if (claim && eligible)
    return (
      <div className="formbox">
        <small>{o.id}</small>
        <h1>{o.stage === "결제완료" ? "주문 취소" : "반품·교환"} 신청</h1>
        <p>주문에 포함된 전체 상품을 신청합니다.</p>
        <Lines lines={o.lines} />
        {o.stage === "배송완료" && (
          <label>
            신청 유형
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option>반품</option>
              <option>교환</option>
            </select>
          </label>
        )}
        <label>
          신청 사유
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>단순변심</option>
            <option>상품 이상</option>
          </select>
        </label>
        <div className="actions">
          <button onClick={() => go("/orders/" + o.id)}>돌아가기</button>
          <button
            className="primary"
            onClick={() => {
              updateOrder({
                ...o,
                stage: (o.stage === "결제완료" ? "취소" : kind) + " 접수",
                reason,
              });
              go("/orders/" + o.id);
            }}
          >
            신청 확정
          </button>
        </div>
      </div>
    );
  return (
    <>
      <small>ORDER DETAILS</small>
      <h1>주문 상세</h1>
      <div className="split">
        <div className="panel">
          <small>
            {o.id} · {new Date(o.date).toLocaleDateString("ko-KR")}
          </small>
          <h2>{o.stage}</h2>
          <Lines lines={o.lines} />
          <h3>배송 정보</h3>
          <p>
            {o.delivery.name} · {o.delivery.phone}
            <br />
            {o.delivery.address}
          </p>
          {o.tracking && <p>운송장 {o.tracking}</p>}
          {o.reason && <p>신청 사유 · {o.reason}</p>}
          {eligible && (
            <a className="button" href={"#/orders/" + o.id + "/claim"}>
              {o.stage === "결제완료" ? "주문 취소 신청" : "반품·교환 신청"}
            </a>
          )}
        </div>
        <Summary lines={o.lines} fare={o.fare} discount={o.discount}>
          <p>{o.method} 결제</p>
        </Summary>
      </div>
    </>
  );
}
