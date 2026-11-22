import { shippingPolicy, zoneForAddress } from "./delivery-policy.js";

// All commands return a new browser snapshot. A rejected command leaves the input untouched.
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const sum = (values) => values.reduce((a, b) => a + b, 0);
const when = (db) => new Date(db.clock || Date.now()).toISOString();
const stamp = (target, at, label) => target.history.push({ at, label });
const item = (db, id) => db.products.find((p) => p.id === id);
const getOrder = (db, id) => {
  const order = db.orders.find((o) => o.id === id);
  check(order, "주문을 찾을 수 없습니다.");
  return order;
};
const afterHandoff = (o) =>
  ["transit", "delivered"].includes(o.shipment.status);
const ordered = (o) => o.lines.map(({ id, qty }) => ({ id, qty }));
const quantity = (n, min = 1) => Number.isSafeInteger(n) && n >= min;
const changed = (db, id) => {
  const o = structuredClone(upgradeOrder(getOrder(db, id)));
  return [
    {
      ...db,
      orders: db.orders.map((old) => (old.id === id ? o : old)),
      products: db.products.map((p) => ({ ...p })),
    },
    o,
  ];
};
function shiftStock(db, lines, sign) {
  for (const { id, qty } of lines) {
    const p = item(db, id);
    check(
      p && quantity(p.stock + qty * sign, 0),
      "판매 가능 재고가 변경되었습니다.",
    );
    p.stock += qty * sign;
  }
}

export function couponAvailable(db) {
  const owner = db.memberId || "demo";
  return (
    Boolean(db.member) &&
    !db.orders.some(
      (o) =>
        (o.memberId || "demo") === owner &&
        o.member &&
        o.discount > 0 &&
        (o.release?.coupon === false ||
          !["failed", "expired", "compensating", "compensated"].includes(
            o.payment,
          )),
    )
  );
}

// Largest remainder apportionment, with stable ties by order line and unit position.
export function allocateDiscount(lines, discount) {
  const subtotal = sum(lines.map((l) => l.price * l.qty));
  const units = lines.flatMap((l, row) =>
    Array.from({ length: l.qty }, (_, unit) => {
      const weighted = BigInt(l.price) * BigInt(discount);
      const base = BigInt(subtotal || 1);
      return {
        row,
        unit,
        value: Number(weighted / base),
        remainder: Number(weighted % base),
      };
    }),
  );
  const left = discount - sum(units.map((u) => u.value));
  const priority = units
    .slice()
    .sort(
      (a, b) => b.remainder - a.remainder || a.row - b.row || a.unit - b.unit,
    );
  for (let n = 0; n < left; n++) priority[n].value++;
  const result = lines.map((l) => Array(l.qty));
  units.forEach((u) => {
    result[u.row][u.unit] = u.value;
  });
  return result;
}

export function quote(db, { lines, zone = "base", discount = 0 }) {
  check(
    zone === "base" || zone === "island",
    "배송이 어려운 지역입니다. 배송지를 변경해 주세요.",
  );
  check(Array.isArray(lines) && lines.length, "주문할 상품을 선택해 주세요.");
  const seen = new Set();
  const current = lines.map((l) => {
    const p = item(db, l.id);
    check(
      p &&
        p.active !== false &&
        quantity(l.qty) &&
        l.qty <= p.stock &&
        !seen.has(p.id),
      "구매 가능한 옵션과 재고 수량을 다시 확인해 주세요.",
    );
    seen.add(p.id);
    return { ...structuredClone(p), qty: l.qty };
  });
  const subtotal = sum(current.map((l) => l.price * l.qty));
  check(
    quantity(discount, 0) &&
      (!discount || (subtotal > discount && couponAvailable(db))),
    "이 주문에서 사용할 수 없는 쿠폰입니다.",
  );
  const policy = structuredClone(shippingPolicy(db));
  const fare = zone === "island" ? policy.islandFare : policy.baseFare;
  check(quantity(fare, 0), "현재 배송 권역의 운임을 확인해 주세요.");
  const allocations = allocateDiscount(current, discount);
  const quoted = current.map((l, i) => ({
    ...l,
    unitDiscounts: allocations[i],
  }));
  const signature = JSON.stringify([
    zone,
    policy.version,
    db.memberId || null,
    Boolean(db.member),
    fare,
    discount,
    quoted.map((l) => [
      l.id,
      l.option,
      l.price,
      l.qty,
      l.termsVersion || l.version || 0,
    ]),
  ]);
  return {
    lines: quoted,
    shippingPolicy: policy,
    subtotal,
    fare,
    discount,
    total: subtotal + fare - discount,
    signature,
  };
}

export function createOrder(db, input) {
  const { id, lines, signature, delivery, method } = input;
  check(
    id && delivery?.name && delivery?.address && delivery?.phone && method,
    "배송 정보와 결제 수단을 확인해 주세요.",
  );
  const memberId = db.member ? db.memberId || "demo" : null;
  check(
    Boolean(input.member) === Boolean(db.member) &&
      (!input.ownerId || input.ownerId === memberId),
    "주문을 작성한 계정으로 다시 로그인해 주세요.",
  );
  const bodyKey = JSON.stringify([
    memberId,
    input.contact,
    lines.map((l) => [l.id, l.qty]),
    signature,
    delivery.name,
    delivery.address,
    delivery.detail,
    delivery.zip || delivery.postcode,
    delivery.phone,
    input.source,
    input.zone,
    input.discount,
    method,
  ]);
  const existing = db.orders.find((o) => o.id === id);
  if (existing) {
    check(
      existing.bodyKey === bodyKey,
      "같은 주문번호에 다른 요청이 있습니다. 주문서를 다시 열어 주세요.",
    );
    return db;
  }
  const zip = delivery.zip || delivery.postcode;
  const zone = zip
    ? zoneForAddress(db, { zip, address: delivery.address })
    : input.zone;
  const q = quote(db, { ...input, zone });
  check(
    signature === q.signature,
    "견적이 변경되었습니다. 가격과 배송비를 다시 확인해 주세요.",
  );
  const date = when(db);
  const order = {
    ...q,
    id,
    date,
    member: db.member,
    memberId,
    method,
    source: input.source,
    delivery: { ...delivery },
    contact: input.contact || delivery.phone,
    payment: "ready",
    receptionPending: Boolean(input.receptionPending),
    stage: input.receptionPending ? "주문 처리 중" : "결제 대기",
    reservationExpiresAt: new Date(
      Date.parse(date) + 15 * 60 * 1000,
    ).toISOString(),
    paymentId: input.receptionPending ? null : "PAY-" + id,
    claims: [],
    history: [],
    shipment: { status: "ready", lines: [] },
    refunded: 0,
    termsVersion: "생활용품 2026.11",
    contractAt: date,
    bodyKey,
  };
  stamp(order, date, "거래 조건 저장 · 재고 및 쿠폰 예약");
  const next = {
    ...db,
    orders: [order, ...db.orders],
    products: db.products.map((p) => ({ ...p })),
  };
  shiftStock(next, q.lines, -1);
  if (input.source === "cart") {
    next.cart = { ...db.cart };
    for (const l of q.lines) {
      const n = (next.cart[l.id] || 0) - l.qty;
      if (n > 0) next.cart[l.id] = n;
      else delete next.cart[l.id];
    }
  } else if (input.source === "direct") next.direct = null;

  return next;
}

export function recoverOrder(db, id) {
  const [next, o] = changed(db, id);
  if (o.payment !== "ready" || !o.receptionPending) return db;
  o.receptionPending = false;
  o.stage = "결제 대기";
  o.paymentId = "PAY-" + id;
  stamp(o, when(db), "같은 제출 키로 예약·주문 접수 확인");
  return next;
}

// A clock tick alone cannot release a PG reservation. Restartable effects have separate receipts.
export function expireReservation(
  db,
  id,
  { pgClosed = false, stopAfter } = {},
) {
  const [next, o] = changed(db, id),
    at = when(db);
  if (!o.release && !["ready", "pending"].includes(o.payment)) return db;
  if (o.release?.stock && o.release?.coupon) return db;
  if (!o.release) {
    check(
      Date.parse(at) >= Date.parse(o.reservationExpiresAt),
      "예약 만료 시각을 확인해 주세요.",
    );
    check(
      pgClosed,
      "PG 원거래가 종료되었는지 확인할 때까지 예약을 유지합니다.",
    );
    o.release = { stock: false, coupon: !o.discount };
    o.payment = "expired";
    o.stage = "예약 만료";
    o.receptionPending = false;
    stamp(o, at, "승인 가능성 종료 확인 · 만료 처리 시작");
  }
  if (stopAfter === "order") return next;
  if (!o.release.stock) {
    shiftStock(next, o.lines, 1);
    o.release.stock = true;
    stamp(o, at, "만료 주문 재고 예약 해제");
  }
  if (stopAfter === "stock") return next;
  if (!o.release.coupon) {
    o.release.coupon = true;
    stamp(o, at, "만료 주문 쿠폰 예약 해제");
  }
  return next;
}

export function payOrder(db, id, outcome) {
  const [next, o] = changed(db, id);
  const at = when(db);
  if (o.payment === "paid" || o.payment === "compensated") return db;
  if (o.payment === "compensating") {
    if (outcome !== "compensated") return db;
    o.payment = "compensated";
    o.stage = "승인 전액 취소";
    o.refunded = o.total;
    stamp(o, at, "원승인 전액 취소 확인");
    return next;
  }
  if (["failed", "expired"].includes(o.payment)) {
    if (
      !o.paymentId ||
      o.receptionPending ||
      (outcome !== "approved" && outcome !== "unfulfillable")
    )
      return db;
    if (o.release && !o.release.stock) shiftStock(next, o.lines, 1);
    if (o.release) o.release = { stock: true, coupon: true };
    o.payment = "compensating";
    o.stage = "전액 취소 확인 중";
    stamp(o, at, "예약 종료 뒤 늦은 승인 · 출고 보류 및 전액 취소 요청");
    return next;
  }
  check(
    !o.receptionPending || ["cancel", "expired"].includes(outcome),
    "같은 주문번호의 접수 결과를 먼저 확인해 주세요.",
  );
  switch (outcome) {
    case "pending":
    case "mismatch":
      if (o.payment === "pending" && (outcome === "pending" || o.discrepancy))
        return db;
      o.payment = "pending";
      o.stage = "결제 확인 중";
      o.discrepancy = outcome === "mismatch";
      if (o.discrepancy)
        o.pgComparison = {
          expected: o.total,
          reported: o.total + 1,
          reference: o.paymentId,
          at,
        };
      stamp(
        o,
        at,
        o.discrepancy
          ? "원거래 승인 금액 불일치 · 대사 필요"
          : "승인 응답 대기 · 기존 거래 조회",
      );
      break;
    case "approved":
      o.payment = "paid";
      o.stage = "결제완료";
      o.paidAt = at;
      o.supplyDueAt = businessDue(at, db.holidays);
      o.discrepancy = false;
      stamp(o, at, "원거래 승인 확인 · 출고 대기");
      break;
    case "failed":
    case "expired":
    case "cancel":
    case "unfulfillable":
      check(
        !(outcome === "cancel" && o.payment === "pending"),
        "원거래 결과를 먼저 확인해 주세요.",
      );
      shiftStock(next, o.lines, 1);
      if (o.receptionPending) {
        o.receptionPending = false;
        o.paymentId = null;
      }
      o.payment = {
        failed: "failed",
        expired: "expired",
        cancel: "expired",
        unfulfillable: "compensating",
      }[outcome];
      o.stage = {
        failed: "결제 실패",
        expired: "예약 만료",
        cancel: "주문 중단",
        unfulfillable: "전액 취소 확인 중",
      }[outcome];
      stamp(o, at, o.stage + " · 예약 해제");
      break;
    default:
      throw new Error("확인할 수 없는 결제 결과입니다.");
  }
  return next;
}

// Evidence supplied by the simulated PG; validate its origin, attempt, ownership and amount independently.
export function paymentNotice(db, id, evidence) {
  const o = getOrder(db, id);
  if (
    evidence.verified &&
    evidence.orderId === id &&
    evidence.paymentId === o.paymentId &&
    evidence.amount === o.total
  ) {
    return payOrder(db, id, evidence.outcome);
  }
  const [next, model] = changed(db, id);
  const label = evidence.verified ? "PG 귀속·금액 불일치" : "PG 발신 확인 실패";
  if (evidence.verified && ["ready", "pending"].includes(model.payment)) {
    model.payment = "pending";
    model.stage = "결제 확인 중";
    model.discrepancy = true;
    model.pgComparison = {
      expected: model.total,
      reported: evidence.amount,
      reference: evidence.paymentId,
      at: when(db),
    };
  }
  if (model.history.at(-1)?.label !== label) stamp(model, when(db), label);
  return next;
}

export function availableQty(o, lineId) {
  const line = o.lines.find((l) => l.id === lineId);
  return line
    ? line.qty -
        sum(
          (o.claims || []).filter((c) => c.lineId === lineId).map((c) => c.qty),
        )
    : 0;
}
export function shippingLines(o) {
  return ordered(o)
    .map((l) => ({
      ...l,
      qty:
        l.qty -
        sum(
          (o.claims || [])
            .filter((c) => c.lineId === l.id && c.kind === "cancel")
            .map((c) => c.qty),
        ),
    }))
    .filter((l) => l.qty > 0);
}

const matches = (a, b) =>
  a.length === b.length &&
  a.every((l) => b.some((r) => r.id === l.id && r.qty === l.qty));
function trackingUsed(db, tracking, exceptOrder) {
  return db.orders.some(
    (o) =>
      (o.id !== exceptOrder &&
        (o.shipment?.tracking || o.tracking) === tracking) ||
      (o.claims || []).some(
        (c) => c.tracking === tracking || c.collectionTracking === tracking,
      ),
  );
}
export function shipOrder(db, id, action, opts = {}) {
  const [next, o] = changed(db, id);
  const s = o.shipment,
    at = when(db);
  check(o.payment === "paid", "결제 승인을 확인한 주문만 출고할 수 있습니다.");
  if (action === "hold" || action === "resume") {
    check(opts.note?.trim(), "조사·해제 근거를 입력해 주세요.");
    s.hold = action === "hold";
    s.holdReason = opts.note;
    stamp(o, at, (s.hold ? "출고 보류 · " : "보류 해제 · ") + opts.note);
    return next;
  }
  check(!s.hold, "실물과 인계 증빙을 대조할 때까지 배송을 보류합니다.");
  if (action === "pack") {
    check(!afterHandoff(o), "이미 인계한 상품입니다.");
    const lines = shippingLines(o);
    check(
      lines.length && (!opts.lines || matches(lines, opts.lines)),
      "포장 수량이 달라졌습니다. 최신 명세를 확인해 주세요.",
    );
    check(
      opts.tracking?.trim() && !trackingUsed(db, opts.tracking, id),
      "사용 가능한 운송장 번호를 입력해 주세요.",
    );
    if (
      s.status === "packed" &&
      s.tracking === opts.tracking &&
      matches(s.lines, lines)
    )
      return db;
    Object.assign(s, {
      status: "packed",
      lines,
      carrier: opts.carrier || "예시택배",
      tracking: opts.tracking,
      packedAt: at,
    });
    o.tracking = s.tracking;
    o.stage = "송장 등록";
    stamp(o, at, "송장 등록 · 포장 수량 확인");
  } else if (action === "handoff") {
    if (afterHandoff(o)) return db;
    check(
      s.status === "packed" &&
        matches(s.lines, shippingLines(o)) &&
        (!opts.lines || matches(s.lines, opts.lines)),
      "포장 수량이 변경되었습니다. 재포장 후 인계해 주세요.",
    );
    s.status = "transit";
    s.handedAt = at;
    o.stage = "배송 중";
    stamp(o, at, "택배사 인계 확정");
  } else if (action === "correct") {
    check(
      s.status === "delivered" && opts.note?.trim(),
      "원송장과 택배사 정정 근거를 확인해 주세요.",
    );
    s.previousDeliveredAt = s.deliveredAt;
    s.deliveredAt = null;
    s.status = "transit";
    o.stage = "배송 중";
    stamp(o, at, "원송장 배송완료 정정 · " + opts.note);
  } else if (action === "deliver") {
    if (s.status === "delivered") return db;
    check(
      s.status === "transit" &&
        (!opts.tracking || s.tracking === opts.tracking),
      "인계한 원운송장을 확인해 주세요.",
    );
    s.status = "delivered";
    s.deliveredAt = at;
    o.stage = "배송완료";
    stamp(o, at, "원운송장 배송완료");
  } else throw new Error("지원하지 않는 배송 작업입니다.");
  return next;
}

// Calendar dates are compared in Korea time. Only the supplied business calendar is used.
const koreanDay = (value) =>
  new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10);
export function businessDue(at, holidays = []) {
  const d = new Date(koreanDay(at) + "T00:00:00Z");
  let left = 3;
  while (left) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (
      ![0, 6].includes(d.getUTCDay()) &&
      !holidays.includes(d.toISOString().slice(0, 10))
    )
      left--;
  }
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) =>
  (Date.parse(koreanDay(b)) - Date.parse(koreanDay(a))) / 86400000;
function threeMonths(day) {
  const d = new Date(day + "T00:00:00Z"),
    n = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 4);
  d.setUTCDate(0);
  d.setUTCDate(Math.min(n, d.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
const simple = (reason) => reason?.includes("단순") || reason?.includes("변심");
function returnFee(kind, reason) {
  return simple(reason) && kind !== "cancel"
    ? kind === "exchange"
      ? 6000
      : 3000
    : 0;
}
export function estimateClaim(o, input) {
  const { lineId, qty, reason } = input;
  const kind = input.kind;
  check(o.payment === "paid", "승인된 주문만 신청할 수 있습니다.");
  check(
    quantity(qty) && qty <= availableQty(o, lineId),
    "신청 가능한 잔여 수량을 확인해 주세요.",
  );
  check(
    ["cancel", "return", "exchange"].includes(kind) && reason?.trim(),
    "신청 유형과 사유를 선택해 주세요.",
  );
  const handed = afterHandoff(o);
  check(
    kind === "cancel" ? !handed : handed,
    "출고 상태가 변경되었습니다. 가능한 신청 유형을 다시 선택해 주세요.",
  );
  check(
    kind !== "exchange" || o.shipment.status === "delivered",
    "교환은 수령 후 신청할 수 있습니다.",
  );
  const at = input.at || new Date().toISOString();
  if (o.shipment.deliveredAt && kind !== "cancel") {
    const receipt = o.shipment.deliveredAt;
    if (simple(reason)) {
      const start = [koreanDay(receipt), koreanDay(o.contractAt || o.date)]
        .sort()
        .at(-1);
      check(
        daysBetween(start, at) <= 7,
        "단순 변심 접수 기간이 지났습니다. 기산일 이의는 주문 상담으로 접수해 주세요.",
      );
    } else {
      const discovery = input.discoveredAt || at;
      check(
        koreanDay(discovery) >= koreanDay(receipt) &&
          daysBetween(discovery, at) >= 0 &&
          daysBetween(discovery, at) <= 30 &&
          koreanDay(at) <= threeMonths(koreanDay(receipt)),
        "수령일·불일치 발견일과 신청 기간을 확인해 주세요. 이의가 있으면 주문 상담을 이용해 주세요.",
      );
    }
  }
  const l = o.lines.find((l) => l.id === lineId);
  const first = l.qty - availableQty(o, lineId),
    discount = sum(l.unitDiscounts.slice(first, first + qty));
  const fare =
    kind === "cancel" && sum(shippingLines(o).map((l) => l.qty)) === qty
      ? o.fare
      : 0;
  const fee = returnFee(kind, reason);
  const paid = l.price * qty - discount;
  return {
    lineId,
    qty,
    kind,
    reason,
    discount,
    fare,
    fee,
    paid,
    amount: kind === "exchange" ? 0 : Math.max(0, paid + fare - fee),
  };
}

export function openClaim(db, id, input) {
  const [next, o] = changed(db, id);
  check(input.id, "접수번호가 필요합니다.");
  const old = o.claims.find((c) => c.id === input.id);
  if (old) {
    check(
      old.lineId === input.lineId &&
        old.qty === input.qty &&
        old.requestKind === input.kind &&
        old.requestReason === input.reason,
      "동일한 접수번호의 신청 내용이 다릅니다.",
    );
    return db;
  }
  const at = when(db);
  const reroute = input.kind === "cancel" && afterHandoff(o);
  const c = {
    ...estimateClaim(o, {
      ...input,
      kind: reroute ? "return" : input.kind,
      at,
    }),
    id: input.id,
    requestKind: input.kind,
    requestReason: input.reason,
    createdAt: at,
    status: "requested",
    pickupAddress: input.pickupAddress || o.delivery.address,
    notes: input.notes || "",
    discoveredAt: input.discoveredAt || null,
    history: [],
  };
  if (c.kind === "cancel") {
    shiftStock(next, [{ id: c.lineId, qty: c.qty }], 1);
    c.dueAt = businessDue(at, db.holidays);
  }
  stamp(c, at, reroute ? "인계 선행 · 원신청을 회수로 접수" : "품목 신청 접수");
  stamp(
    o,
    at,
    c.id +
      " · " +
      { cancel: "출고 중지", return: "반품 접수", exchange: "교환 접수" }[
        c.kind
      ],
  );
  o.claims.push(c);
  if (!shippingLines(o).length) o.stage = "취소 접수";
  return next;
}

export function claimAction(db, id, claimId, action, opts = {}) {
  const [next, o] = changed(db, id),
    c = o.claims.find((c) => c.id === claimId),
    at = when(db);
  check(c, "접수 건을 찾을 수 없습니다.");
  const requireStatus = (...states) =>
    check(
      states.includes(c.status),
      "신청 상태가 변경되었습니다. 최신 처리 내역을 확인해 주세요.",
    );
  let label;
  switch (action) {
    case "collect":
      if (c.collectionTracking === opts.tracking && c.status !== "requested")
        return db;
      requireStatus("requested");
      check(c.kind !== "cancel", "출고 전 취소에는 회수가 필요하지 않습니다.");
      check(
        opts.tracking && !trackingUsed(db, opts.tracking),
        "다른 운송장과 구분되는 회수 운송장을 입력해 주세요.",
      );
      c.collectionTracking = opts.tracking;
      c.status = "collecting";
      label = "회수 접수";
      break;
    case "visitFailed":
    case "reschedule":
    case "pickup": {
      requireStatus("collecting");
      if (opts.tracking && opts.tracking !== c.collectionTracking) {
        label = "회수 운송장 귀속 불일치 · 조사 필요";
        break;
      }
      if (action === c.visit || c.visit === "pickup") return db;
      if (action === "reschedule")
        check(
          c.visit === "visitFailed",
          "먼저 방문 실패 사유를 확인해 주세요.",
        );
      c.visit = action;
      c.visitNote = opts.note || "";
      label = {
        visitFailed: "회수 방문 실패",
        reschedule: "재방문 일정 조정",
        pickup: "택배 수거 확인",
      }[action];
      if (c.visitNote) label += " · " + c.visitNote;
      break;
    }
    case "receive": {
      const n = opts.receivedQty;
      if (c.receivedQty === n && ["received", "review"].includes(c.status))
        return db;
      requireStatus("collecting", "review");
      check(
        quantity(n, 0) && n <= c.qty && n >= (c.receivedQty || 0),
        "실제 입고한 누적 수량을 확인해 주세요.",
      );
      c.receivedQty = n;
      c.receiveNote = opts.note || "";
      if (n > 0 && !c.receivedAt) {
        const physicalAt = opts.receivedAt || at;
        check(
          Number.isFinite(Date.parse(physicalAt)) &&
            koreanDay(physicalAt) <= koreanDay(at) &&
            koreanDay(physicalAt) >= koreanDay(c.createdAt),
          "실제 입고일을 확인해 주세요.",
        );
        c.receivedAt = physicalAt;
        c.dueAt = businessDue(physicalAt, db.holidays);
      }
      c.status = n === c.qty ? "received" : "review";
      label = n === c.qty ? "판매자 입고" : "회수 수량 불일치 · 조사 필요";
      break;
    }
    case "inspect": {
      if (c.status === "inspected" && c.goodQty === opts.goodQty) return db;
      requireStatus("received");
      check(
        quantity(opts.goodQty, 0) && opts.goodQty <= c.receivedQty,
        "판매 가능한 양품 수량을 확인해 주세요.",
      );
      c.goodQty = opts.goodQty;
      c.note = opts.note || "";
      c.reason = opts.reason || c.reason;
      c.fee = returnFee(c.kind, c.reason);
      c.amount =
        c.kind === "exchange" ? 0 : Math.max(0, c.paid + c.fare - c.fee);
      shiftStock(next, [{ id: c.lineId, qty: c.goodQty }], 1);
      c.status = "inspected";
      c.damagedQty = c.receivedQty - c.goodQty;
      label =
        "검수 완료 · 양품 " +
        c.goodQty +
        "개, 판매 제외 " +
        c.damagedQty +
        "개";
      if (c.note) label += " · " + c.note;
      break;
    }
    case "refund": {
      if (["refundPending", "refunded"].includes(c.status)) return db;
      requireStatus(c.kind === "cancel" ? "requested" : "inspected");
      check(
        c.kind !== "exchange",
        "교환품을 확보하거나 고객의 환불 전환 선택을 확인해 주세요.",
      );
      const pending = sum(
        o.claims
          .filter(
            (cl) =>
              cl.status === "refundPending" ||
              (cl.status === "refunded" &&
                cl.pgConfirmedAt &&
                !cl.orderPostedAt),
          )
          .map((cl) => cl.amount),
      );
      check(
        c.amount <= o.total - o.refunded - pending,
        "환불 가능 잔액을 초과합니다. 원거래와 선행 환불을 확인해 주세요.",
      );
      c.status = "refundPending";
      c.refundId = "REF-" + c.id;
      c.refundRequestedAt = at;
      label = "원거래 취소 요청 · 결과 확인 중";
      break;
    }
    case "reconcile":
      if (c.status === "refunded" || (c.pgConfirmedAt && opts.defer)) return db;
      requireStatus("refundPending");
      if (
        (opts.amount != null && opts.amount !== c.amount) ||
        (opts.reference && opts.reference !== c.refundId)
      ) {
        c.discrepancy = true;
        label = "원거래 환불 금액·거래번호 불일치";
        break;
      }
      c.discrepancy = false;
      c.pgConfirmedAt ||= at;
      label = "원거래 취소 확정 · 후속 반영 대기";
      if (opts.defer) break;
      stamp(c, at, label);
      stamp(o, at, c.id + " · " + label);
      return ["replayClaim", "replayOrder", "replayNotice"].reduce(
        (result, step) => claimAction(result, id, claimId, step),
        next,
      );
    case "replayClaim":
      if (c.status === "refunded") return db;
      check(
        c.pgConfirmedAt && c.status === "refundPending",
        "먼저 PG의 원거래 취소 확인이 필요합니다.",
      );
      c.status = "refunded";
      c.refundedAt = at;
      label = "구매후처리 환불 종결";
      break;
    case "replayOrder":
      requireStatus("refunded");
      if (c.orderPostedAt || !c.pgConfirmedAt) return db;
      c.orderPostedAt = at;
      o.refunded += c.amount;
      if (!shippingLines(o).length && o.refunded === o.total)
        o.stage = "환불 완료";
      label = "주문 품목 환불 반영";
      break;
    case "replayNotice":
      requireStatus("refunded");
      if (c.noticeReadyAt || !c.pgConfirmedAt) return db;
      c.noticeReadyAt = at;
      label = "환불 완료 알림 의뢰";
      break;
    case "replace":
      if (c.status === "allocated") return db;
      requireStatus("inspected", "waiting");
      check(c.kind === "exchange", "교환 신청을 확인해 주세요.");
      if ((item(next, c.lineId)?.stock || 0) < c.qty) {
        if (c.status === "waiting") return db;
        c.status = "waiting";
        label = "동일 옵션 품절 · 고객 선택 대기";
        break;
      }
      shiftStock(next, [{ id: c.lineId, qty: c.qty }], -1);
      c.status = "allocated";
      label = "동일 옵션 교환 수량 확보";
      break;
    case "convert":
      requireStatus("waiting");
      c.kind = "return";
      c.fee = returnFee(c.kind, c.reason);
      c.amount = Math.max(0, c.paid - c.fee);
      c.status = "inspected";
      label = "구매자 환불 전환 선택";
      break;
    case "repack":
      if (c.tracking === opts.tracking && c.status === "replacementTransit")
        return db;
      requireStatus("allocated");
      check(
        opts.tracking && !trackingUsed(db, opts.tracking),
        "원출고·회수와 다른 교환 운송장을 입력해 주세요.",
      );
      c.tracking = opts.tracking;
      c.carrier = opts.carrier || "예시택배";
      c.status = "replacementTransit";
      label = "교환품 발송";
      break;
    case "redeliver":
      if (c.status === "replaced") return db;
      requireStatus("replacementTransit");
      check(
        !opts.tracking || opts.tracking === c.tracking,
        "교환품 운송장을 확인해 주세요.",
      );
      c.status = "replaced";
      c.deliveredAt = at;
      label = "교환품 배송완료";
      break;
    default:
      throw new Error("지원하지 않는 신청 처리입니다.");
  }
  stamp(c, at, label);
  stamp(o, at, c.id + " · " + label);
  return next;
}

// Preserve previously stored whole-order operations as claimed quantities; never release them again.
export function upgradeOrder(old) {
  if (old.payment && old.shipment && Array.isArray(old.claims)) return old;
  const discount = old.discount || 0,
    fare = old.fare || 0;
  const allocations = allocateDiscount(old.lines, discount);
  const lines = old.lines.map((l, i) => ({
    ...l,
    unitDiscounts: allocations[i],
  }));
  const subtotal = sum(lines.map((l) => l.price * l.qty)),
    total = subtotal + fare - discount;
  const at = old.date,
    stage = old.stage || "결제완료";
  const refund = stage === "환불 완료",
    exchange = stage.includes("교환"),
    returned = stage.includes("반품");
  const delivered =
    stage === "배송완료" || returned || exchange || (refund && old.tracking);
  const o = {
    ...old,
    memberId: old.member ? old.memberId || "demo" : null,
    contact: old.contact || old.delivery?.phone,
    lines,
    subtotal,
    fare,
    discount,
    total,
    payment: "paid",
    paymentId: "PAY-" + old.id,
    paidAt: at,
    supplyDueAt: businessDue(at),
    contractAt: at,
    history: [{ at, label: "이전 주문 기록 · " + stage }],
    refunded: refund ? total : 0,
    claims: [],
    shipment: {
      status: delivered
        ? "delivered"
        : stage === "배송 중"
          ? "transit"
          : "ready",
      tracking: old.tracking || "",
      lines: [],
      deliveredAt: delivered ? at : null,
    },
  };
  if (afterHandoff(o)) o.shipment.lines = ordered(o);
  if (refund || exchange || returned || stage.includes("취소")) {
    o.claims = lines.map((l, i) => {
      const kind = exchange
        ? "exchange"
        : returned || (refund && delivered)
          ? "return"
          : "cancel";
      const paid = l.price * l.qty - sum(l.unitDiscounts);
      const initialFare =
        i === lines.length - 1 && (refund || kind === "cancel") ? fare : 0;
      const reason = old.reason || "이전 주문 신청";
      const fee = refund ? 0 : returnFee(kind, reason);
      return {
        id: old.id + "-L" + (i + 1),
        lineId: l.id,
        qty: l.qty,
        kind,
        reason,
        requestKind: kind,
        requestReason: reason,
        createdAt: at,
        status: refund
          ? "refunded"
          : stage === "교환품 발송"
            ? "replacementTransit"
            : "requested",
        paid,
        discount: sum(l.unitDiscounts),
        fee,
        amount: kind === "exchange" ? 0 : Math.max(0, paid + initialFare - fee),
        fare: initialFare,
        history: [{ at, label: stage }],
        dueAt: kind === "cancel" ? businessDue(at) : null,
        tracking: stage === "교환품 발송" ? old.tracking : null,
      };
    });
  }
  return o;
}
