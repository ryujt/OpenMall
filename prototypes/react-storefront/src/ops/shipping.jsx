import React from "react";
import { input, date, sku, statusName, Field, Note } from "./shared";
import { claimAction, shipOrder, shippingLines } from "../commerce";
import { DeliveryPolicyEditor } from "../delivery-policy-editor";

export function ShippingOps({ db, run }) {
  const orders = db.orders.filter((o) => o.payment === "paid"),
    pending = db.orders.filter((o) =>
      ["pending", "compensating"].includes(o.payment),
    );
  function ship(e, o, action, lines) {
    e.preventDefault();
    const f = input(e.currentTarget);
    run(
      "warehouse",
      {
        pack: "출고 송장 등록",
        handoff: "택배사 인계",
        deliver: "배송완료 기록",
        hold: "실물 미인계 조사",
        resume: "실물 인계 재개",
        correct: "택배사 배송완료 정정",
      }[action],
      o.id,
      f.note || f.tracking || o.shipment?.tracking,
      (latest) => shipOrder(latest, o.id, action, { ...f, lines }),
    );
  }
  return (
    <>
      <DeliveryPolicyEditor db={db} run={run} />
      <h2>출고 명세</h2>
      {pending.length > 0 && (
        <details className="ops-box">
          <summary>결제 확인 중 · 출고 보류 {pending.length}건</summary>
          {pending.map((o) => (
            <p key={o.id}>{o.id} · 원거래 대사 대기</p>
          ))}
        </details>
      )}
      {orders.length === 0 && (
        <p className="ops-box">결제가 확정된 출고 대상이 없습니다.</p>
      )}
      {orders.map((o) => {
        const s = o.shipment || { status: "ready" },
          lines = shippingLines(o);
        const repack =
          (s.status === "packed" &&
            lines.some(
              (l) => s.lines?.find((x) => x.id === l.id)?.qty !== l.qty,
            )) ||
          (s.status === "packed" && s.lines?.length !== lines.length);
        return (
          <article className="ops-box" key={o.id}>
            <small>
              {o.id} · {date(o.date)}
            </small>
            <h3>
              {s.hold
                ? "실물 미인계 조사"
                : statusName[s.status] || "출고 대기"}
            </h3>
            <p>
              {o.delivery?.name} · {o.delivery?.address}
            </p>
            <ul>
              {lines.map((l) => {
                const p = o.lines.find((x) => x.id === l.id);
                return (
                  <li key={l.id}>
                    {p.name} · {p.option} · {sku(p)} · {l.qty}개
                  </li>
                );
              })}
            </ul>
            {s.tracking && (
              <p>
                {s.carrier} · 원출고 송장 {s.tracking}
              </p>
            )}
            {o.supplyDueAt && <p>공급 조치 기한 {o.supplyDueAt}</p>}
            {!lines.length ? (
              <p>인계 가능한 수량이 없습니다.</p>
            ) : s.status === "ready" || repack ? (
              <form onSubmit={(e) => ship(e, o, "pack", lines)}>
                {repack && (
                  <p role="alert">
                    취소로 명세가 바뀌었습니다. 잔여 품목을 재포장해 주세요.
                  </p>
                )}
                <div className="ops-grid">
                  <Field
                    title="택배사"
                    name="carrier"
                    value={s.carrier || "예시택배"}
                  />
                  <Field
                    title="원출고 운송장 번호"
                    name="tracking"
                    pattern="[0-9]{8,16}"
                    value={s.tracking}
                  />
                </div>
                <label className="ops-check">
                  <input required type="checkbox" />
                  미취소 수량과 포장 수량이 일치합니다.
                </label>
                <button>출고 송장 등록</button>
              </form>
            ) : s.status === "packed" ? (
              <form onSubmit={(e) => ship(e, o, "handoff", lines)}>
                <label className="ops-check">
                  <input required type="checkbox" />
                  송장과 실물 인계 수량을 확인했습니다.
                </label>
                <button>택배사 인계 확정</button>
              </form>
            ) : s.status === "transit" ? (
              s.hold ? (
                <form onSubmit={(e) => ship(e, o, "resume", lines)}>
                  <Note title="창고·기사 대조 근거" />
                  <button>인계 조사 종료</button>
                </form>
              ) : (
                <>
                  <form onSubmit={(e) => ship(e, o, "deliver", lines)}>
                    <button>배송완료 통지 반영</button>
                  </form>
                  <details>
                    <summary>실물 미인계 보고</summary>
                    <form onSubmit={(e) => ship(e, o, "hold", lines)}>
                      <Note title="실물·운송장 차이" />
                      <button>조사 등록</button>
                    </form>
                  </details>
                </>
              )
            ) : null}
            {s.status === "delivered" && (
              <details>
                <summary>택배사 배달 완료 정정</summary>
                <form onSubmit={(e) => ship(e, o, "correct", lines)}>
                  <Note title="원송장 오스캔과 공식 정정 근거" />
                  <button>원송장 경과 정정</button>
                </form>
              </details>
            )}
            {(o.claims || [])
              .filter((c) =>
                ["allocated", "replacementTransit", "replaced"].includes(
                  c.status,
                ),
              )
              .map((c) => (
                <section className="ops-inset" key={c.id}>
                  <h4>교환품 출고 · {c.id}</h4>
                  <p>
                    {o.lines.find((p) => p.id === c.lineId)?.name} · 동일 SKU{" "}
                    {c.qty}개 · {statusName[c.status]}
                  </p>
                  {c.status === "allocated" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = input(e.currentTarget);
                        run("warehouse", "교환품 출고", c.id, f.tracking, (d) =>
                          claimAction(d, o.id, c.id, "repack", f),
                        );
                      }}
                    >
                      <Field
                        title="교환품 운송장 번호"
                        name="tracking"
                        pattern="[0-9]{8,16}"
                      />
                      <button>교환품 송장 등록·인계</button>
                    </form>
                  ) : (
                    <p>교환품 송장 {c.tracking}</p>
                  )}
                  {c.status === "replacementTransit" && (
                    <button
                      onClick={() =>
                        run("warehouse", "교환품 도착", c.id, c.tracking, (d) =>
                          claimAction(d, o.id, c.id, "redeliver", {
                            tracking: c.tracking,
                          }),
                        )
                      }
                    >
                      교환품 배송완료 반영
                    </button>
                  )}
                </section>
              ))}
          </article>
        );
      })}
    </>
  );
}
