import { shippingPolicy } from "./delivery-policy.js";

// End of the six-month exposure-record period, clamped to the last day of the
// target month. Do the month arithmetic in Korean local time (UTC+9).
function expiresAt(at) {
  const offset = 9 * 60 * 60 * 1000;
  const day = new Date(Date.parse(at) + offset);
  const original = day.getUTCDate();
  day.setUTCDate(1);
  day.setUTCMonth(day.getUTCMonth() + 7, 0);
  day.setUTCDate(Math.min(original, day.getUTCDate()));
  return new Date(day.getTime() - offset).toISOString();
}

export function archiveDisplay(db, p, endedAt, policy = shippingPolicy(db)) {
  if (!p || p.active === false) return db;
  const at = new Date(endedAt).toISOString();
  const {
    id,
    name,
    brand,
    category,
    option,
    sku,
    version,
    price,
    photo,
    material,
    origin,
    care,
    description,
  } = p;
  const entry = {
    id: crypto.randomUUID(),
    productId: id,
    sku: sku || id,
    name,
    brand,
    category,
    option,
    version,
    price,
    photo,
    material,
    origin,
    care,
    description,
    policy: structuredClone(policy),
    supply:
      "국내 택배 · 별도 약정이 없는 선지급 거래는 지급일부터 3영업일 내 공급 조치",
    returns:
      "단순변심은 수령 후 7일 · 불일치는 공급 후 3개월 및 발견 후 30일 · 단순변심 회수비는 구매자, 하자·오배송은 판매자 부담",
    startedAt: db.displayStarted?.[id] || null,
    endedAt: at,
    expiresAt: expiresAt(at),
  };
  return {
    ...db,
    displayHistory: [entry, ...(db.displayHistory || [])],
    displayStarted: { ...db.displayStarted, [id]: at },
  };
}

export function pruneDisplayHistory(db, at) {
  const previous = db.displayHistory || [];
  const keep = previous.filter(
    (row) => Date.parse(row.expiresAt) > new Date(at).getTime(),
  );
  return {
    ...db,
    displayHistory: keep,
    purgedDisplays: (db.purgedDisplays || 0) + previous.length - keep.length,
  };
}
