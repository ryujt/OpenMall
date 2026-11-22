import test from "node:test";
import assert from "node:assert/strict";
import {
  quote,
  createOrder,
  payOrder,
  shipOrder,
  estimateClaim,
  openClaim,
  claimAction,
  businessDue,
  upgradeOrder,
  availableQty,
  paymentNotice,
  couponAvailable,
} from "../src/commerce.js";

function warehouse(prices = [20000, 10000], stocks = [2, 1]) {
  return {
    clock: "2026-11-20T10:00:00+09:00",
    holidays: ["2026-11-23"],
    products: prices.map((price, i) => ({
      id: "sku" + i,
      price,
      name: "상품 " + i,
      stock: stocks[i],
    })),
    orders: [],
    cart: {},
    member: true,
    memberId: "buyer",
  };
}
function form(db, qty = [2, 1], discount = 5000, id = "O") {
  const lines = qty
    .map((n, i) => ({ id: "sku" + i, qty: n }))
    .filter((l) => l.qty);
  const input = {
    id,
    lines,
    zone: "base",
    discount,
    member: true,
    ownerId: db.memberId,
    contact: "주문 연락처",
    delivery: { name: "수취인", address: "시험 주소", phone: "수취인 연락처" },
    source: "cart",
    method: "카드",
  };
  return { ...input, signature: quote(db, input).signature };
}
function paid(db = warehouse(), qty, discount) {
  return payOrder(createOrder(db, form(db, qty, discount)), "O", "approved");
}
function handed(db) {
  return shipOrder(
    shipOrder(db, "O", "pack", { tracking: "W1" }),
    "O",
    "handoff",
  );
}
function delivered(db) {
  return shipOrder(handed(db), "O", "deliver", { tracking: "W1" });
}
const request = (kind = "cancel", lineId = "sku0", qty = 1, id = "C") => ({
  id,
  kind,
  lineId,
  qty,
  reason: "상품 하자",
});
const act = (db, action, opts = {}) => claimAction(db, "O", "C", action, opts);
const claim = (db) => db.orders[0].claims[0];

test("X01 stale quotation, atomic last units, retransmission and aborted reception", () => {
  const db = warehouse(),
    old = form(db);
  db.products[0].price++;
  assert.throws(() => createOrder(db, old), /견적/);
  const a = form(db);
  const b = form(db, [0, 1], 0, "B");
  const won = createOrder(db, b);
  assert.throws(() => createOrder(won, a), /재고/);
  assert.equal(won.products[0].stock, 2);
  let first = createOrder(db, a);
  assert.equal(couponAvailable(first), false);
  assert.equal(createOrder(first, a), first);
  assert.throws(
    () => createOrder(first, { ...a, method: "간편결제" }),
    /다른 요청/,
  );
  first.orders[0].receptionPending = true;
  assert.throws(() => payOrder(first, "O", "approved"), /접수 결과/);
  const stopped = payOrder(first, "O", "cancel");
  assert.deepEqual(
    stopped.products.map((p) => p.stock),
    [2, 1],
  );
  assert.equal(couponAvailable(stopped), true);
  assert.equal(createOrder(stopped, a), stopped);
  assert.equal(payOrder(stopped, "O", "cancel"), stopped);
});
test("inconclusive PG holds inventory, invalid notice is isolated, late approval compensates once", () => {
  const db = warehouse();
  let hold = createOrder(db, form(db));
  const notice = {
    verified: true,
    orderId: "O",
    paymentId: "PAY-O",
    amount: 48000,
    outcome: "approved",
  };
  const bad = paymentNotice(hold, "O", { ...notice, verified: false });
  assert.equal(bad.orders[0].payment, "ready");
  assert.equal(
    paymentNotice(bad, "O", { ...notice, orderId: "B" }).orders[0].payment,
    "pending",
  );
  assert.equal(paymentNotice(bad, "O", notice).orders[0].payment, "paid");
  hold = payOrder(hold, "O", "pending");
  assert.throws(() => payOrder(hold, "O", "cancel"), /원거래/);
  assert.throws(() => shipOrder(hold, "O", "pack", { tracking: "W1" }), /승인/);
  let closed = payOrder(hold, "O", "expired");
  closed = payOrder(closed, "O", "approved");
  assert.equal(closed.orders[0].payment, "compensating");
  closed = payOrder(closed, "O", "compensated");
  assert.equal(closed.orders[0].refunded, 48000);
  assert.deepEqual(
    closed.products.map((p) => p.stock),
    [2, 1],
  );
  assert.equal(payOrder(closed, "O", "approved"), closed);
});
test("X02 stale packed manifest blocked; race after handoff preserves collection route", () => {
  let packed = shipOrder(paid(), "O", "pack", { tracking: "W1" });
  const stopped = openClaim(packed, "O", request());
  assert.equal(openClaim(stopped, "O", request()), stopped);
  assert.throws(() => shipOrder(stopped, "O", "handoff"), /재포장/);
  const partial = shipOrder(
    shipOrder(stopped, "O", "pack", { tracking: "W1" }),
    "O",
    "handoff",
  );
  assert.deepEqual(partial.orders[0].shipment.lines, [
    { id: "sku0", qty: 1 },
    { id: "sku1", qty: 1 },
  ]);
  assert.equal(partial.products[0].stock, 1);
  const transit = shipOrder(packed, "O", "handoff");
  assert.equal(shipOrder(transit, "O", "handoff"), transit);
  const rerouted = openClaim(transit, "O", request());
  assert.equal(claim(rerouted).kind, "return");
  assert.equal(rerouted.products[0].stock, 0);
  assert.throws(() => act(rerouted, "refund"), /상태/);
});
test("X03 same PG refund across response loss, duplicate, amount mismatch and late approval", () => {
  let db = openClaim(delivered(paid()), "O", request("return"));
  db = act(db, "collect", { tracking: "W2" });
  assert.equal(db.orders[0].refunded, 0);
  db = act(db, "receive", { receivedQty: 1 });
  assert.equal(claim(db).dueAt, "2026-11-26");
  db = act(db, "inspect", { goodQty: 0, note: "하자" });
  db = act(db, "refund");
  assert.equal(claim(db).amount, 18000);
  assert.equal(db.products[0].stock, 0);
  assert.equal(act(db, "refund"), db);
  db = act(db, "reconcile", { amount: 17000 });
  assert.equal(db.orders[0].refunded, 0);
  db = act(db, "reconcile", { amount: 18000, reference: "REF-C" });
  assert.equal(db.orders[0].total - db.orders[0].refunded, 30000);
  assert.equal(act(db, "reconcile"), db);
  assert.equal(payOrder(db, "O", "approved"), db);
});
test("X04 separate collection and replacement evidence; fallback requires buyer consent", () => {
  let db = openClaim(delivered(paid()), "O", request("exchange"));
  db = act(db, "collect", { tracking: "W2" });
  db = act(db, "visitFailed", { note: "부재" });
  db = act(db, "reschedule", { note: "재방문" });
  const incorrect = act(db, "pickup", { tracking: "WRONG" });
  assert.equal(claim(incorrect).visit, "reschedule");
  db = act(incorrect, "pickup", { tracking: "W2" });
  db = act(db, "receive", { receivedQty: 1 });
  const waiting = act(act(db, "inspect", { goodQty: 0 }), "replace");
  assert.equal(claim(waiting).status, "waiting");
  assert.throws(() => act(waiting, "refund"), /상태/);
  const converted = act(waiting, "convert");
  assert.equal(claim(act(converted, "refund")).amount, 18000);
  const allocated = act(act(db, "inspect", { goodQty: 1 }), "replace");
  assert.throws(() => act(allocated, "repack", { tracking: "W1" }), /운송장/);
  const shipped = act(allocated, "repack", { tracking: "W3" });
  assert.equal(shipOrder(shipped, "O", "deliver", { tracking: "W1" }), shipped);
  assert.throws(() => act(shipped, "redeliver", { tracking: "W1" }), /운송장/);
  assert.equal(
    claim(act(shipped, "redeliver", { tracking: "W3" })).status,
    "replaced",
  );
});
test("X05 one won allocation preserved in both cancellation sequences", () => {
  for (const [sequence, expected] of [
    [
      [0, 2, 1],
      [9667, 9668, 12668],
    ],
    [
      [2, 1, 0],
      [9668, 9668, 12667],
    ],
  ]) {
    let db = paid(warehouse([10001, 10001, 10001], [1, 1, 1]), [1, 1, 1], 1000);
    const amounts = [];
    for (const i of sequence) {
      const c = request("cancel", "sku" + i, 1, "C" + i);
      db = openClaim(db, "O", c);
      amounts.push(db.orders[0].claims.at(-1).amount);
      db = claimAction(db, "O", c.id, "refund");
      db = claimAction(db, "O", c.id, "reconcile");
    }
    assert.deepEqual(amounts, expected);
    assert.equal(db.orders[0].refunded, 32003);
  }
});
test("return eligibility follows actual delivery, customer cause, discovery and business calendar", () => {
  const db = delivered(paid()),
    o = db.orders[0];
  const estimate = (input) =>
    estimateClaim(o, { ...request("return"), ...input });
  assert.equal(
    estimate({ reason: "단순변심", at: "2026-11-27T23:59:59+09:00" }).fee,
    3000,
  );
  assert.throws(
    () => estimate({ reason: "단순변심", at: "2026-11-28T00:00:00+09:00" }),
    /기간/,
  );
  assert.equal(
    estimate({ discoveredAt: "2026-12-05", at: "2026-12-05" }).fee,
    0,
  );
  assert.throws(
    () => estimate({ discoveredAt: "2026-11-20", at: "2026-12-21" }),
    /발견일/,
  );
  assert.equal(
    businessDue("2026-11-20T23:59:59+09:00", ["2026-11-23"]),
    "2026-11-26",
  );
  let partial = openClaim(db, "O", request("return", "sku0", 2));
  partial = act(partial, "collect", { tracking: "W2" });
  partial.clock = "2026-11-25T12:00:00+09:00";
  partial = act(partial, "receive", {
    receivedQty: 1,
    receivedAt: "2026-11-20T22:00:00+09:00",
  });
  assert.equal(claim(partial).status, "review");
  assert.equal(claim(partial).dueAt, "2026-11-26");
  assert.throws(() => act(partial, "inspect", { goodQty: 2 }), /상태/);
  assert.equal(availableQty(partial.orders[0], "sku0"), 0);
  assert.equal(
    claim(act(partial, "receive", { receivedQty: 2 })).dueAt,
    "2026-11-26",
  );
});
test("legacy whole-order refund cannot be claimed or refunded a second time", () => {
  const migrated = upgradeOrder({
    id: "old",
    member: true,
    stage: "환불 완료",
    date: "2026-11-20",
    fare: 3000,
    discount: 0,
    lines: [{ id: "A", qty: 1, price: 1234 }],
  });
  assert.equal(migrated.memberId, "demo");
  assert.equal(migrated.refunded, 4234);
  assert.equal(availableQty(migrated, "A"), 0);
  assert.equal(upgradeOrder(migrated), migrated);
});

test("WK01 restart expiry after stock release without releasing another reservation twice", async () => {
  const { expireReservation, recoverOrder } =
    await import("../src/commerce.js");
  const db = warehouse(),
    input = { ...form(db), receptionPending: true };
  const pending = createOrder(db, input);
  assert.equal(pending.orders[0].paymentId, null);
  const stopped = payOrder(pending, "O", "cancel");
  assert.equal(payOrder(stopped, "O", "approved"), stopped);
  assert.equal(recoverOrder(stopped, "O"), stopped);
  const opened = recoverOrder(pending, "O");
  assert.equal(opened.orders[0].paymentId, "PAY-O");
  assert.equal(recoverOrder(opened, "O"), opened);
  const future = { ...opened, clock: "2026-11-20T11:00:00+09:00" };
  assert.throws(
    () => expireReservation(future, "O", { pgClosed: false }),
    /PG/,
  );
  const confirmed = expireReservation(future, "O", {
    pgClosed: true,
    stopAfter: "order",
  });
  assert.deepEqual(
    confirmed.products.map((p) => p.stock),
    [0, 0],
  );
  assert.equal(couponAvailable(confirmed), false);
  const stock = expireReservation(confirmed, "O", { stopAfter: "stock" });
  assert.deepEqual(
    stock.products.map((p) => p.stock),
    [2, 1],
  );
  assert.equal(couponAvailable(stock), false);
  const done = expireReservation(stock, "O", {});
  assert.equal(expireReservation(done, "O", {}), done);
  assert.equal(couponAvailable(done), true);
});
test("WK04 restart after ledger and after either subscriber without duplicating PG or notice", () => {
  let db = openClaim(paid(), "O", request());
  db = act(db, "refund");
  const ledger = act(db, "reconcile", { defer: true });
  assert.equal(claim(ledger).pgConfirmedAt, "2026-11-20T01:00:00.000Z");
  assert.equal(claim(ledger).status, "refundPending");
  assert.equal(ledger.orders[0].refunded, 0);
  assert.equal(act(ledger, "reconcile", { defer: true }), ledger);
  for (const steps of [
    ["replayNotice", "replayOrder"],
    ["replayOrder", "replayNotice"],
  ]) {
    let progress = act(ledger, "replayClaim");
    assert.equal(claim(progress).status, "refunded");
    for (const step of steps) {
      progress = act(progress, step);
      assert.equal(act(progress, step), progress);
    }
    assert.equal(progress.orders[0].refunded, 18000);
    assert.equal(
      claim(progress).history.filter((e) => e.label === "환불 완료 알림 의뢰")
        .length,
      1,
    );
    assert.equal(
      claim(progress).history.filter((e) =>
        e.label.includes("원거래 취소 확정"),
      ).length,
      1,
    );
  }
});
test("PG prepayment supply due day, owner change and changed address under the same submit key", () => {
  const db = warehouse(),
    f = form(db);
  const next = createOrder(db, f);
  assert.throws(
    () =>
      createOrder(next, {
        ...f,
        delivery: { ...f.delivery, detail: "다른 상세주소" },
      }),
    /다른 요청/,
  );
  assert.throws(() => createOrder({ ...db, memberId: "other" }, f), /계정/);
  assert.equal(
    payOrder(next, "O", "approved").orders[0].supplyDueAt,
    "2026-11-26",
  );
});

test("cart ownership, one member coupon, immutable contract and strict coupon threshold", () => {
  const db = warehouse(),
    args = form(db),
    reserved = createOrder({ ...db, cart: { sku0: 3, sku1: 1 } }, args);
  assert.deepEqual(reserved.cart, { sku0: 1 });
  assert.equal(couponAvailable(reserved), false);
  const other = { ...reserved, memberId: "second", cart: { sku1: 3 } };
  assert.equal(couponAvailable(other), true);
  const reconciled = payOrder(other, "O", "approved");
  assert.deepEqual(reconciled.cart, { sku1: 3 });
  assert.equal(reconciled.orders[0].memberId, "buyer");
  reconciled.products[0].price += 100;
  assert.equal(reconciled.orders[0].lines[0].price, 20000);
  for (const price of [4999, 5000, 5001]) {
    const one = warehouse([price], [1]);
    if (price <= 5000) assert.throws(() => form(one, [1], 5000), /쿠폰/);
    else
      assert.equal(
        createOrder(one, form(one, [1], 5000)).orders[0].total,
        3001,
      );
  }
});
test("handoff held after physical mismatch and corrected delivery determine actual receipt date", () => {
  const departed = handed(paid()),
    held = shipOrder(departed, "O", "hold", { note: "창고 실물 상자 확인" });
  assert.throws(() => shipOrder(held, "O", "deliver"), /보류/);
  const resumed = shipOrder(held, "O", "resume", {
    note: "같은 상자를 기사에게 전달",
  });
  assert.equal(shipOrder(resumed, "O", "handoff"), resumed);
  const scan = shipOrder(resumed, "O", "deliver");
  const correction = shipOrder(scan, "O", "correct", {
    note: "원기사 오스캔 서면 확인",
  });
  assert.equal(correction.orders[0].shipment.status, "transit");
  correction.clock = "2026-12-01T09:00:00+09:00";
  const actual = shipOrder(correction, "O", "deliver");
  assert.equal(
    estimateClaim(actual.orders[0], {
      ...request("return"),
      reason: "단순변심",
      at: "2026-12-08T22:00:00+09:00",
    }).fee,
    3000,
  );
});

test("delivery policy snapshot requires consent again for a version-only cutoff change and new postcode fare", () => {
  const db = warehouse();
  db.shippingPolicy = {
    version: 4,
    baseFare: 3000,
    islandFare: 6500,
    blockedPrefixes: ["00000"],
    islandPrefixes: ["63"],
    cutoff: "15:00",
  };
  const old = form(db);
  old.delivery.zip = "03925";
  db.shippingPolicy = { ...db.shippingPolicy, version: 5, cutoff: "13:00" };
  assert.throws(() => createOrder(db, old), /견적이 변경/);
  const renewed = form(db);
  renewed.delivery.zip = "03925";
  const original = createOrder(db, renewed).orders[0];
  db.shippingPolicy.islandPrefixes.push("039");
  assert.equal(original.shippingPolicy.version, 5);
  assert.equal(original.shippingPolicy.cutoff, "13:00");
  assert.deepEqual(original.shippingPolicy.islandPrefixes, ["63"]);
  assert.throws(() => createOrder(db, renewed), /견적이 변경/);
  const revised = { ...renewed, zone: "island" };
  const updated = createOrder(db, {
    ...revised,
    signature: quote(db, revised).signature,
  }).orders[0];
  assert.equal(updated.fare, 6500);
  assert.equal(original.fare, 3000);
});
test("X02 10,000 won times two, zero original fare, single coupon, one partial refund and one unit in transit", () => {
  let db = warehouse([10000], [2]);
  db.shippingPolicy = {
    version: 2,
    baseFare: 0,
    islandFare: 3000,
    blockedPrefixes: ["00000"],
    islandPrefixes: ["63"],
    cutoff: "15:00",
  };
  db = paid(db, [2], 2000);
  assert.equal(db.orders[0].total, 18000);
  assert.equal(db.orders[0].fare, 0);
  db = shipOrder(db, "O", "pack", { tracking: "X02" });
  db = openClaim(db, "O", request());
  db = act(act(db, "refund"), "reconcile");
  assert.equal(db.orders[0].refunded, 9000);
  assert.throws(() => shipOrder(db, "O", "handoff"), /재포장/);
  db = shipOrder(
    shipOrder(db, "O", "pack", { tracking: "X02" }),
    "O",
    "handoff",
  );
  assert.equal(db.orders[0].total - db.orders[0].refunded, 9000);
  assert.deepEqual(db.orders[0].shipment.lines, [{ id: "sku0", qty: 1 }]);
  assert.equal(db.products[0].stock, 1);
});
