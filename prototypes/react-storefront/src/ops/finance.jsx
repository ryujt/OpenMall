import React, { useState } from "react";
import { input, date, now, ensure, Field, Note, day } from "./shared";
import { money } from "../model";
import { expireReservation, paymentNotice } from "../commerce";

export function Settlement({ db, run }) {
  const [businessDay, setBusinessDay] = useState(day(db.clock || Date.now()));
  const txs = db.orders.flatMap((o) => {
    const list = [];
    if (o.paidAt)
      list.push({
        key: o.paymentId || o.id,
        order: o.id,
        at: o.paidAt,
        amount: o.total,
      });
    for (const c of o.claims || []) {
      if (c.pgConfirmedAt || c.status === "refunded")
        list.push({
          key: c.refundId || c.id,
          order: o.id,
          at: c.pgConfirmedAt || c.refundedAt || c.history.at(-1)?.at,
          amount: -c.amount,
        });
    }
    return list.filter((r) => r.at && day(r.at) === businessDay);
  });
  const gross = txs.reduce((n, e) => n + e.amount, 0);
  function compare(e) {
    e.preventDefault();
    const f = input(e.currentTarget),
      key = businessDay + "/" + f.settledOn;
    run("finance", "정산 명세 대조", key, f.note, (d) => {
      const fee = Number(f.fee),
        paid = Number(f.paid),
        expected = gross - fee,
        old = d.settlements?.[key];
      const report = {
        fee,
        paid,
        expected,
        delta: paid - expected,
        original: old?.original ?? paid,
        note: f.note,
        at: now(),
        day: businessDay,
        settledOn: f.settledOn,
      };
      return { ...d, settlements: { ...d.settlements, [key]: report } };
    });
  }
  return (
    <details className="ops-box">
      <summary>거래일별 승인·취소와 지급 정산</summary>
      <label>
        거래 기준일
        <input
          type="date"
          value={businessDay}
          onChange={(e) => setBusinessDay(e.target.value)}
        />
      </label>
      <ul>
        {txs.map((row) => (
          <li key={row.key}>
            {row.order} · {row.key} · {money(row.amount)}
          </li>
        ))}
      </ul>
      <p>승인 및 취소 순액 {money(gross)}</p>
      <form onSubmit={compare}>
        <div className="ops-grid">
          <Field
            title="정산일"
            name="settledOn"
            type="date"
            value={businessDay}
          />
          <Field
            title="수수료(원)"
            type="number"
            min="0"
            name="fee"
            value="0"
          />
          <Field
            title="PG 지급 명세액(원)"
            type="number"
            name="paid"
            value={gross}
          />
        </div>
        <Note title="원명세 또는 정정 근거" />
        <button>지급 차이 대조</button>
      </form>
      {Object.entries(db.settlements || {}).map(([key, r]) => (
        <p key={key}>
          {r.day} 거래 · {r.settledOn} 지급 ·{" "}
          {r.delta ? "조사 중" : "대사 일치"} · 최초 명세 {money(r.original)} /
          현재 {money(r.paid)} / 예상 {money(r.expected)} / 차이{" "}
          {money(r.delta)}
        </p>
      ))}
    </details>
  );
}
export function Exceptions({ db, role, run }) {
  const asOf = db.clock || Date.now();
  return (
    <section className="ops-box">
      <h3>운영 예외 목록</h3>
      {!db.orders.length && <p>대조할 주문이 없습니다.</p>}
      {db.orders.map((o) => {
        const age = Math.max(
          0,
          Math.floor((new Date(asOf) - new Date(o.date)) / 60000),
        );
        const pending = ["pending", "ready", "compensating"].includes(
          o.payment,
        );
        const delayed =
          o.payment === "paid" &&
          ["ready", "packed"].includes(o.shipment?.status) &&
          o.supplyDueAt &&
          day(asOf) >= o.supplyDueAt;
        return (
          <React.Fragment key={o.id}>
            {role === "finance" && pending && (
              <form
                className="ops-inset"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = input(e.currentTarget);
                  run(role, "PG 원거래 대사", o.id, f.note, (d) => {
                    const current = d.orders.find((x) => x.id === o.id);
                    ensure(
                      current.payment === o.payment,
                      "결제 상태가 바뀌었습니다. 원거래를 다시 대조하세요.",
                    );
                    return paymentNotice(d, o.id, {
                      verified: f.verified === "yes",
                      orderId: f.pgOrder,
                      paymentId: f.reference,
                      amount: Number(f.amount),
                      outcome: f.outcome,
                    });
                  });
                }}
              >
                <h4>
                  {o.discrepancy
                    ? "PG 대사 차이"
                    : o.payment === "compensating"
                      ? "이행 불가 승인 전액 취소"
                      : o.payment === "ready"
                        ? "미결제 재고 예약"
                        : "승인 결과 확인 중"}{" "}
                  · {o.id}
                </h4>
                <p>
                  재무 담당 · 경과 {age}분 · 내부 거래 {o.paymentId} ·{" "}
                  {money(o.total)}
                </p>
                {o.pgComparison && (
                  <p>
                    대사 차이 · 내부 {money(o.pgComparison.expected)} / PG{" "}
                    {money(o.pgComparison.reported)} · 거래{" "}
                    {o.pgComparison.reference}
                  </p>
                )}
                <div className="ops-grid">
                  <Field title="PG 주문번호" name="pgOrder" value={o.id} />
                  <label>
                    시험 PG 발신 검증
                    <select name="verified">
                      <option value="yes">검증 통과</option>
                      <option value="no">검증 실패</option>
                    </select>
                  </label>
                  <Field
                    title="PG 원거래 번호"
                    name="reference"
                    value={o.paymentId}
                  />
                  <Field
                    title="PG 거래 금액(원)"
                    name="amount"
                    type="number"
                    min="0"
                    value={o.total}
                  />
                </div>
                <label>
                  원거래 확인 결과
                  <select name="outcome">
                    {(o.payment === "compensating"
                      ? [["compensated", "전액 취소 확인"]]
                      : [
                          ["pending", "아직 미확정"],
                          ["approved", "승인 일치"],
                          ["failed", "승인 거절 확정"],
                          ["unfulfillable", "승인 후 공급 불가"],
                        ]
                    ).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <Note title="대조 근거" />
                <button>원거래 결과 반영</button>
              </form>
            )}
            {role === "finance" &&
              ((["ready", "pending"].includes(o.payment) &&
                o.reservationExpiresAt) ||
                (o.release && (!o.release.stock || !o.release.coupon))) && (
                <details className="ops-inset">
                  <summary>예약 만료·해제 확인 · {o.id}</summary>
                  <p>
                    예약 만료 시각 {date(o.reservationExpiresAt)} · 재고{" "}
                    {o.release?.stock ? "해제" : "확보 중"} · 쿠폰{" "}
                    {o.discount
                      ? o.release?.coupon
                        ? "해제"
                        : "확보 중"
                      : "미적용"}
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = input(e.currentTarget);
                      run(
                        role,
                        "만료 예약 해제 대사",
                        o.id,
                        "PG 승인 가능성 종료 확인",
                        (d) =>
                          expireReservation(d, o.id, {
                            pgClosed: !!f.closed,
                            stopAfter: f.stopAfter,
                          }),
                      );
                    }}
                  >
                    <label className="ops-check">
                      <input type="checkbox" name="closed" />
                      원거래의 승인 가능성 종료를 확인했습니다.
                    </label>
                    <label>
                      시험 작업 범위
                      <select name="stopAfter">
                        <option value="">남은 작업 완료</option>
                        <option value="order">만료 주문까지</option>
                        <option value="stock">재고 해제까지</option>
                      </select>
                    </label>
                    <button>해제 작업 실행·재개</button>
                  </form>
                </details>
              )}
            {delayed && (
              <p>
                물류 담당 · 공급 조치 기한 {o.supplyDueAt} · {o.id} · 미인계{" "}
                {Math.floor(age / 60)}
                시간
              </p>
            )}
            {(o.claims || [])
              .filter(
                (c) => c.dueAt && !["refunded", "replaced"].includes(c.status),
              )
              .map((c) => (
                <p key={c.id}>
                  상담·재무 담당 ·{" "}
                  {day(asOf) > c.dueAt
                    ? "환급기한 초과 · 지연배상 검토"
                    : day(asOf) === c.dueAt
                      ? "오늘 환급기한"
                      : "환급 대기"}{" "}
                  · {c.id} · {c.dueAt}
                </p>
              ))}
          </React.Fragment>
        );
      })}
    </section>
  );
}
