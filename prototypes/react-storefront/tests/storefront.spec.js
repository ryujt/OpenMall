import { test, expect } from "@playwright/test";
const demoPhone = "010-9000-0000";
function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}
async function requestCode(page) {
  await button(page, "인증번호 요청").click();
  await page.getByText("가상 수신함 열기").click();
  return page.locator(".code-check b").innerText();
}
async function submitCode(page, code) {
  await page.getByLabel("인증번호", { exact: true }).fill(code);
  await button(page, "인증번호 확인").click();
}

test("다른 탭의 조회 코드 재발급, 주문자 연락처, 주문별 권한과 만료", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async (phone) => {
    const { initial, key } = await import("/src/model.js");
    const { quote, createOrder, payOrder } = await import("/src/commerce.js");
    let db = initial();
    for (const id of ["OM-G1", "OM-G2"]) {
      const form = {
        id,
        member: false,
        lines: [{ id: "stone-mug", qty: 1 }],
        contact: phone,
        method: "카드",
        delivery: {
          name: "수취인",
          phone: "010-1111-2222",
          address: "서울 시험 주소",
        },
      };
      db = createOrder(db, { ...form, signature: quote(db, form).signature });
      db = payOrder(db, id, "approved");
    }
    localStorage.setItem(key, JSON.stringify(db));
  }, demoPhone);
  await page.reload();
  const second = await context.newPage();
  for (const tab of [page, second]) {
    await tab.goto("/#/orders/OM-G1");
    await tab.getByLabel("주문자 연락처").fill(demoPhone);
  }
  const old = await requestCode(page),
    fresh = await requestCode(second);
  await submitCode(page, old);
  await expect(page.getByRole("alert")).toContainText("만료");
  await submitCode(second, fresh);
  await expect(
    second.getByRole("heading", { name: "주문 상세", exact: true }),
  ).toBeVisible();
  await second.goto("/#/orders/OM-G2");
  await expect(
    second.getByRole("heading", { name: "비회원 주문 조회" }),
  ).toBeVisible();
  await second.goto("/#/orders/OM-G1");
  await second.clock.install();
  await second.reload();
  await second.clock.fastForward("15:01");
  await expect(
    second.getByRole("heading", { name: "비회원 주문 조회" }),
  ).toBeVisible();
  await page.getByLabel("주문자 연락처").fill("010-1111-2222");
  await submitCode(page, await requestCode(page));
  await expect(page.getByRole("alert")).toContainText("확인해 주세요");
});

test("가입용 인증과 독립된 비밀번호 재설정 링크는 한 번만 소비된다", async ({
  page,
  context,
}) => {
  await page.goto("/#/access?mode=reset");
  await page.getByLabel("가입 이메일").fill("seoyun@example.test");
  await button(page, "재설정 안내 요청").click();
  await page.getByText("가상 메일함").click();
  const link = page.getByRole("link", { name: "재설정 링크 열기" });
  const url = await link.getAttribute("href");
  await link.click();
  await page.getByLabel("새 비밀번호 (8자 이상)").fill("openmall reset 1");
  await button(page, "저장하고 로그인하기").click();
  await expect(page.getByRole("status")).toContainText("변경했습니다");
  const second = await context.newPage();
  await second.goto("/" + url);
  await second.getByLabel("새 비밀번호 (8자 이상)").fill("openmall reset 2");
  await button(second, "저장하고 로그인하기").click();
  await expect(second.getByRole("status")).toContainText("이미 사용한");
});

test("선택한 비회원 장바구니만 회원 주문으로 이동하고 중복 소비하지 않는다", async ({
  page,
}) => {
  await page.goto("/#/products/cotton-towel");
  await button(page, "장바구니 담기").click();
  await expect(button(page, "선택 상품 주문하기")).toBeVisible();
  await page.goto("/#/products/stone-mug");
  await button(page, "장바구니 담기").click();
  const selectedMug = page.getByLabel("스톤웨어 머그 주문 선택");
  await selectedMug.click();
  await expect(selectedMug).not.toBeChecked();
  await button(page, "선택 상품 주문하기").click();
  await page.getByRole("link", { name: "회원 로그인" }).click();
  await button(page, "체험 회원 로그인").click();
  await page.getByLabel("2,000원 정액 쿠폰 적용").check();
  await button(page, "주문 조건 확인").click();
  await page.getByLabel("상품·수량·주소·결제 금액을 확인했습니다.").check();
  await button(page, "13,000원 결제 인증").click();
  await expect(
    page.getByRole("heading", { name: "결제 인증", exact: true }),
  ).toBeVisible();
  await page.getByLabel("인증 결과").selectOption("pending");
  await button(page, "인증 결과 확인").click();
  await expect(
    page.getByRole("heading", { name: "결제 확인 중", exact: true }),
  ).toBeVisible();
  await page.reload();
  await button(page, "결과 다시 확인").click();
  await expect(
    page.getByRole("heading", { name: "주문 상세", exact: true }),
  ).toBeVisible();
  await page.goto("/#/my/account");
  await button(page, "로그아웃").click();
  await expect(
    page.getByRole("heading", { name: "상품 찾기", exact: true }),
  ).toBeVisible();
  await page.goto("/#/cart");
  await expect(page.getByLabel("스톤웨어 머그 주문 선택")).not.toBeChecked();
  await expect(page.getByLabel("코튼 핸드타월 주문 선택")).toHaveCount(0);
});
