export const key = "openmall.prototype.v1";
export const demo = {
  name: "김서윤",
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
export function initial() {
  return {
    products,
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
    return JSON.parse(localStorage.getItem(key)) || initial();
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
