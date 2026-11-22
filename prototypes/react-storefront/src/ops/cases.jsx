import React from "react";
import {
  input,
  date,
  now,
  sku,
  ensure,
  statusName,
  Field,
  Note,
} from "./shared";
import { money } from "../model";
import { businessDue, claimAction } from "../commerce";

const typeName = {
  cancel: "출고 전 취소",
  return: "반품",
  exchange: "동일 옵션 교환",
};
export function CaseRow({ o, c, run, role }) {
  const p = o.lines.find((l) => l.id === c.lineId);
  const cs = role === "care";
  function act(e, action, label) {
    e.preventDefault();
    const f = input(e.currentTarget),
      opts = { ...f };
    opts.defer = Boolean(opts.defer);
    if (opts.receivedAt)
      opts.receivedAt = new Date(opts.receivedAt + "+09:00").toISOString();
    for (const key of ["receivedQty", "goodQty", "amount"])
      if (key in opts) opts[key] = Number(opts[key]);
    run(role, label, c.id, f.note || label, (db) => {
      const latest = db.orders
        .find((row) => row.id === o.id)
        ?.claims?.find((row) => row.id === c.id);
      ensure(
        latest?.status === c.status &&
          JSON.stringify(latest.history) === JSON.stringify(c.history),
        "다른 담당자의 처리가 먼저 반영되었습니다. 최신 내역을 다시 확인하세요.",
      );
      if (action === "receive" && f.receivedSku && f.receivedSku !== sku(p)) {
        return {
          ...db,
          orders: db.orders.map((row) =>
            row.id !== o.id
              ? row
              : {
                  ...row,
                  claims: row.claims.map((item) =>
                    item.id !== c.id
                      ? item
                      : {
                          ...item,
                          status: "review",
                          receivedAt:
                            item.receivedAt ||
                            opts.receivedAt ||
                            db.clock ||
                            now(),
                          dueAt:
                            item.dueAt ||
                            businessDue(
                              opts.receivedAt || db.clock || now(),
                              db.holidays,
                            ),
                          history: [
                            ...(item.history || []),
                            {
                              at: now(),
                              label:
                                "입고 품목 불일치 · " +
                                f.receivedSku +
                                " " +
                                opts.receivedQty +
                                "개. 올바른 품목 재확인 대기",
                            },
                          ],
                        },
                  ),
                },
          ),
        };
      }
      return claimAction(db, o.id, c.id, action, opts);
    });
  }
  return (
    <article className="ops-box">
      <small>
        {o.id} · {c.id}
      </small>
      <h3>
        {typeName[c.kind]} · {statusName[c.status] || c.status}
      </h3>
      <p>
        {p?.name} · {p?.option} · {c.qty}개
      </p>
      <dl className="ops-facts">
        {[
          ["접수일", date(c.createdAt)],
          ["신청 사유", c.reason],
          ["회수비", money(c.fee || 0)],
          ["예상 환불액", money(c.amount || 0)],
          ["환급 기한", c.dueAt || "입고 후 산정"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {c.collectionTracking && <p>회수 송장 {c.collectionTracking}</p>}
      {cs && c.status === "requested" && c.kind !== "cancel" && (
        <form onSubmit={(e) => act(e, "collect", "회수 운송장 등록")}>
          <Field title="회수 운송장" name="tracking" pattern="[0-9]{8,16}" />
          <button>회수 시작</button>
        </form>
      )}
      {cs && c.status === "collecting" && c.visit !== "pickup" && (
        <details>
          <summary>회수 방문·재방문 및 수거 기록</summary>
          <form
            onSubmit={(e) => {
              const f = input(e.currentTarget);
              act(e, f.visit, "택배사 회수 경과");
            }}
          >
            <label>
              기사 확인 결과
              <select name="visit">
                <option value="pickup">실물 수거</option>
                <option value="visitFailed">방문 실패</option>
                {c.visit === "visitFailed" && (
                  <option value="reschedule">재방문 배정</option>
                )}
              </select>
            </label>
            <Field
              title="회수 확인 송장"
              name="tracking"
              value={c.collectionTracking}
            />
            <Note title="회수 기사 확인 내역" />
            <button>회수 경과 반영</button>
          </form>
        </details>
      )}
      {cs && ["collecting", "review"].includes(c.status) && (
        <form onSubmit={(e) => act(e, "receive", "회수품 입고 확인")}>
          <Field
            title="실제 입고한 SKU"
            name="receivedSku"
            value={p && sku(p)}
          />
          <Field
            title="입고 수량"
            name="receivedQty"
            type="number"
            min="0"
            max="9999"
            value={c.qty}
          />
          <label>
            실제 입고 시각 (한국 시간)
            <input type="datetime-local" name="receivedAt" />
          </label>
          <button>판매자 입고 기록</button>
        </form>
      )}
      {cs && c.status === "received" && (
        <form onSubmit={(e) => act(e, "inspect", "검수 결과 등록")}>
          <Field
            name="goodQty"
            title="재판매 가능한 양품 수량"
            type="number"
            min="0"
            max={c.qty}
            value="0"
          />
          <label>
            귀책·비용 판정
            <select name="reason" defaultValue={c.reason}>
              <option>{c.reason}</option>
              {["단순변심", "파손·하자", "표시·광고와 다름"]
                .filter((v) => v !== c.reason)
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </label>
          <Note title="검수 근거 · 훼손 수량과 사유" />
          <button>검수 저장</button>
        </form>
      )}
      {cs &&
        c.kind === "exchange" &&
        ["inspected", "waiting"].includes(c.status) && (
          <form onSubmit={(e) => act(e, "replace", "동일 SKU 교환품 확보")}>
            <button>교환 재고 확보</button>
          </form>
        )}
      {c.status === "allocated" && (
        <p>
          교환 출고 명세가 생성되었습니다. 물류 담당자가 별도 운송장을
          등록합니다.
        </p>
      )}
      {!cs &&
        ((c.kind === "cancel" && c.status === "requested") ||
          (c.kind !== "exchange" && c.status === "inspected")) && (
          <form onSubmit={(e) => act(e, "refund", "원결제 환불 요청")}>
            <Note title="환불 처리 사유" />
            <button>환불 요청</button>
          </form>
        )}
      {!cs && c.status === "refundPending" && !c.pgConfirmedAt && (
        <form onSubmit={(e) => act(e, "reconcile", "기존 환불 결과 조회")}>
          <Field
            title="PG 취소 확인 금액"
            name="amount"
            type="number"
            min="0"
            value={c.amount}
          />
          <Field title="PG 취소 식별자" name="reference" value={c.refundId} />
          <Note title="원거래 대조 근거" />
          <label className="ops-check">
            <input type="checkbox" name="defer" />
            후속 처리 전달을 지연해 원장과 대조
          </label>
          <button>기존 요청 결과 조회</button>
        </form>
      )}
      {!cs && c.pgConfirmedAt && (
        <div className="ops-inset">
          <p>
            PG 취소 확인 {date(c.pgConfirmedAt)} · {c.refundId}
          </p>
          {[
            ["replayClaim", "신청 종결 반영", c.status === "refundPending"],
            [
              "replayOrder",
              "주문 환불액 반영",
              c.status === "refunded" && !c.orderPostedAt,
            ],
            [
              "replayNotice",
              "환불 알림 의뢰 복구",
              c.status === "refunded" && !c.noticeReadyAt,
            ],
          ]
            .filter(([, , show]) => show)
            .map(([action, title]) => (
              <form key={action} onSubmit={(e) => act(e, action, title)}>
                <button>{title}</button>
              </form>
            ))}
        </div>
      )}
      {c.discrepancy && (
        <p role="alert">
          PG 원거래와 취소 결과가 일치하지 않습니다. 재대사가 필요합니다.
        </p>
      )}
      <details>
        <summary>신청 처리 기록</summary>
        <ol className="ops-log">
          {(c.history || []).map((v, i) => (
            <li key={i}>
              {v.label}
              <small>{date(v.at)}</small>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
export function Inquiries({ db, run }) {
  const rows = db.orders.flatMap((o) =>
    (o.inquiries || []).map((q) => ({ o, q })),
  );
  return (
    <>
      <h3>주문 문의·이의 접수</h3>
      {!rows.length && <p>접수된 문의가 없습니다.</p>}
      {rows.map(({ o, q }) => (
        <article className="ops-box" key={q.id}>
          <small>
            {o.id} · {q.id} · {date(q.createdAt)}
          </small>
          <h3>{q.subject}</h3>
          <p>{q.body}</p>
          <p>
            수취 정보 · {o.delivery?.name?.slice(0, 1)}** · 연락처 끝{" "}
            {o.delivery?.phone?.slice(-4)}
          </p>
          {q.reply ? (
            <p>
              답변 · {q.reply} ({date(q.repliedAt)})
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const note = input(e.currentTarget).note.trim();
                run("care", "문의 답변", q.id, "고객 답변 등록", (d) => {
                  const current = d.orders
                    .find((x) => x.id === o.id)
                    ?.inquiries?.find((x) => x.id === q.id);
                  ensure(
                    current && !current.reply && note,
                    "이미 답변했거나 내용이 비어 있습니다.",
                  );
                  return {
                    ...d,
                    orders: d.orders.map((x) =>
                      x.id !== o.id
                        ? x
                        : {
                            ...x,
                            inquiries: x.inquiries.map((v) =>
                              v.id === q.id
                                ? { ...v, reply: note, repliedAt: now() }
                                : v,
                            ),
                          },
                    ),
                  };
                });
              }}
            >
              <Note title="검토 결과와 고객 답변" />
              <button>답변 등록</button>
            </form>
          )}
        </article>
      ))}
    </>
  );
}
export function Notifications({ db, run }) {
  const records = db.orders.flatMap((o) => [
    ...(o.payment === "paid"
      ? [{ id: o.id + "/paid", order: o.id, label: "결제 승인" }]
      : []),
    ...(o.shipment?.handedAt
      ? [{ id: o.id + "/ship", order: o.id, label: "배송 시작" }]
      : []),
    ...(o.claims || [])
      .filter(
        (c) =>
          (c.status === "refunded" && (c.noticeReadyAt || !c.pgConfirmedAt)) ||
          ["replacementTransit", "replaced"].includes(c.status),
      )
      .map((c) => ({
        id: c.id + "/" + (c.status === "refunded" ? "refund" : "exchange"),
        order: o.id,
        label: c.status === "refunded" ? "환불 완료" : "교환품 발송",
      })),
  ]);
  return (
    <details className="ops-box">
      <summary>발송 의뢰와 도달 결과 ({records.length})</summary>
      {records.map((r) => {
        const n = db.dispatches?.[r.id] || { status: "발송 대기", tries: 0 };
        return (
          <form
            className="ops-inset"
            key={r.id}
            onSubmit={(e) => {
              e.preventDefault();
              const result = input(e.currentTarget).result;
              run("care", "알림 결과 확인", r.id, result, (d) => {
                const old = d.dispatches?.[r.id] || {
                  status: "발송 대기",
                  tries: 0,
                };
                ensure(
                  old.status !== "도달 확인",
                  "이미 도달을 확인한 알림입니다.",
                );
                const lookup = old.status === "외부 접수 확인 중";
                const next = {
                  status: result,
                  at: now(),
                  tries: old.tries + (lookup ? 0 : 1),
                  providerId: "NT-" + r.id,
                };
                return { ...d, dispatches: { ...d.dispatches, [r.id]: next } };
              });
            }}
          >
            <h4>
              {r.label} · {r.order}
            </h4>
            <p>
              {n.status} · {n.tries}회 시도
            </p>
            {n.status !== "도달 확인" && (
              <>
                <label>
                  시험 발송사 응답
                  <select name="result">
                    <option>도달 확인</option>
                    <option>외부 접수 확인 중</option>
                    <option>전송 실패</option>
                  </select>
                </label>
                <button>
                  {n.status === "외부 접수 확인 중"
                    ? "기존 발송 결과 조회"
                    : n.tries
                      ? "동일 알림 재시도"
                      : "발송 의뢰"}
                </button>
              </>
            )}
          </form>
        );
      })}
    </details>
  );
}
