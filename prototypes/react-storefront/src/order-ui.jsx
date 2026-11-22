import React from "react";
import { money } from "./model";
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
export function Lines({ lines, children }) {
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
export function Summary({
  lines,
  fare = 0,
  discount = 0,
  children,
  title = "결제 명세",
}) {
  const subtotal = lines.reduce((sum, p) => sum + p.price * p.qty, 0);
  return (
    <aside className="summary">
      <h2>{title}</h2>
      {[
        ["상품 금액", subtotal],
        ["배송비", fare],
        ["쿠폰 할인", -discount],
      ].map(([k, v]) => (
        <p key={k}>
          {k}
          <b>{money(v)}</b>
        </p>
      ))}
      <hr />
      <p>
        합계<strong>{money(subtotal + fare - discount)}</strong>
      </p>
      {children}
    </aside>
  );
}
