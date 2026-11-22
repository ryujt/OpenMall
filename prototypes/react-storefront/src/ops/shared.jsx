import React from "react";

export const date = (time) =>
  time
    ? new Date(time).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "—";
export const now = () => new Date().toISOString();
export const sku = (p) => p.sku || p.id;
export const input = (form) => Object.fromEntries(new FormData(form));
export const ensure = (value, text) => {
  if (!value) throw Error(text);
};
export const statusName = {
  requested: "신청 접수",
  collecting: "회수 중",
  received: "판매자 입고",
  review: "입고 차이 확인",
  inspected: "검수 완료",
  refundPending: "환불 결과 확인 중",
  refunded: "환불 완료",
  waiting: "교환품 입고 대기",
  allocated: "교환품 확보",
  replacementTransit: "교환품 배송 중",
  replaced: "교환 완료",
  ready: "출고 대기",
  packed: "송장 등록",
  transit: "배송 중",
  delivered: "배송완료",
};
export function Field({ title, name, value = "", ...props }) {
  return (
    <label>
      {title}
      <input name={name} defaultValue={value} required {...props} />
    </label>
  );
}
export function Note({ title = "작업 사유", name = "note", value = "" }) {
  return (
    <label>
      {title}
      <textarea required name={name} defaultValue={value} rows="2" />
    </label>
  );
}
export const day = (time) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(time),
  );
