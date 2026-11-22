import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveDisplay, pruneDisplayHistory } from "../src/display-history.js";

test("이전 표시본은 한국시간 월말 기준 6개월 후 만료되고 주문과 이후 노출본은 유지된다", () => {
  const product = {
    id: "towel",
    sku: "TW-01",
    price: 12000,
    version: 1,
    photo: "towel",
    active: true,
    material: "면 100%",
  };
  const order = { id: "OM-01", lines: [{ ...product, qty: 1 }], fare: 3000 };
  let db = { products: [product], orders: [order] };
  const ends = "2026-08-30T15:00:00.000Z"; // 8월 31일 00시
  db = archiveDisplay(db, product, ends);
  const newProduct = { ...product, price: 14000, version: 2 };
  db = { ...db, products: [newProduct] };
  db = archiveDisplay(db, newProduct, "2026-09-01T00:00:00.000Z");
  const expiry = "2027-02-27T15:00:00.000Z"; // 2월 28일 00시
  assert.equal(db.displayHistory[1].expiresAt, expiry);
  assert.equal(db.displayHistory[0].startedAt, ends);
  assert.equal(db.displayHistory[1].price, 12000);
  assert.equal(db.displayHistory[1].policy.baseFare, 3000);
  assert.equal(
    pruneDisplayHistory(db, Date.parse(expiry) - 1).displayHistory.length,
    2,
  );
  const purged = pruneDisplayHistory(db, expiry);
  assert.equal(purged.displayHistory.length, 1);
  assert.equal(purged.displayHistory[0].version, 2);
  assert.equal(purged.products[0], newProduct);
  assert.equal(purged.orders[0], order);
  assert.equal(pruneDisplayHistory(purged, expiry).purgedDisplays, 1);
  assert.equal(archiveDisplay(db, { ...product, active: false }, ends), db);
});
