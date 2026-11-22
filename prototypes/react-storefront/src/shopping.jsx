import React, { useState } from "react";
import { shippingPolicy } from "./delivery-policy";
import { money, basketLines, go } from "./model";
import { Empty, Lines, Summary } from "./order-ui";
export { Empty } from "./order-ui";
export { Checkout } from "./checkout";
export { Order } from "./order";

export function Cart({ db, update }) {
  const lines = basketLines(db.products, db.cart);
  const [edit, setEdit] = useState(null),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  const selected = lines.filter((p) => !(db.cartExcluded || []).includes(p.id));
  const blocked = (p) => p.active === false || p.stock < p.qty;
  const changed = (p) =>
    db.cartPrices?.[p.id] != null && db.cartPrices[p.id] !== p.price;
  async function save(data) {
    try {
      await update(data);
      setError("");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  async function quantity(p) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > p.stock) {
      setError(
        "수량은 1개부터 현재 재고 " + p.stock + "개까지 정수로 입력해 주세요.",
      );
      return;
    }
    if (await save({ ...db, cart: { ...db.cart, [p.id]: n } })) setEdit(null);
  }
  function remove(id) {
    const cart = { ...db.cart };
    delete cart[id];
    save({
      ...db,
      cart,
      cartExcluded: (db.cartExcluded || []).filter((v) => v !== id),
    });
  }
  return (
    <>
      <h1>장바구니</h1>
      {lines.length ? (
        <div className="split">
          <section aria-label="담은 상품">
            <Lines lines={lines}>
              {(p) => (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={p.name + " 주문 선택"}
                      checked={selected.some((v) => v.id === p.id)}
                      onChange={(e) =>
                        save({
                          ...db,
                          cartExcluded: e.target.checked
                            ? (db.cartExcluded || []).filter(
                                (id) => id !== p.id,
                              )
                            : [...(db.cartExcluded || []), p.id],
                        })
                      }
                    />
                    주문 선택
                  </label>
                  {blocked(p) && (
                    <p role="status">
                      판매 조건이 변경되었습니다. 현재 구매 가능 수량{" "}
                      {p.active === false ? 0 : p.stock}개
                    </p>
                  )}
                  {changed(p) && (
                    <p>
                      담을 때 {money(db.cartPrices[p.id])} → 현재{" "}
                      {money(p.price)}
                    </p>
                  )}
                  {edit === p.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        quantity(p);
                      }}
                    >
                      <label>
                        수량
                        <input
                          type="number"
                          min="1"
                          max={p.stock}
                          step="1"
                          required
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                        />
                      </label>
                      <div className="actions">
                        <button>적용</button>
                        <button type="button" onClick={() => setEdit(null)}>
                          닫기
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="qty">
                      <button
                        disabled={!p.stock || p.active === false}
                        onClick={() => {
                          setEdit(p.id);
                          setValue(String(p.qty));
                        }}
                      >
                        수량 변경
                      </button>
                      <button onClick={() => remove(p.id)}>삭제</button>
                      <a href={"#/products/" + p.id}>옵션 확인</a>
                    </div>
                  )}
                </>
              )}
            </Lines>
            {error && <p role="alert">{error}</p>}
          </section>
          <Summary
            lines={selected}
            fare={selected.length ? shippingPolicy(db).baseFare : 0}
            title="주문 예상액"
          >
            <p>
              일반 지역 배송비 기준입니다. 도서산간 추가 운임은 배송지 입력 후
              확인할 수 있습니다.
            </p>
            <button
              className="primary"
              disabled={!selected.length || selected.some(blocked)}
              onClick={() => go("/checkout")}
            >
              선택 상품 주문하기
            </button>
          </Summary>
        </div>
      ) : (
        <Empty title="장바구니가 비었습니다" />
      )}
    </>
  );
}
export function Orders({ db }) {
  const [stage, setStage] = useState(""),
    [month, setMonth] = useState("");
  const all = db.orders.filter(
    (o) => o.member && (o.memberId || o.ownerId || "demo") === db.memberId,
  );
  const visible = all.filter(
    (o) =>
      (!stage || o.stage === stage) && (!month || o.date.slice(0, 7) === month),
  );
  return (
    <>
      <h1>내 주문</h1>
      <div className="split">
        <section>
          {all.length > 0 && (
            <div className="actions">
              <label>
                주문 월
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
              <label>
                주문 상태
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  <option value="">전체 상태</option>
                  {[...new Set(all.map((o) => o.stage))].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              {(month || stage) && (
                <button
                  onClick={() => {
                    setStage("");
                    setMonth("");
                  }}
                >
                  조건 초기화
                </button>
              )}
            </div>
          )}
          {visible.length ? (
            visible.map((o) => (
              <a key={o.id} className="orderlink" href={"#/orders/" + o.id}>
                <small>
                  {o.date.slice(0, 10)} · {o.id}
                </small>
                <h3>
                  {o.lines[0]?.name}
                  {o.lines.length > 1
                    ? " 외 " + (o.lines.length - 1) + "종"
                    : ""}
                </h3>
                <p>
                  {o.lines.reduce((s, p) => s + p.qty, 0)}개 · {o.stage}
                </p>
                <strong>주문 상세 →</strong>
              </a>
            ))
          ) : (
            <Empty title="표시할 주문이 없습니다" />
          )}
        </section>
        <aside className="summary">
          <h2>비회원 주문 조회</h2>
          <p>
            비회원 주문은 주문번호와 주문 당시의 연락처로 한 건씩 확인할 수
            있습니다.
          </p>
          <a className="button" href="#/access?mode=guest">
            비회원 주문 조회
          </a>
        </aside>
      </div>
    </>
  );
}
