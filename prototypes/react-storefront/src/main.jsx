import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Truck, ShoppingBag, UserRound, Store } from "lucide-react";
import { Catalog, Product } from "./catalog";
import { Cart, Checkout, Orders, Order, Empty } from "./shopping";
import { Access, Account } from "./identity";
import { Admin } from "./admin";
import { Lab } from "./lab";
import { shippingPolicy } from "./delivery-policy";
import { key, restore, money } from "./model";
import "./style.css";
import "./storefront.css";

function Help() {
  return (
    <>
      <small>CUSTOMER SERVICE</small>
      <h1>판매자 정보와 고객상담</h1>
      <div className="info-grid">
        <section>
          <h2>판매자 정보</h2>
          <p>
            오픈몰 생활상점 · 대표 김서윤
            <br />
            예시 사업장 서울시 마포구 월드컵북로 12
            <br />
            상담 help@example.test
            <br />
            사업자등록번호 000-00-00000
            <br />
            통신판매 신고 예시 제0000-서울마포-0000호 · 마포구청
          </p>
          <p>교육용 상점입니다. 모든 식별 정보와 거래는 예시입니다.</p>
        </section>
        <section>
          <h2>문의·이의 신청</h2>
          <p>
            배송 미수령, 청약철회 기산일, 단순 개봉, 반품 비용과 보증에 관한
            이의는 주문 상세에서 접수하세요. 상담원이 당시 고지와 수령·검수
            기록을 확인합니다.
          </p>
          <a className="button" href="#/my/orders">
            내 주문
          </a>{" "}
          <a className="button" href="#/access?mode=guest">
            비회원 주문 조회
          </a>
        </section>
        <section>
          <h2>약관·개인정보 처리</h2>
          <p>
            결제는 원화 카드·간편결제로 진행합니다. 계약 조건은 주문 상세에서
            저장할 수 있습니다. 법정대리인 동의가 없는 미성년자 계약은 취소할 수
            있습니다.
          </p>
          <p>
            주문자 연락처와 수취인·주소는 계약 이행, 배송 및 상담에 사용합니다.
            가상 택배사는 배송, 발송사는 거래 안내를 맡습니다. 선택 마케팅은
            회원 정보에서 철회할 수 있습니다.
          </p>
          <p>
            표시·광고는 6개월, 계약·청약철회·결제·공급은 5년, 불만·분쟁은 3년을
            보존 기준으로 합니다. 탈퇴 후 본인 확인을 거쳐 사본을 요청할 수
            있습니다.
          </p>
          <a href="#/access?mode=copy">보존 거래기록 요청 →</a>
        </section>
      </div>
    </>
  );
}
function App() {
  const [db, setDb] = useState(restore),
    [route, setRoute] = useState(location.hash.slice(1) || "/"),
    [q, setQ] = useState(""),
    [notice, setNotice] = useState("");
  const current = useRef(db);
  const [now, setNow] = useState(Date.now);
  const [path, query = ""] = route.split("?"),
    params = new URLSearchParams(query);
  function replace(next) {
    current.current = next;
    setDb(next);
  }
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || "/");
      setNotice("");
      window.scrollTo(0, 0);
    };
    const sync = (e) => {
      if (e.key === key || e.key === null) replace(restore());
    };
    window.addEventListener("hashchange", change);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (!db.guestUntil || db.guestUntil <= Date.now()) return;
    const id = setTimeout(
      () => setNow(Date.now()),
      db.guestUntil - Date.now() + 1,
    );
    return () => clearTimeout(id);
  }, [db.guestUntil]);
  async function update(data) {
    const expected = db.revision;
    function conflict() {
      replace(restore());
      setNotice(
        "다른 창에서 변경했습니다. 최신 내역을 확인한 뒤 다시 시도해 주세요.",
      );
    }

    const next = { ...data, revision: expected + 1 };
    if (
      db.transfer &&
      next.orders.length > db.orders.length &&
      next.orders[0].source === "direct"
    ) {
      const guest = next.baskets?.guest;
      if (guest) {
        const cart = { ...guest.cart };
        for (const line of next.orders[0].lines) {
          if (!db.transfer[line.id]) continue;
          const left = (cart[line.id] || 0) - line.qty;
          if (left > 0) cart[line.id] = left;
          else delete cart[line.id];
        }
        next.baskets = { ...next.baskets, guest: { ...guest, cart } };
      }
      next.transfer = null;
    }
    if (next.guestId !== db.guestId && next.guestId && !next.guestUntil)
      next.guestUntil = Date.now() + 900000;
    function persist() {
      if (
        restore().revision !== expected ||
        current.current.revision !== expected
      ) {
        conflict();
        throw Error("최신 내역을 확인한 뒤 다시 시도해 주세요.");
      }
      sessionStorage.setItem(
        "openmall.guest",
        JSON.stringify(
          next.guestId ? { id: next.guestId, until: next.guestUntil } : null,
        ),
      );
      localStorage.setItem(
        key,
        JSON.stringify({ ...next, guestId: null, guestUntil: 0 }),
      );
      replace(next);
    }
    if (navigator.locks) await navigator.locks.request(key, persist);
    else persist();
    return true;
  }
  const mainRef = useRef(null),
    previousRoute = useRef(route);
  useEffect(() => {
    document.title =
      (mainRef.current?.querySelector("h1")?.textContent || "상품 찾기") +
      " · OpenMall";
    if (previousRoute.current !== route)
      mainRef.current?.focus({ preventScroll: true });
    previousRoute.current = route;
  }, [route, db.memberId]);
  const args = path.split("/"),
    item = db.products.find((p) => p.id === args[2]),
    order = db.orders.find((o) => o.id === args[2]),
    isHome = path === "/" || path === "/saved";
  let content;
  const props = { db, update };
  const guarded = {
    db,
    update: async (data) => {
      try {
        return await update(data);
      } catch (err) {
        setNotice(err.message);
        return false;
      }
    },
  };
  if (isHome)
    content = (
      <Catalog
        key={path}
        {...guarded}
        savedOnly={path === "/saved"}
        search={q}
        setSearch={setQ}
      />
    );
  else if (args[1] === "products" && item)
    content = <Product key={item.id} {...guarded} product={item} />;
  else if (path === "/cart") content = <Cart {...props} />;
  else if (args[1] === "checkout")
    content = (
      <Checkout
        key={path + (db.memberId || "guest")}
        {...props}
        direct={args[2] === "direct"}
      />
    );
  else if (path === "/my/orders" && db.member) content = <Orders {...props} />;
  else if (path === "/my/account" && db.member)
    content = <Account key={db.memberId} {...guarded} />;
  else if (args[1] === "my" || path === "/access") {
    const target = params.get("return") || "";
    content = (
      <Access
        key={route}
        {...guarded}
        resetId={params.get("token") || ""}
        mode={
          ["guest", "copy", "signup", "reset", "new-password"].includes(
            params.get("mode"),
          )
            ? params.get("mode")
            : "login"
        }
        target={
          args[1] === "my"
            ? path
            : /^\/(checkout(\/direct)?|cart|my\/(orders|account)|orders\/[\w-]+)$/.test(
                  target,
                )
              ? target
              : "/my/account"
        }
      />
    );
  } else if (
    args[1] === "orders" &&
    order &&
    (order.member
      ? db.member && db.memberId === order.memberId
      : db.guestId === order.id && db.guestUntil > Math.max(now, Date.now()))
  )
    content = (
      <Order
        key={path}
        {...props}
        o={order}
        view={args[3] || ""}
        claim={args[3] === "claim"}
      />
    );
  else if (args[1] === "orders")
    content = (
      <>
        <p role="status">
          주문을 열려면 소유 회원 로그인 또는 해당 주문 조회 인증이 필요합니다.
        </p>
        <Access
          key={route}
          {...guarded}
          mode="guest"
          orderId={args[2]}
          target={path}
        />
      </>
    );
  else if (
    args[1] === "admin" &&
    ["catalog", "shipments", "claims"].includes(args[2])
  )
    content = <Admin key={path} {...props} page={args[2]} />;
  else if (path === "/help") content = <Help />;
  else if (path === "/review") content = <Lab />;
  else content = <Empty title="페이지를 찾을 수 없습니다" />;
  return (
    <>
      <div className="topnote">
        <Truck size={14} /> 국내 택배 배송 · 일반 지역{" "}
        {money(shippingPolicy(db).baseFare)}
      </div>
      <header>
        <div className="bar">
          <a className="logo" href="#/" onClick={() => setQ("")}>
            OpenMall<span>.</span>
          </a>
          <nav aria-label="주요 메뉴">
            <a aria-current={path === "/" ? "page" : undefined} href="#/">
              상품 찾기
            </a>
            <a href="#/my/orders">내 주문</a>
            <a href="#/saved">찜한 상품</a>
          </nav>
          <a className="icon" href="#/my/account" aria-label="계정">
            <UserRound />
          </a>
          <a className="icon" href="#/cart" aria-label="장바구니">
            <ShoppingBag />
            {Object.values(db.cart).length > 0 && (
              <sup>{Object.values(db.cart).reduce((a, b) => a + b, 0)}</sup>
            )}
          </a>
        </div>
      </header>
      <main
        ref={mainRef}
        tabIndex={-1}
        className={isHome ? "wrap home" : "wrap inside"}
      >
        {notice && <p role="alert">{notice}</p>}
        {content}
      </main>
      <footer className="wrap">
        <span className="logo">OpenMall.</span>
        <a href="#/help">판매자 정보 · 고객상담</a>
        <a href="#/review">설계 검수</a>
        <a href="#/admin/catalog">
          <Store size={15} /> 운영 체험
        </a>
      </footer>
    </>
  );
}
createRoot(document.querySelector("#root")).render(<App />);
