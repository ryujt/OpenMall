import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ShoppingBag, UserRound, Search, Truck } from "lucide-react";
import { Catalog, Product } from "./catalog";
import {
  Cart,
  Checkout,
  Orders,
  Order,
  Access,
  Account,
  Empty,
} from "./shopping";
import { Admin } from "./admin";
import { go, key, restore } from "./model";
import "./style.css";
function App() {
  const [db, setDb] = useState(restore),
    [path, setPath] = useState(location.hash.slice(1) || "/"),
    [q, setQ] = useState(""),
    [draft, setDraft] = useState("");
  useEffect(() => {
    function change() {
      setPath(location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const update = (data) => {
    localStorage.setItem(key, JSON.stringify(data));
    setDb(data);
  };
  const args = path.split("/"),
    item = db.products.find((p) => p.id === args[2]),
    order = db.orders.find((o) => o.id === args[2]);
  const home = path === "/" || path === "/saved";
  function search(v) {
    setDraft(v);
    setQ(v);
  }
  let content;
  if (home)
    content = (
      <Catalog
        key={path}
        db={db}
        update={update}
        savedOnly={path === "/saved"}
        search={q}
        setSearch={search}
      />
    );
  else if (args[1] === "products" && item)
    content = <Product key={item.id} product={item} db={db} update={update} />;
  else if (path === "/cart") content = <Cart db={db} update={update} />;
  else if (args[1] === "checkout")
    content = (
      <Checkout
        key={path}
        db={db}
        update={update}
        direct={args[2] === "direct"}
      />
    );
  else if (path === "/my/orders" && db.member) content = <Orders db={db} />;
  else if (path === "/my/account" && db.member)
    content = <Account db={db} update={update} />;
  else if (args[1] === "my" || path === "/access")
    content = (
      <Access
        db={db}
        update={update}
        target={args[1] === "my" ? path : undefined}
      />
    );
  else if (
    args[1] === "orders" &&
    order &&
    (order.member ? db.member : db.guestId === order.id)
  )
    content = (
      <Order
        key={path}
        o={order}
        claim={args[3] === "claim"}
        updateOrder={(o) =>
          update({
            ...db,
            orders: db.orders.map((v) => (v.id === o.id ? o : v)),
          })
        }
      />
    );
  else if (args[1] === "orders")
    content = <Access db={db} update={update} target={path} />;
  else if (
    args[1] === "admin" &&
    ["catalog", "shipments", "claims"].includes(args[2])
  )
    content = <Admin key={path} page={args[2]} db={db} update={update} />;
  else content = <Empty title="페이지를 찾을 수 없습니다" />;
  return (
    <>
      <div className="topnote">
        <Truck size={14} /> 일반 지역 배송비 3,000원
      </div>
      <header>
        <div className="bar">
          <a className="logo" href="#/" onClick={() => search("")}>
            OpenMall<span>.</span>
          </a>
          <nav>
            <a
              href="#/"
              aria-current={path === "/" ? "page" : undefined}
              onClick={() => search("")}
            >
              스토어
            </a>
            <a
              href="#/saved"
              aria-current={path === "/saved" ? "page" : undefined}
              onClick={() => search("")}
            >
              찜한 상품
            </a>
            <a href="#/my/orders">내 주문</a>
          </nav>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(draft);
              go("/");
              requestAnimationFrame(() =>
                document.querySelector("#collection")?.scrollIntoView(),
              );
            }}
          >
            <input
              aria-label="상품 검색"
              placeholder="상품을 검색하세요"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button aria-label="검색">
              <Search size={18} />
            </button>
          </form>
          <a className="icon" aria-label="내 계정" href="#/my/account">
            <UserRound />
          </a>
          <a className="icon" aria-label="장바구니" href="#/cart">
            <ShoppingBag />
            {Object.keys(db.cart).length > 0 && (
              <sup>{Object.values(db.cart).reduce((a, b) => a + b, 0)}</sup>
            )}
          </a>
        </div>
      </header>
      <main className={home ? "wrap home" : "wrap inside"}>{content}</main>
      <footer className="wrap">
        <span className="logo">OpenMall.</span>
        <span>생활 편집숍</span>
        <a href="#/admin/catalog">운영 체험</a>
      </footer>
    </>
  );
}
createRoot(document.querySelector("#root")).render(<App />);
