import React, { useState } from "react";
import { initial, go } from "./model";
const routes = {
  catalog: "상품·재고",
  shipments: "출고 관리",
  claims: "고객상담·환불",
};
export function Admin({ page, db, update }) {
  const [message, setMessage] = useState("");
  function apply(o, changes, restock = false) {
    update({
      ...db,
      orders: db.orders.map((item) =>
        item.id === o.id ? { ...o, ...changes } : item,
      ),
      products: restock
        ? db.products.map((p) => ({
            ...p,
            stock: p.stock + (o.lines.find((l) => l.id === p.id)?.qty || 0),
          }))
        : db.products,
    });
    setMessage(o.id + " · " + changes.stage);
  }
  const shipping = page === "shipments";
  const orders = db.orders.filter((o) =>
    shipping
      ? ["결제완료", "배송 중"].includes(o.stage)
      : o.stage.endsWith(" 접수"),
  );
  return (
    <>
      <small>STORE MANAGEMENT</small>
      <h1>운영 체험</h1>
      <div className="tabs">
        {Object.entries(routes).map(([r, s]) => (
          <a
            key={r}
            aria-current={page === r ? "page" : undefined}
            href={"#/admin/" + r}
          >
            {s}
          </a>
        ))}
      </div>
      <p role="status">{message}</p>
      {page === "catalog" ? (
        db.products.map((p) => (
          <form
            className="adminrow"
            key={p.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.target);
              update({
                ...db,
                products: db.products.map((item) =>
                  item.id === p.id
                    ? {
                        ...p,
                        stock: Number(f.get("stock")),
                        price: Number(f.get("price")),
                      }
                    : item,
                ),
              });
              setMessage(p.name + " 저장 완료");
            }}
          >
            <h3>{p.name}</h3>
            <label>
              판매가
              <input
                name="price"
                type="number"
                min="1"
                max="99999999"
                defaultValue={p.price}
                required
              />
            </label>
            <label>
              재고
              <input
                name="stock"
                type="number"
                min="0"
                max="9999"
                defaultValue={p.stock}
                required
              />
            </label>
            <button>저장</button>
          </form>
        ))
      ) : orders.length ? (
        orders.map((o) => (
          <form
            key={o.id}
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              if (o.stage === "결제완료")
                apply(o, {
                  stage: "배송 중",
                  tracking: new FormData(e.target).get("tracking"),
                });
              else if (o.stage === "배송 중") apply(o, { stage: "배송완료" });
              else if (o.stage === "교환 접수")
                apply(o, {
                  stage: "교환품 발송",
                  tracking: new FormData(e.target).get("tracking"),
                });
              else apply(o, { stage: "환불 완료" }, true);
            }}
          >
            <small>
              {o.id} · {o.stage}
            </small>
            <h3>{o.lines.map((p) => p.name + " × " + p.qty).join(", ")}</h3>
            <p>{o.reason || o.delivery.address}</p>
            {["결제완료", "교환 접수"].includes(o.stage) && (
              <label>
                운송장 번호
                <input
                  name="tracking"
                  required
                  pattern="[0-9]{8,16}"
                  title="숫자 8~16자리"
                />
              </label>
            )}
            <button className="primary">
              {{
                결제완료: "출고 확정",
                "배송 중": "배송완료 처리",
                "교환 접수": "교환품 발송",
              }[o.stage] || "환불 확정"}
            </button>
          </form>
        ))
      ) : (
        <div className="empty">
          <h3>처리할 주문이 없습니다</h3>
        </div>
      )}
      <details className="review-tools">
        <summary>체험 데이터 관리</summary>
        <p>장바구니, 주문과 운영 변경을 지우고 처음 상태로 돌아갑니다.</p>
        <button
          onClick={() => {
            if (
              window.confirm(
                "이 브라우저의 OpenMall 체험 데이터를 초기화할까요?",
              )
            ) {
              update(initial());
              go("/");
            }
          }}
        >
          체험 데이터 초기화
        </button>
      </details>
    </>
  );
}
