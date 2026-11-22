import { upgradeOrder } from "./commerce";
export const key = "openmall.prototype.v1";
export const demo = {
  name: "김서윤",
  zip: "03925",
  detail: "",
  address: "서울시 마포구 월드컵북로 12",
  phone: "010-1234-5678",
};
const products = [
  {
    id: "cotton-towel",
    name: "코튼 핸드타월",
    brand: "오픈 리빙",
    category: "패브릭",
    option: "세이지 · 40 × 70 cm",
    price: 12000,
    stock: 18,
    photo: "towel",
    description:
      "촘촘한 면 파일이 물기를 부드럽게 흡수합니다. 손을 닦고 가볍게 걸어 두기 좋은 크기입니다.",
  },
  {
    id: "stone-mug",
    name: "스톤웨어 머그",
    brand: "스튜디오 온",
    category: "키친",
    option: "샌드 · 320 ml",
    price: 18000,
    stock: 12,
    photo: "mug",
    description:
      "잔잔한 반점과 둥근 손잡이가 어우러진 머그입니다. 도톰한 기벽이 따뜻한 차의 온기를 오래 담아 줍니다.",
  },
  {
    id: "herbal-wash",
    name: "허벌 핸드워시",
    brand: "보태니컬 랩",
    category: "배스",
    option: "허브 · 300 ml",
    price: 24000,
    stock: 8,
    photo: "wash",
    description:
      "손을 씻은 뒤 은은한 허브 향이 남습니다. 차분한 호박색 펌프 용기로 세면대 위에 두기 좋습니다.",
  },
];
const facts = {
  towel: ["면 100%", "대한민국", "중성세제로 단독 세탁"],
  mug: ["도자기", "대한민국", "부드러운 수세미로 세척"],
  wash: ["액상 세정제", "대한민국", "직사광선을 피해 실온 보관"],
};
export const demoEmail = "seoyun@example.test";
function productDefaults(p) {
  const [material, origin, care] = facts[p.photo] || facts.towel;
  return {
    sku: p.id,
    groupId: p.id,
    material,
    origin,
    care,
    version: 1,
    active: true,
    ...p,
  };
}
export function initial() {
  return {
    products: [
      ...products,
      {
        ...products[0],
        id: "cotton-towel-ivory",
        groupId: "cotton-towel",
        option: "아이보리 · 40 × 70 cm",
        stock: 6,
      },
    ].map(productDefaults),
    accounts: [
      {
        id: "demo",
        email: demoEmail,
        profile: { ...demo },
        marketing: false,
        demo: true,
      },
    ],
    memberId: null,
    cartPrices: {},
    baskets: {},
    guestUntil: 0,
    revision: 0,
    cart: {},
    direct: null,
    orders: [],
    saved: [],
    member: false,
    profile: demo,
    guestId: null,
  };
}
export function restore() {
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    if (!stored) return initial();
    const seed = initial();
    const db = { ...seed, ...stored };
    db.products = stored.products.map(productDefaults);
    if (
      !stored.accounts &&
      !db.products.some((p) => p.id === "cotton-towel-ivory")
    )
      db.products.push(seed.products.at(-1));
    if (!stored.accounts && stored.profile)
      db.accounts[0].profile = stored.profile;
    db.memberId = db.member ? db.memberId || "demo" : null;
    for (const o of db.orders) {
      if (o.payment || o.stage !== "취소 접수") continue;
      for (const line of o.lines) {
        const p = db.products.find((p) => p.id === line.id);
        if (p) p.stock += line.qty;
      }
    }
    db.orders = db.orders.map(upgradeOrder);
    const grant = JSON.parse(
      sessionStorage.getItem("openmall.guest") || "null",
    );
    db.guestId = grant?.id || null;
    db.guestUntil = grant?.until || 0;
    return db;
  } catch {
    return initial();
  }
}
export const money = (value) => value.toLocaleString("ko-KR") + "원";
export const go = (path) => {
  location.hash = path;
};
export function basketLines(products, basket) {
  return products
    .filter((p) => basket[p.id] > 0)
    .map((p) => ({ ...p, qty: basket[p.id] }));
}
