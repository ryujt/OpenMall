import React, { useState } from "react";
import {
  ArrowRight,
  Search,
  Heart,
  ChevronRight,
  Package,
  Truck,
  ShieldCheck,
} from "lucide-react";
import { shippingPolicy } from "./delivery-policy";
import { money, go } from "./model";
export function Catalog({ db, update, savedOnly, search, setSearch }) {
  const policy = shippingPolicy(db);
  const [category, setCategory] = useState("전체"),
    [sort, setSort] = useState("recommended"),
    [draft, setDraft] = useState(search);
  const active = db.products.filter((p) => p.active !== false);
  const categories = ["전체", ...new Set(active.map((p) => p.category))];
  const matches = active.filter(
    (p) =>
      (!savedOnly || db.saved.includes(p.id)) &&
      (category === "전체" || category === p.category) &&
      [p.name, p.category, p.option, p.brand, p.sku]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const groups = new Map();
  for (const p of matches) {
    const group = p.groupId || p.id;
    if (!groups.has(group) || (!groups.get(group).stock && p.stock))
      groups.set(group, p);
  }
  const items = [...groups.values()];
  if (sort !== "recommended")
    items.sort((a, b) =>
      sort === "low" ? a.price - b.price : b.price - a.price,
    );
  function reset() {
    setCategory("전체");
    setDraft("");
    setSearch("");
  }
  return (
    <>
      {!savedOnly && (
        <section className="shop-banner">
          <div>
            <small>OPENMALL LIVING</small>
            <h1>일상에 필요한 물건</h1>
            <p>소재와 쓰임을 살펴 고르는 생활 편집숍</p>
            <a href="#/products/cotton-towel">
              코튼 핸드타월 보기 <ArrowRight size={16} />
            </a>
          </div>
          <img
            src="/images/editorial.webp"
            alt="햇살이 드는 테이블 위 머그와 리넨"
          />
        </section>
      )}
      <section id="collection">
        <div className="sectiontitle">
          <div>
            <small>{savedOnly ? "WISHLIST" : "SHOP THE COLLECTION"}</small>
            <h2>{savedOnly ? "찜한 상품" : "상품 찾기"}</h2>
          </div>
        </div>
        <div className="catalog-layout">
          <aside className="filter-panel">
            <h3>검색 조건</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(draft);
              }}
            >
              <label>
                상품 검색
                <span className="searchfield">
                  <input
                    type="search"
                    placeholder="상품명 또는 옵션"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button aria-label="검색">
                    <Search size={18} />
                  </button>
                </span>
              </label>
            </form>
            <fieldset>
              <legend>카테고리</legend>
              {categories.map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </fieldset>
            <button onClick={reset}>조건 초기화</button>
          </aside>
          <section>
            <div className="results-bar">
              <b>
                {category === "전체" ? "전체 상품" : category}{" "}
                <span>{items.length}</span>
              </b>
              <label>
                <select
                  aria-label="상품 정렬"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recommended">추천순</option>
                  <option value="low">낮은 가격순</option>
                  <option value="high">높은 가격순</option>
                </select>
              </label>
            </div>
            <div className="cards">
              {items.map((p) => (
                <article key={p.id}>
                  <div className="cardphoto">
                    <a href={"#/products/" + p.id}>
                      <img alt={p.name} src={"/images/" + p.photo + ".webp"} />
                    </a>
                    <button
                      className="heart"
                      aria-label={p.name + " 찜"}
                      aria-pressed={db.saved.includes(p.id)}
                      onClick={() =>
                        update({
                          ...db,
                          saved: db.saved.includes(p.id)
                            ? db.saved.filter((i) => i !== p.id)
                            : [...db.saved, p.id],
                        })
                      }
                    >
                      <Heart
                        size={16}
                        fill={db.saved.includes(p.id) ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                  <a href={"#/products/" + p.id}>
                    <small>
                      {p.brand} · {p.category}
                    </small>
                    <h3>{p.name}</h3>
                    <p>{p.option}</p>
                    <strong>{money(p.price)}</strong>
                    {!p.stock && <b> · 품절</b>}
                    <p>일반 배송 포함 {money(p.price + policy.baseFare)}</p>
                  </a>
                </article>
              ))}
            </div>
            {!items.length && (
              <div className="empty">
                <Search />
                <h3>
                  {savedOnly
                    ? "조건에 맞는 찜한 상품이 없습니다"
                    : "검색된 상품이 없습니다"}
                </h3>
                <button
                  onClick={() => {
                    reset();
                    go("/");
                  }}
                >
                  전체 상품 보기
                </button>
              </div>
            )}
            <p className="muted">
              기본 배송비 {money(policy.baseFare)}. 도서·산간 추가비는 배송
              지역에 따라 주문서에서 확정됩니다.
            </p>
          </section>
        </div>
      </section>
    </>
  );
}
export function Product({ product: p, db, update }) {
  const policy = shippingPolicy(db);
  const [qty, setQty] = useState("1");
  const options = db.products.filter(
    (v) =>
      (v.groupId || v.id) === (p.groupId || p.id) &&
      (v.active !== false || v.id === p.id),
  );
  const valid =
    Number.isInteger(+qty) &&
    +qty >= 1 &&
    +qty <= p.stock &&
    p.active !== false;
  async function buy(toCart) {
    if (!valid) return;
    if (
      !(await update(
        toCart
          ? {
              ...db,
              cart: { ...db.cart, [p.id]: (db.cart[p.id] || 0) + Number(qty) },
              cartPrices: { ...db.cartPrices, [p.id]: p.price },
            }
          : { ...db, transfer: null, direct: { [p.id]: Number(qty) } },
      ))
    )
      return;
    go(toCart ? "/cart" : "/checkout/direct");
  }
  return (
    <>
      <a className="crumb" href="#/">
        상품 찾기 <ChevronRight size={14} /> {p.category}
      </a>
      <section className="product">
        <img alt={p.name} src={"/images/" + p.photo + ".webp"} />
        <div>
          <small>
            {p.brand} · {p.category}
          </small>
          <h1>{p.name}</h1>
          <h2>{money(p.price)}</h2>
          <p>{p.description}</p>
          <hr />
          <label>
            색상과 규격
            <select
              value={p.id}
              onChange={(e) => go("/products/" + e.target.value)}
            >
              {options.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.option}
                  {v.stock ? "" : " · 품절"}
                </option>
              ))}
            </select>
          </label>
          <p>
            {p.active === false
              ? "판매 종료"
              : p.stock
                ? "판매 가능 " + p.stock + "개"
                : "품절"}{" "}
            · SKU {p.sku || p.id}
          </p>
          <label>
            수량
            <input
              type="number"
              min="1"
              max={p.stock}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <p>
            일반 배송 포함{" "}
            {money(p.price * (Number(qty) || 0) + policy.baseFare)} · 도서산간
            추가 {money(policy.islandFare - policy.baseFare)}
          </p>
          <div className="actions">
            <button
              disabled={!valid || +qty + (db.cart[p.id] || 0) > p.stock}
              onClick={() => buy(true)}
            >
              장바구니 담기
            </button>
            <button
              className="primary"
              disabled={!valid}
              onClick={() => buy(false)}
            >
              {p.active === false
                ? "판매 종료"
                : p.stock
                  ? "바로 구매"
                  : "품절"}
            </button>
          </div>
        </div>
      </section>
      <div className="info-grid">
        <section>
          <Package size={20} />
          <h2>상품 정보</h2>
          <dl>
            {[
              ["소재", p.material],
              ["색상·규격", p.option],
              ["제조국", p.origin],
              ["취급 방법", p.care],
              ["고시 버전", p.version],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <Truck size={20} />
          <h2>공급·배송</h2>
          <p>
            국내 단일 창고에서 택배로 발송합니다. 택배 마감은 한국 시간{" "}
            {policy.cutoff}입니다. 별도 약정이 없는 선지급 주문은 결제일부터
            3영업일 이내에 공급에 필요한 조치를 진행합니다.
          </p>
        </section>
        <section>
          <ShieldCheck size={20} />
          <h2>교환·반품 및 보증</h2>
          <p>
            주문 상세에서 품목과 수량을 지정하세요. 단순변심은 수령 후 7일,
            불일치는 공급 후 3개월과 발견 후 30일 기준을 확인합니다. 단순변심
            회수비는 구매자, 하자·오배송은 판매자가 부담합니다.
          </p>
          <a href="#/help">상담 및 거래 조건 →</a>
        </section>
      </div>
    </>
  );
}
