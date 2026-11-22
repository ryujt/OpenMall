import React, { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Heart,
  SlidersHorizontal,
  Search,
  X,
  ChevronRight,
} from "lucide-react";
import { money, go } from "./model";
const chapters = [
  {
    title: (
      <>
        오래 곁에 두는
        <br />
        생활의 기본
      </>
    ),
    subtitle: "부드러운 패브릭과 따뜻한 도자기로 채운 일상.",
    photo: "editorial",
    action: "컬렉션 둘러보기",
  },
  {
    title: (
      <>
        손끝에 닿는
        <br />
        부드러운 결
      </>
    ),
    subtitle: "포근하게 짜인 코튼 핸드타월을 만나보세요.",
    photo: "towel",
    action: "핸드타월 보기",
    id: "cotton-towel",
  },
  {
    title: (
      <>
        한 잔으로 여는
        <br />
        느긋한 아침
      </>
    ),
    subtitle: "따뜻한 차 한 잔을 위한 스톤웨어 머그.",
    photo: "mug",
    action: "머그 보기",
    id: "stone-mug",
  },
];
export function Catalog({ db, update, savedOnly, search, setSearch }) {
  const [category, setCategory] = useState("전체");
  const [sort, setSort] = useState("추천순");
  const [slide, setSlide] = useState(0);
  const chapter = chapters[slide];
  let items = db.products.filter(
    (p) =>
      (!savedOnly || db.saved.includes(p.id)) &&
      (category === "전체" || p.category === category) &&
      [p.name, p.category, p.brand, p.option].join(" ").includes(search.trim()),
  );
  if (sort !== "추천순")
    items.sort((a, b) =>
      sort === "낮은 가격순" ? a.price - b.price : b.price - a.price,
    );
  return (
    <>
      {!savedOnly && (
        <section className="hero">
          <div className="herocopy">
            <small>OPENMALL COLLECTION</small>
            <h1>{chapter.title}</h1>
            <p>{chapter.subtitle}</p>
            <button
              className="heroaction"
              onClick={() =>
                chapter.id
                  ? go("/products/" + chapter.id)
                  : document.querySelector("#collection").scrollIntoView()
              }
            >
              {chapter.action}
              <ArrowRight size={16} />
            </button>
            <div className="slides">
              {chapters.map((_, i) => (
                <button
                  key={i}
                  aria-label={i + 1 + "번째 컬렉션"}
                  aria-pressed={i === slide}
                  onClick={() => setSlide(i)}
                >
                  <i />
                </button>
              ))}
              <span>0{slide + 1} / 03</span>
            </div>
          </div>
          <img
            className="herophoto"
            src={"/images/" + chapter.photo + ".webp"}
            alt="햇살이 비치는 생활 소품 컬렉션"
          />
        </section>
      )}
      <section id="collection">
        <div className="sectiontitle">
          <div>
            <small>{savedOnly ? "WISHLIST" : "SHOP THE COLLECTION"}</small>
            <h2>{savedOnly ? "찜한 상품" : "생활 셀렉션"}</h2>
          </div>
          <label className="sort">
            <SlidersHorizontal size={15} />
            <select
              aria-label="상품 정렬"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {["추천순", "낮은 가격순", "높은 가격순"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="filterrow">
          <div className="tabs">
            {["전체", "패브릭", "키친", "배스"].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <span>{items.length}개 상품</span>
        </div>
        {search && (
          <button className="clear" onClick={() => setSearch("")}>
            검색어 {search}
            <X size={14} />
          </button>
        )}
        <div className="cards">
          {items.map((p) => (
            <article key={p.id}>
              <div className="cardphoto">
                <a href={"#/products/" + p.id}>
                  <img src={"/images/" + p.photo + ".webp"} alt={p.name} />
                </a>
                <button
                  aria-label={p.name + " 찜"}
                  aria-pressed={db.saved.includes(p.id)}
                  className="heart"
                  onClick={() =>
                    update({
                      ...db,
                      saved: db.saved.includes(p.id)
                        ? db.saved.filter((id) => id !== p.id)
                        : [...db.saved, p.id],
                    })
                  }
                >
                  <Heart
                    size={17}
                    fill={db.saved.includes(p.id) ? "currentColor" : "none"}
                  />
                </button>
              </div>
              <a href={"#/products/" + p.id}>
                <small>
                  {p.brand} · {p.category}
                </small>
                <h3>{p.name}</h3>
                <strong>{p.stock ? money(p.price) : "품절"}</strong>
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
                setCategory("전체");
                setSearch("");
                if (savedOnly) go("/");
              }}
            >
              전체 상품 보기
            </button>
          </div>
        )}
      </section>
    </>
  );
}
export function Product({ product: p, db, update }) {
  const [qty, setQty] = useState(1);
  const available = p.stock - (db.cart[p.id] || 0);
  return (
    <>
      <a className="crumb" href="#/">
        생활 셀렉션 <ChevronRight size={14} /> {p.category}
      </a>
      <section className="product">
        <img src={"/images/" + p.photo + ".webp"} alt={p.name} />
        <div>
          <small>
            {p.brand} · {p.category}
          </small>
          <h1>{p.name}</h1>
          <h2>{money(p.price)}</h2>
          <p>{p.description}</p>
          <hr />
          <p>옵션　{p.option}</p>
          <p>배송비　3,000원 · 도서산간 6,000원</p>
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
          <div className="actions">
            <button
              disabled={
                !(Number.isInteger(+qty) && qty >= 1 && qty <= available)
              }
              onClick={() => {
                update({
                  ...db,
                  cart: {
                    ...db.cart,
                    [p.id]: (db.cart[p.id] || 0) + Number(qty),
                  },
                });
                go("/cart");
              }}
            >
              장바구니 담기
            </button>
            <button
              className="primary"
              disabled={!(Number.isInteger(+qty) && qty >= 1 && qty <= p.stock)}
              onClick={() => {
                update({ ...db, direct: { [p.id]: +qty } });
                go("/checkout/direct");
              }}
            >
              {p.stock ? "바로 구매" : "품절"}
              <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
