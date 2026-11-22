import React, { useState } from "react";
import {
  payOrder,
  recoverOrder,
  estimateClaim,
  availableQty,
  openClaim,
  claimAction,
  shippingLines,
} from "./commerce";
import { money, go } from "./model";
import { Lines, Summary } from "./order-ui";

const typeNames = {
  cancel: "출고 전 취소",
  return: "반품",
  exchange: "동일 옵션 교환",
};
const caseStages = {
  requested: "접수",
  collecting: "회수 중",
  received: "판매자 입고",
  review: "근거 확인 중",
  inspected: "검수 완료",
  refundPending: "원결제 환불 확인 중",
  refunded: "환불 완료",
  waiting: "교환 재고 부족 · 고객 선택 대기",
  allocated: "교환품 출고 대기",
  replacementTransit: "교환품 배송 중",
  replaced: "교환 완료",
  rejected: "반려",
};
const time = (s) => (s ? new Date(s).toLocaleString("ko-KR") : "—");
const route = (o, view = "") => "/orders/" + o.id + (view ? "/" + view : "");
function Link({ o, view, children }) {
  return (
    <a className="button" href={"#" + route(o, view)}>
      {children}
    </a>
  );
}
function History({ entries = [] }) {
  return entries.length ? (
    <ol>
      {entries.map((e, i) => (
        <li key={i}>
          {e.label} <small>{time(e.at)}</small>
        </li>
      ))}
    </ol>
  ) : (
    <p>아직 기록된 이력이 없습니다.</p>
  );
}
function Cases({ o, run }) {
  if (!o.claims.length) return <p>접수된 신청이 없습니다.</p>;
  return o.claims.map((c) => (
    <section className="panel" key={c.id}>
      <small>
        {c.id} · {time(c.createdAt)}
      </small>
      <h3>
        {typeNames[c.kind]} · {caseStages[c.status] || c.status}
      </h3>
      <p>
        {o.lines.find((p) => p.id === c.lineId)?.name} · {c.qty}개 · {c.reason}
      </p>
      <p>
        대상 수량 실결제액 {money(c.paid ?? 0)} · 고객 부담 회수비{" "}
        {money(c.fee ?? 0)} · 최초 배송비 환급 {money(c.fare ?? 0)}
      </p>
      {c.kind !== "exchange" && (
        <p>
          {c.status === "refunded" ? "확정" : "예상"} 환불액{" "}
          {money(c.amount ?? 0)}
        </p>
      )}
      {c.dueAt && <p>환급기한 {c.dueAt}</p>}
      {c.receivedQty != null && (
        <p>
          실제 도착 {c.receivedQty}개 / 신청 {c.qty}개
        </p>
      )}
      {c.pickupAddress && c.kind !== "cancel" && (
        <p>회수지 {c.pickupAddress}</p>
      )}
      {c.collectionTracking && <p>원품 회수 송장 {c.collectionTracking}</p>}
      {c.tracking && <p>교환품 송장 {c.tracking}</p>}
      {c.status === "waiting" && (
        <button
          onClick={() =>
            run((db) => claimAction(db, o.id, c.id, "convert", {}))
          }
        >
          교환 대신 원결제 환불로 전환
        </button>
      )}
      <details>
        <summary>신청 처리 이력</summary>
        <History entries={c.history} />
      </details>
    </section>
  ));
}
function Claim({ o, db, update }) {
  const lines = o.lines.filter((p) => availableQty(o, p.id) > 0);
  const [lineId, setLineId] = useState(lines[0]?.id || ""),
    [qty, setQty] = useState("1");
  const transit = o.shipment.status === "transit",
    delivered = o.shipment.status === "delivered";
  const [kind, setKind] = useState(transit || delivered ? "return" : "cancel"),
    [reason, setReason] = useState("단순변심"),
    [pickup, setPickup] = useState(
      [o.delivery.address, o.delivery.detail].filter(Boolean).join(" "),
    ),
    [discovered, setDiscovered] = useState(""),
    [notes, setNotes] = useState("");
  const [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [id] = useState(
      () => "CL-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
    );
  const input = {
    id,
    lineId,
    qty: Number(qty),
    kind,
    reason,
    pickupAddress: pickup,
    notes,
    discoveredAt: discovered || undefined,
  };
  const line = o.lines.find((l) => l.id === lineId);
  const [submitting, setSubmitting] = useState(false);
  function estimate(e) {
    e.preventDefault();
    try {
      setPreview(
        estimateClaim(o, {
          ...input,
          at: db.clock || new Date().toISOString(),
        }),
      );
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }
  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const fresh = estimateClaim(o, {
        ...input,
        at: db.clock || new Date().toISOString(),
      });
      if (fresh.amount !== preview.amount || fresh.fee !== preview.fee)
        throw new Error(
          "수량 또는 비용이 변경되었습니다. 신청 조건을 다시 확인해 주세요.",
        );
      await update(openClaim(db, o.id, input));
      go(route(o, "claims"));
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <small>{o.id}</small>
      <h1>
        {transit
          ? "배송 중 청약철회"
          : delivered
            ? "반품·교환 신청"
            : "출고 전 취소 신청"}
      </h1>
      {error && <p role="alert">{error}</p>}
      {o.payment !== "paid" || !lines.length ? (
        <div className="panel">
          <p>현재 신청 가능한 수량이 없습니다.</p>
          <Link o={o}>주문 상세 확인</Link>
        </div>
      ) : preview ? (
        <div className="split">
          <section className="panel">
            <h2>신청 내용 확인</h2>
            <p>
              {line.name} · {line.option} · {qty}개
            </p>
            <p>
              {typeNames[kind]} · {reason}
            </p>
            {kind !== "cancel" && <p>회수지 {pickup}</p>}
            <button onClick={() => setPreview(null)}>다시 입력</button>
          </section>
          <aside className="summary">
            <h2>예상 처리 금액</h2>
            {[
              ["품목 할인 배분", preview.discount],
              ["품목 실결제액", preview.paid],
              ["반환 대상 최초 배송비", preview.fare],
              ["고객 부담 회수비", preview.fee],
            ].map(([k, v]) => (
              <p key={k}>
                {k}
                <b>{money(v)}</b>
              </p>
            ))}
            <hr />
            <p>
              {kind === "exchange" ? "동일 옵션 재배송" : "예상 환불액"}
              <strong>
                {kind === "exchange" ? qty + "개" : money(preview.amount)}
              </strong>
            </p>
            <button className="primary" disabled={submitting} onClick={submit}>
              확인하고 접수
            </button>
          </aside>
        </div>
      ) : (
        <div className="split">
          <form className="panel" onSubmit={estimate}>
            <h2>신청 품목</h2>
            <label>
              상품과 옵션
              <select
                value={lineId}
                onChange={(e) => {
                  setLineId(e.target.value);
                  setQty("1");
                }}
              >
                {lines.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} · {p.option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              신청 수량 (가능 {availableQty(o, lineId)}개)
              <input
                type="number"
                required
                min="1"
                step="1"
                max={availableQty(o, lineId)}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
            <label>
              신청 유형
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {(delivered
                  ? ["return", "exchange"]
                  : transit
                    ? ["return"]
                    : ["cancel"]
                ).map((k) => (
                  <option value={k} key={k}>
                    {typeNames[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              신청 사유
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option>단순변심</option>
                <option>파손·하자</option>
                <option>표시·광고 내용과 다름</option>
              </select>
            </label>
            {kind !== "cancel" && (
              <label>
                회수 주소
                <input
                  required
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                />
              </label>
            )}
            {delivered && reason !== "단순변심" && (
              <label>
                하자·불일치 발견일
                <input
                  type="date"
                  required
                  value={discovered}
                  onChange={(e) => setDiscovered(e.target.value)}
                />
              </label>
            )}
            <label>
              추가 설명 (선택)
              <textarea
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="actions">
              <Link o={o}>돌아가기</Link>
              <button className="primary">예상 처리 금액 확인</button>
            </div>
          </form>
          <aside className="summary">
            <h2>접수 기준</h2>
            <p>
              {transit
                ? "인계가 완료된 품목입니다. 철회 의사와 접수 시각을 기록하고 회수 절차를 안내합니다."
                : delivered
                  ? "단순 변심은 계약 서면 수령과 상품 수령 중 늦은 날을 기준으로 7일 이내 신청할 수 있습니다."
                  : "아직 택배사에 인계하지 않은 수량을 취소할 수 있습니다."}
            </p>
            {delivered && (
              <>
                <p>
                  상품이 계약 내용과 다르면 수령 후 3개월 이내이면서 차이를
                  발견한 날부터 30일 이내 접수할 수 있습니다.
                </p>
                <p>
                  단순 변심 회수비는 반품 3,000원, 교환 6,000원입니다. 상품
                  하자·표시 불일치의 회수비는 판매자가 부담합니다. 다른 옵션을
                  원하면 반품 후 새로 주문해 주세요.
                </p>
              </>
            )}
            <Link o={o} view="support">
              비용·기산일 문의
            </Link>
          </aside>
        </div>
      )}
    </>
  );
}
function Support({ db, o, update }) {
  const [sent, setSent] = useState(""),
    [error, setError] = useState("");
  async function send(e) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      body = String(f.get("body")).trim();
    if (!body) {
      setError("문의 내용을 입력해 주세요.");
      return;
    }
    const inquiry = {
      id: "CS-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
      subject: f.get("subject"),
      body,
      createdAt: new Date(db.clock || Date.now()).toISOString(),
    };
    try {
      await update({
        ...db,
        orders: db.orders.map((v) =>
          v.id === o.id
            ? { ...v, inquiries: [inquiry, ...(v.inquiries || [])] }
            : v,
        ),
      });
      setSent(inquiry.id);
      setError("");
      form.reset();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <>
      <h1>배송·처리 문의</h1>
      <div className="split">
        <form className="panel" onSubmit={send}>
          <small>{o.id}</small>
          <label>
            문의 항목
            <select name="subject">
              {[
                "배송완료 후 미수령",
                "반품·회수비 이의",
                "수령일·철회 기산일 이의",
                "배송지 변경 요청",
                "회수 일정 조정",
                "기타",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            문의 내용
            <textarea required maxLength={1600} name="body" rows={5} />
          </label>
          <button className="primary">상담 접수</button>
          {sent && <p role="status">{sent} 문의가 접수되었습니다.</p>}
          {error && <p role="alert">{error}</p>}
        </form>
        <aside className="summary">
          <h2>상담 이력</h2>
          {!o.inquiries?.length && <p>접수된 문의가 없습니다.</p>}
          {o.inquiries?.map((i) => (
            <section key={i.id}>
              <small>
                {i.id} · {time(i.createdAt)}
              </small>
              <h3>{i.subject}</h3>
              <p>{i.body}</p>
              <p>{i.reply ? "답변 · " + i.reply : "답변 대기"}</p>
            </section>
          ))}
          <Link o={o}>주문 상세</Link>
        </aside>
      </div>
    </>
  );
}
function Contract({ o }) {
  const records = [
    ["주문번호", o.id],
    ["주문 시각", time(o.date)],
    ["거래 조건", o.termsVersion || "주문 시점 기준"],
    ["결제 수단", o.method],
    ["주문 연락처", o.contact || o.delivery.phone],
    ["수취인", o.delivery.name],
    [
      "배송지",
      [o.delivery.zip, o.delivery.address, o.delivery.detail]
        .filter(Boolean)
        .join(" "),
    ],
    ["공급 방법", "국내 일반택배 · 선결제 후 3영업일 내 공급 조치"],
    [
      "적용 배송 정책",
      o.shippingPolicy
        ? "v" + o.shippingPolicy.version
        : "이전 주문 · 버전 기록 없음",
    ],
    ["출고 마감", o.shippingPolicy?.cutoff || "주문 시점 기록 없음"],
    ["배송비", money(o.fare)],
    ["쿠폰 할인", money(o.discount)],
    ["주문 금액", money(o.total)],
    ["반품비", "단순 변심 3,000원, 상품 하자 0원"],
    ["교환비", "단순 변심 6,000원, 상품 하자 0원"],
  ];
  const merchandise = o.lines.map(
    (p) =>
      p.name +
      " · " +
      p.option +
      " · " +
      money(p.price) +
      " × " +
      p.qty +
      "개 · 배분 할인 " +
      money((p.unitDiscounts || []).reduce((s, n) => s + n, 0)) +
      [
        p.material,
        p.origin,
        p.care,
        p.version ? "상품 고시 v" + p.version : null,
      ]
        .filter(Boolean)
        .map((term) => " · " + term)
        .join(""),
  );
  const text = [
    "OpenMall 계약내용",
    ...records.map(([k, v]) => k + "　" + v),
    ...merchandise,
  ].join("\n");
  return (
    <>
      <h1>계약내용 전자문서</h1>
      <article className="panel">
        <h2>주문 시점 거래 조건</h2>
        {records.map(([k, v]) => (
          <p key={k}>
            <strong>{k}</strong>　{v}
          </p>
        ))}
        {merchandise.map((s) => (
          <p key={s}>{s}</p>
        ))}
        <div className="actions">
          <a
            className="button primary"
            download={o.id + "-contract.txt"}
            href={"data:text/plain;charset=utf-8," + encodeURIComponent(text)}
          >
            계약내용 저장
          </a>
          <Link o={o}>주문 상세</Link>
        </div>
      </article>
    </>
  );
}
function Payment({ db, o, update }) {
  const [error, setError] = useState(""),
    [result, setResult] = useState("approved");
  async function apply(outcome) {
    try {
      const next = payOrder(db, o.id, outcome);
      await update(next);
      if (next.orders.find((v) => v.id === o.id).payment === "paid")
        go(route(o));
    } catch (e) {
      setError(e.message);
    }
  }
  async function recover() {
    try {
      await update(recoverOrder(db, o.id));
    } catch (e) {
      setError(e.message);
    }
  }
  async function retry() {
    try {
      await update({
        ...db,
        direct: Object.fromEntries(o.lines.map((p) => [p.id, p.qty])),
      });
      go("/checkout/direct");
    } catch (e) {
      setError(e.message);
    }
  }
  const waiting = o.payment === "ready" && o.receptionPending;
  let title = waiting
    ? "주문 처리 중"
    : {
        ready: "결제 인증",
        pending: "결제 확인 중",
        paid: "결제완료",
        failed: "결제 실패",
        expired: o.stage,
        compensating: "전액 취소 확인 중",
        compensated: "승인 전액 취소",
      }[o.payment] || o.stage;
  return (
    <div className="formbox">
      <small>{o.id}</small>
      <h1>{title}</h1>
      <p>
        {o.method} · {money(o.total)}
      </p>
      {waiting ? (
        <>
          <p>
            수량과 쿠폰의 예약 응답을 기다리고 있습니다. 같은 주문번호로 결과를
            확인하거나 예약을 취소할 수 있습니다.
          </p>
          <button className="primary" onClick={recover}>
            기존 주문 다시 확인
          </button>
          <button onClick={() => apply("cancel")}>주문 처리 중 취소</button>
        </>
      ) : o.payment === "ready" ? (
        <>
          <p>가상 결제 인증 결과를 선택하면 이 주문의 원거래에 반영됩니다.</p>
          <label>
            인증 결과
            <select
              aria-label="인증 결과"
              value={result}
              onChange={(e) => setResult(e.target.value)}
            >
              {[
                ["approved", "승인 확인"],
                ["pending", "인증창 닫기·응답 지연"],
                ["failed", "승인 거절"],
                ["expired", "인증 유효기간 만료"],
                ["mismatch", "승인 금액 불일치"],
                ["unfulfillable", "승인 후 주문 확정 불가"],
              ].map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => apply(result)}>
            인증 결과 확인
          </button>
          <button onClick={() => apply("cancel")}>결제 중단</button>
        </>
      ) : o.payment === "pending" ? (
        <>
          <p>
            {o.discrepancy
              ? "승인 금액과 주문 금액이 달라 원거래를 대조하고 있습니다."
              : "승인 응답이 도착하지 않았습니다."}{" "}
            기존 거래 결과를 확인하는 동안 재결제와 출고를 보류합니다.
          </p>
          {!o.discrepancy && (
            <>
              <label>
                원거래 조회 결과
                <select
                  aria-label="원거래 조회 결과"
                  value={result === "failed" ? "failed" : "approved"}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="approved">승인 일치</option>
                  <option value="failed">거절 확정</option>
                </select>
              </label>
              <button
                className="primary"
                onClick={() =>
                  apply(result === "failed" ? "failed" : "approved")
                }
              >
                결과 다시 확인
              </button>
            </>
          )}
        </>
      ) : ["failed", "expired", "compensated"].includes(o.payment) ? (
        <>
          <p>
            기존 주문 결과를 보존합니다. 다시 주문하면 가격과 재고를 새로
            확인합니다.
          </p>
          <button className="primary" onClick={retry}>
            새 주문서로 돌아가기
          </button>
        </>
      ) : o.payment === "compensating" ? (
        <p>
          이행할 수 없는 주문의 승인을 전액 취소하는 중입니다. 운영자가 원거래를
          대조하면 이곳에 결과가 표시됩니다.
        </p>
      ) : null}
      {error && <p role="alert">{error}</p>}
      <Link o={o}>주문 상세</Link>
    </div>
  );
}
export function Order({ o, view = "", claim, db, update }) {
  const [error, setError] = useState("");
  const run = async (fn) => {
    try {
      await update(fn(db));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  if (claim || view === "claim")
    return <Claim key={o.shipment.status} o={o} db={db} update={update} />;
  if (view === "payment") return <Payment o={o} db={db} update={update} />;
  if (view === "contract") return <Contract o={o} />;
  if (view === "support") return <Support o={o} db={db} update={update} />;
  if (view === "claims")
    return (
      <>
        <h1>신청 처리 내역</h1>
        {error && <p role="alert">{error}</p>}
        <Cases o={o} run={run} />
        <div className="actions">
          <Link o={o} view="support">
            처리 문의
          </Link>
          <Link o={o}>주문 상세</Link>
        </div>
      </>
    );
  if (view === "tracking")
    return (
      <>
        <h1>배송 이력</h1>
        <section className="panel">
          <h2>{o.shipment.carrier || "국내 일반택배"}</h2>
          <p>원운송장 {o.shipment.tracking || "등록 대기"}</p>
          <History
            entries={o.history.filter((e) =>
              /송장|배송|집화|인계|포장|부재|수령/.test(e.label),
            )}
          />
          <Link o={o}>주문 상세</Link>
        </section>
      </>
    );
  const approved = ["paid", "compensating", "compensated"].includes(o.payment);
  if (view === "receipt" && approved)
    return (
      <div className="formbox">
        <small>{o.id}</small>
        <h1>결제 영수증</h1>
        <p>거래 식별자 {o.paymentId}</p>
        <p>승인 시각 {time(o.paidAt)}</p>
        <p>결제 수단 {o.method}</p>
        <p>승인액 {money(o.total)}</p>
        <p>확정 환불액 {money(o.refunded)}</p>
        <p>승인 잔액 {money(o.total - o.refunded)}</p>
        {o.claims
          .filter((c) => c.status === "refunded")
          .map((c) => (
            <p key={c.id}>
              {c.id} · {money(c.amount)} 원거래 환불
            </p>
          ))}
        <Link o={o}>주문 상세</Link>
      </div>
    );
  const canClaim =
    o.payment === "paid" && o.lines.some((l) => availableQty(o, l.id) > 0);
  const handed = ["transit", "delivered"].includes(o.shipment.status);
  return (
    <>
      <small>
        {o.id} · {time(o.date)}
      </small>
      <h1>주문 상세</h1>
      <div className="split">
        <section className="panel">
          <h2>
            {o.receptionPending && o.payment === "ready"
              ? "주문 처리 중"
              : o.stage}
          </h2>
          <Lines lines={o.lines}>
            {(p) => (
              <p>
                배분 할인{" "}
                {money((p.unitDiscounts || []).reduce((s, n) => s + n, 0))}
                {o.payment === "paid" &&
                  " · " +
                    (handed ? "인계" : "출고 예정") +
                    " " +
                    (shippingLines(o).find((l) => l.id === p.id)?.qty || 0) +
                    "개"}
              </p>
            )}
          </Lines>
          <h3>배송 정보</h3>
          {o.supplyDueAt && <p>공급 조치 기한 {o.supplyDueAt}</p>}
          <p>
            {o.delivery.name} · {o.delivery.phone}
            <br />
            {o.delivery.zip} {o.delivery.address} {o.delivery.detail}
          </p>
          {o.shipment.tracking && (
            <p>
              {o.shipment.carrier} · 운송장 {o.shipment.tracking}
            </p>
          )}
          <div className="actions">
            {o.payment !== "paid" && (
              <Link o={o} view="payment">
                결제 상태 확인
              </Link>
            )}
            {canClaim && (
              <Link o={o} view="claim">
                {handed
                  ? o.shipment.status === "transit"
                    ? "배송 중 청약철회"
                    : "반품·교환 신청"
                  : "출고 전 취소 신청"}
              </Link>
            )}
            {o.shipment.tracking && (
              <Link o={o} view="tracking">
                배송 이력
              </Link>
            )}
            {o.claims.length > 0 && (
              <Link o={o} view="claims">
                신청 처리 내역 {o.claims.length}건
              </Link>
            )}
            <Link o={o} view="support">
              배송·처리 문의
            </Link>
          </div>
          <details>
            <summary>주문 처리 이력</summary>
            <History entries={o.history} />
          </details>
        </section>
        <Summary {...o}>
          <p>{o.method}</p>
          {approved && (
            <>
              <p>
                누적 환불액 <b>{money(o.refunded)}</b>
              </p>
              <Link o={o} view="receipt">
                결제 영수증
              </Link>
            </>
          )}
          <Link o={o} view="contract">
            계약내용 확인·저장
          </Link>
        </Summary>
      </div>
    </>
  );
}
