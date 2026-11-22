import React, { useState } from "react";
import {
  createOrder,
  quote,
  openClaim,
  payOrder,
  shipOrder,
  claimAction,
  paymentNotice,
} from "./commerce";
import { money } from "./model";
const runId = "O-R";
const recoveryTrade = {
  orderId: "O-R",
  paymentId: "PAY-O-R",
  amount: 18000,
  verified: true,
  outcome: "approved",
};
const handoverSlip = { tracking: "W-R", lines: [{ id: "A", qty: 1 }] };
const trainingLabels = {
  recovery: "백업 복원과 원거래 대조",
  rounding: "부분 취소 순서와 원 단위 배분",
  payment: "PG 통지와 중복 승인",
  reconcile: "일별 승인·취소 원장 대사",
};
function seed(kind) {
  const rounding = kind === "rounding",
    prices = rounding ? [10001, 10001, 10001] : [15000];
  const db = {
    clock: "2026-11-22T09:00:00+09:00",
    member: true,
    memberId: "training",
    cart: {},
    orders: [],
    products: prices.map((price, i) => ({
      id: "ABC"[i],
      name: "품목 " + "ABC"[i],
      price,
      stock: 1,
    })),
  };
  const input = {
    id: runId,
    lines: db.products.map((p) => ({ id: p.id, qty: 1 })),
    member: true,
    ownerId: db.memberId,
    discount: rounding ? 1000 : 0,
    zone: "base",
    delivery: {
      name: "가상 수취인",
      address: "시험 배송지",
      phone: "010-0000-0000",
    },
    method: "카드",
  };
  const backup = createOrder(db, {
    ...input,
    signature: quote(db, input).signature,
  });
  return {
    backup,
    db: rounding ? payOrder(backup, runId, "approved") : backup,
    restored: false,
    reconciled: false,
    warehouse: "unknown",
    log: [],
    ledger: {},
  };
}
const pgSource = [
  { id: "A-01", day: "11-21", kind: "승인", amount: 48000 },
  { id: "A-02", day: "11-22", kind: "승인", amount: 18000 },
  { id: "A-03", day: "11-22", kind: "승인", amount: 25000 },
  { id: "C-01", day: "11-22", kind: "취소", original: "A-01", amount: 18000 },
];
function Run({ kind }) {
  const [state, set] = useState(() => seed(kind)),
    [error, setError] = useState("");
  const { db, log, warehouse, ledger } = state,
    o = db.orders[0];
  function act(label, fn) {
    try {
      const change = fn();
      set({
        ...state,
        ...change,
        log: [...log, { label, at: new Date().toLocaleTimeString("ko-KR") }],
      });
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  function evidence(verified = true, orderId = runId) {
    return {
      verified,
      orderId,
      paymentId: o.paymentId,
      amount: o.total,
      outcome: "approved",
    };
  }
  function reconcile() {
    if (warehouse === "unknown")
      throw Error(
        "창고 인수표 조회 대기 중입니다. 출고와 추가 청구를 보류합니다.",
      );
    let matched = paymentNotice(db, runId, recoveryTrade);
    if (matched.orders[0].payment !== "paid")
      throw Error("PG 원거래와 복원한 주문이 일치하지 않아 보류합니다.");
    if (warehouse === "handed") {
      matched = shipOrder(matched, runId, "pack", handoverSlip);
      matched = shipOrder(matched, runId, "handoff", {
        lines: handoverSlip.lines,
      });
    }
    return { db: matched, reconciled: true };
  }
  const entries = Object.values(ledger),
    daily = entries.filter((r) => r.day === "11-22");
  return (
    <div className="split">
      <section className="panel">
        <h2>{trainingLabels[kind]}</h2>
        {kind === "recovery" && (
          <>
            <p>
              주문 O-R에 마지막 상품 1개를 예약한 시점으로 복원합니다. 복원 뒤
              PG에는 18,000원 승인이 한 건 있습니다. 창고 인수표는 별도로
              확인해야 합니다.
            </p>
            <button
              disabled={state.restored}
              onClick={() =>
                act("승인 직전 백업 복원 · 출고 잠금", () => ({
                  db: structuredClone(state.backup),
                  restored: true,
                }))
              }
            >
              백업 복원
            </button>
            {state.restored && (
              <>
                <label>
                  독립 창고 증빙
                  <select
                    value={warehouse}
                    disabled={state.reconciled}
                    onChange={(e) =>
                      set({ ...state, warehouse: e.target.value })
                    }
                  >
                    <option value="unknown">조회 불가</option>
                    <option value="none">인계 기록 0건</option>
                    <option value="handed">운송장 W-R · 이미 1개 인계</option>
                  </select>
                </label>
                <button
                  disabled={state.reconciled}
                  onClick={() => act("PG 원거래와 창고 증빙 대조", reconcile)}
                >
                  원거래·인수표 대조
                </button>
              </>
            )}
            {state.reconciled && warehouse === "none" && (
              <button
                disabled={o.shipment.status === "transit"}
                onClick={() =>
                  act("대조 후 최초 인계", () => ({
                    db: shipOrder(
                      shipOrder(db, runId, "pack", { tracking: "W-R" }),
                      runId,
                      "handoff",
                    ),
                  }))
                }
              >
                포장 및 1개 인계
              </button>
            )}
          </>
        )}
        {kind === "rounding" && (
          <>
            <p>
              각 10,001원인 세 품목에 쿠폰 1,000원과 배송비 3,000원을
              적용했습니다. 서로 다른 순서로 취소해 같은 최종 잔액을 확인하세요.
            </p>
            <div className="actions">
              {o.lines.map((l) => (
                <button
                  key={l.id}
                  onClick={() =>
                    act(l.name + " 취소 · 원거래 대사", () => {
                      const id = "C-" + l.id;
                      let next = openClaim(db, runId, {
                        id,
                        lineId: l.id,
                        qty: 1,
                        kind: "cancel",
                        reason: "단순 변심",
                      });
                      next = claimAction(next, runId, id, "refund");
                      return { db: claimAction(next, runId, id, "reconcile") };
                    })
                  }
                >
                  {l.name} 취소
                </button>
              ))}
            </div>
            {o.lines.map((l) => (
              <p key={l.id}>
                {l.name} · 할인 {money(l.unitDiscounts[0])} · 확정 환불{" "}
                {money(o.claims.find((c) => c.lineId === l.id)?.amount || 0)}
              </p>
            ))}
          </>
        )}
        {kind === "payment" && (
          <>
            <p>
              PG 발신 검증과 원주문·거래 귀속을 대조합니다. 정상 통지를 여러 번
              보내도 주문 한 건에 승인이 한 번만 반영되어야 합니다.
            </p>
            <div className="actions">
              {[
                ["발신 검증 실패", false, runId],
                ["타 주문의 같은 금액", true, "O-B"],
                ["정상 원거래 통지", true, runId],
              ].map(([label, valid, id]) => (
                <button
                  key={label}
                  onClick={() =>
                    act(label, () => ({
                      db: paymentNotice(db, runId, evidence(valid, id)),
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <ol>
              {o.history.map((h, i) => (
                <li key={i}>{h.label}</li>
              ))}
            </ol>
          </>
        )}
        {kind === "reconcile" && (
          <>
            <p>
              전날 승인 거래와 오늘 승인 2건·부분 취소 1건을 거래 ID로
              대조합니다. 작업을 중단하고 같은 기간을 다시 읽을 수 있습니다.
            </p>
            <div className="actions">
              {[
                ["첫 승인까지 처리", pgSource.slice(0, 2)],
                ["전체 기간 재대사", pgSource],
              ].map(([label, batch]) => (
                <button
                  key={label}
                  onClick={() =>
                    act(label, () => ({
                      ledger: {
                        ...ledger,
                        ...Object.fromEntries(batch.map((r) => [r.id, r])),
                      },
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {entries.map((r) => (
              <p key={r.id}>
                {r.day} · {r.id} · {r.kind} {money(r.amount)}{" "}
                {r.original && " / 원승인 " + r.original}
              </p>
            ))}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <hr />
        <button
          onClick={() => {
            set(seed(kind));
            setError("");
          }}
        >
          이 사례 다시 시작
        </button>
      </section>
      <aside className="summary">
        <h2>대조 결과</h2>
        {(kind === "reconcile"
          ? [
              [
                "당일 승인",
                money(
                  daily
                    .filter((r) => r.kind === "승인")
                    .reduce((s, r) => s + r.amount, 0),
                ),
              ],
              [
                "당일 취소",
                money(
                  daily
                    .filter((r) => r.kind === "취소")
                    .reduce((s, r) => s + r.amount, 0),
                ),
              ],
              ["저장한 거래", entries.length + "건"],
            ]
          : [
              ["주문번호", o.id],
              ["주문 상태", o.stage],
              ["주문 금액", money(o.total)],
              ["확정 환불", money(o.refunded)],
              [
                "승인 잔액",
                money(o.payment === "paid" ? o.total - o.refunded : 0),
              ],
              ["택배 인계", o.shipment.status === "transit" ? "1개" : "0개"],
            ]
        ).map(([label, value]) => (
          <p key={label}>
            {label}
            <b>{value}</b>
          </p>
        ))}
        <hr />
        <h3>실행 이력</h3>
        {log.length ? (
          <ol>
            {log.map((l, i) => (
              <li key={i}>
                {l.at} · {l.label}
              </li>
            ))}
          </ol>
        ) : (
          <p>사건을 선택하면 결과를 기록합니다.</p>
        )}
      </aside>
    </div>
  );
}
export function Lab() {
  const [kind, setKind] = useState("recovery");
  return (
    <>
      <small>OPERATIONS REVIEW</small>
      <h1>설계 검수</h1>
      <p>
        별도 가상 주문에서 사건의 순서와 재실행 결과를 대조합니다. 구매자·운영자
        화면의 주문은 그대로 유지됩니다.
      </p>
      <label>
        검수 사례
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(trainingLabels).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Run key={kind} kind={kind} />
    </>
  );
}
