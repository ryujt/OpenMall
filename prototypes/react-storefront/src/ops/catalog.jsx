import { archiveDisplay } from "../display-history";
import React, { useState } from "react";
import { input, sku, ensure, Field, Note, date } from "./shared";
import { money } from "../model";
import { shippingLines } from "../commerce";

const textField = (value) => String(value || "").trim();
function orderQty(order, id) {
  return (order.lines || []).find((line) => line.id === id)?.qty || 0;
}
function stockCounts(db, p) {
  let reserved = 0,
    allocated = 0;
  for (const o of db.orders) {
    if (["ready", "pending"].includes(o.payment) || o.release?.stock === false)
      reserved += orderQty(o, p.id);
    if (
      o.payment === "paid" &&
      !["transit", "delivered"].includes(o.shipment?.status)
    )
      allocated += shippingLines(o).find((l) => l.id === p.id)?.qty || 0;
    allocated += (o.claims || [])
      .filter((c) => c.lineId === p.id && c.status === "allocated")
      .reduce((n, c) => n + c.qty, 0);
  }
  return { reserved, allocated, physical: p.stock + reserved + allocated };
}
function ProductEdit({ products, original, run, close }) {
  const [category, setCategory] = useState(original?.category || "패브릭");
  const p = original || {};
  function save(e) {
    e.preventDefault();
    const f = input(e.currentTarget);
    run(
      "product",
      "상품 정보 저장",
      f.sku,
      f.note,
      (db) => {
        const current = db.products.find((x) => x.id === p.id);
        ensure(
          !original || (current && (current.version || 0) === (p.version || 0)),
          "다른 변경이 먼저 저장되었습니다. 편집을 닫고 최신 상품을 다시 여세요.",
        );
        const code = f.sku.trim().toUpperCase();
        ensure(
          code &&
            !db.products.some(
              (x) => sku(x).toUpperCase() === code && x.id !== p.id,
            ),
          "이미 사용 중인 옵션 코드입니다.",
        );
        const id = p.id || crypto.randomUUID();
        const fields = [
          "name",
          "brand",
          "material",
          "origin",
          "care",
          "option",
          "description",
        ];
        ensure(
          fields.every((k) => textField(f[k])),
          "필수 고시와 상품 정보를 입력하세요.",
        );
        const row = {
          ...current,
          ...Object.fromEntries(fields.map((k) => [k, f[k].trim()])),
          sku: code,
          id,
          groupId: f.groupId || p.groupId || id,
          category,
          photo: f.photo,
          price: Number(f.price),
          active: f.active === "yes",
          stock: current?.stock || 0,
          version: (current?.version || 0) + 1,
        };
        const at = db.clock || new Date().toISOString();
        const archived = archiveDisplay(db, current, at);
        const displayStarted = { ...archived.displayStarted };
        if (row.active) displayStarted[id] = at;
        else delete displayStarted[id];
        return {
          ...archived,
          displayStarted,
          products: current
            ? db.products.map((x) => (x.id === id ? row : x))
            : [...db.products, row],
        };
      },
      close,
      (original ? money(p.price) : "신규") +
        " → " +
        money(Number(f.price)) +
        " · " +
        (f.active === "yes" ? "판매중" : "판매중지"),
    );
  }
  return (
    <form className="ops-box" onSubmit={save}>
      <h3>{original ? "상품 정보 수정" : "새 상품·옵션 등록"}</h3>
      <div className="ops-grid">
        <Field title="상품명" name="name" value={p.name} />
        <Field title="브랜드" name="brand" value={p.brand} />
        <label>
          품목
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["패브릭", "키친", "배스"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          옵션을 함께 표시할 상품
          <select name="groupId" defaultValue={p.groupId || p.id || ""}>
            <option value="">독립 상품</option>
            {products
              .filter(
                (v, i, ls) =>
                  ls.findIndex(
                    (x) => (x.groupId || x.id) === (v.groupId || v.id),
                  ) === i,
              )
              .map((v) => (
                <option key={v.id} value={v.groupId || v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </label>
        <Field
          title="옵션 코드(SKU)"
          name="sku"
          value={original ? sku(p) : ""}
          pattern="[A-Za-z0-9_\-]+"
          maxLength={60}
        />
        <Field title="색상·규격 또는 용량" name="option" value={p.option} />
        <Field
          title={category === "배스" ? "성분" : "소재·재질"}
          name="material"
          value={p.material}
        />
        <Field title="제조국·원산지" name="origin" value={p.origin} />
        <Field
          title={category === "패브릭" ? "세탁·취급 방법" : "사용·관리 방법"}
          name="care"
          value={p.care}
        />
        <Field
          title="판매가(원)"
          name="price"
          value={p.price}
          type="number"
          min="1"
          max="99999999"
        />
        <label>
          판매 상태
          <select
            name="active"
            defaultValue={p.active === false ? "no" : "yes"}
          >
            <option value="yes">판매중</option>
            <option value="no">판매중지</option>
          </select>
        </label>
        <label>
          상품 사진
          <select name="photo" defaultValue={p.photo || "towel"}>
            {Object.entries({
              towel: "핸드타월",
              mug: "머그",
              wash: "핸드워시",
            }).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Note title="상품 설명" name="description" value={p.description} />
      <Note />
      <div className="actions">
        <button type="button" onClick={close}>
          닫기
        </button>
        <button className="primary">상품 저장</button>
      </div>
    </form>
  );
}
function DisplayHistory({ db, product }) {
  const records = (db.displayHistory || []).filter(
    (v) =>
      v.productId === product.id &&
      Date.parse(v.expiresAt) >
        Date.parse(db.clock || new Date().toISOString()),
  );
  return (
    <details className="ops-history">
      <summary>과거 표시·광고 이력 ({records.length})</summary>
      {records.length === 0 ? (
        <p>보존 중인 이전 노출본이 없습니다.</p>
      ) : (
        records.map((r) => (
          <article key={r.id} className="ops-inset">
            <h4>
              {r.name} · 고시 v{r.version} / 운임 v{r.policy.version}
            </h4>
            <img
              src={"/images/" + r.photo + ".webp"}
              alt={r.name + " 당시 사진"}
              width="100"
              height="80"
              style={{ objectFit: "cover" }}
            />
            <p>
              {r.brand} · {r.category} · {r.sku}
              <br />
              {r.option} · {money(r.price)}
            </p>
            <p>
              {r.description}
              <br />
              {r.material} · {r.origin} · {r.care}
            </p>
            <p>
              일반 배송비 {money(r.policy.baseFare)} / 도서산간{" "}
              {money(r.policy.islandFare)} · 마감 {r.policy.cutoff}
              <br />
              도서산간 우편번호 앞자리{" "}
              {r.policy.islandPrefixes.join(", ") || "없음"} · 제한 지역{" "}
              {r.policy.blockedPrefixes.join(", ") || "없음"}
            </p>
            <p>
              {r.supply}
              <br />
              {r.returns}
            </p>
            <small>
              노출 {r.startedAt ? date(r.startedAt) : "초기 게시"} ~{" "}
              {date(r.endedAt)}
              <br />
              보존 만료 {date(r.expiresAt)}
            </small>
          </article>
        ))
      )}
    </details>
  );
}
export function CatalogOps({ db, role, run }) {
  const [editing, setEditing] = useState(null);
  function adjust(e) {
    e.preventDefault();
    const f = input(e.currentTarget),
      baseline = editing,
      p = baseline.item;
    run(
      "stock",
      "재고 실사 반영",
      sku(p),
      f.note,
      (latest) => {
        const current = latest.products.find((x) => x.id === p.id),
          totals = stockCounts(latest, current);
        ensure(
          totals.physical === baseline.physical &&
            current.stock === p.stock &&
            (current.stockVersion || 0) === (p.stockVersion || 0),
          "실사 이후 수량이 바뀌었습니다. 편집을 닫고 최신 실물 명세를 확인하세요.",
        );
        const physical = Number(f.count),
          stock = physical - totals.reserved - totals.allocated;
        ensure(
          stock >= 0,
          "결제 예약과 출고 대기 수량보다 적습니다. 확보 수량을 확인하세요.",
        );
        return {
          ...latest,
          products: latest.products.map((x) =>
            x.id === p.id
              ? { ...x, stock, stockVersion: (x.stockVersion || 0) + 1 }
              : x,
          ),
        };
      },
      () => setEditing(null),
      baseline.physical + "개 → " + f.count + "개",
    );
  }
  return (
    <>
      <div className="ops-heading">
        <h2>옵션별 재고</h2>
        {role === "product" && (
          <button onClick={() => setEditing({ mode: "new" })}>상품 등록</button>
        )}
      </div>
      {editing?.mode === "new" || editing?.mode === "edit" ? (
        <ProductEdit
          key={editing.item?.id || "new"}
          original={editing.item}
          products={db.products}
          run={run}
          close={() => setEditing(null)}
        />
      ) : null}
      {editing?.mode === "stock" && (
        <form className="ops-box" onSubmit={adjust}>
          <h3>{editing.item.name} 재고 조정</h3>
          <p>
            기준 실물 {editing.physical}개 · 현재 가용 {editing.item.stock}개
          </p>
          <Field
            title="실사한 실물 수량"
            name="count"
            type="number"
            min="0"
            max="999999"
            value={editing.physical}
          />
          <Note title="실사 근거와 조정 사유" />
          <div className="actions">
            <button type="button" onClick={() => setEditing(null)}>
              닫기
            </button>
            <button className="primary">재고 반영</button>
          </div>
        </form>
      )}
      <div className="ops-items">
        {db.products.map((p) => {
          const c = stockCounts(db, p);
          return (
            <article className="ops-box" key={p.id}>
              <small>
                {sku(p)} · {p.active === false ? "판매중지" : "판매중"}
              </small>
              <h3>{p.name}</h3>
              <p>
                {p.option} · {money(p.price)}
              </p>
              <dl className="ops-numbers">
                {[
                  ["실물", c.physical],
                  ["결제 예약", c.reserved],
                  ["출고 대기", c.allocated],
                  ["판매 가능", p.stock],
                ].map(([s, n]) => (
                  <div key={s}>
                    <dt>{s}</dt>
                    <dd>{n}개</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => {
                  setEditing({
                    mode: role === "product" ? "edit" : "stock",
                    item: p,
                    ...c,
                  });
                  document.querySelector(".ops-heading")?.scrollIntoView();
                }}
              >
                {role === "product" ? "상품·가격 수정" : "재고 조정"}
              </button>
              {role === "product" && <DisplayHistory db={db} product={p} />}
            </article>
          );
        })}
      </div>
    </>
  );
}
