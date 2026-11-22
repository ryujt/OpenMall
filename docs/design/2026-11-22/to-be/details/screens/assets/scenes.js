const sceneSelect = document.querySelector('#scene');
const scenes = Array.from(document.querySelectorAll('.scene'));
const pageFile = location.pathname.split('/').pop();
const params = new URLSearchParams(location.search);
const requestedQuantity = Number(params.get('qty'));
const quantity = Number.isInteger(requestedQuantity) && requestedQuantity >= 1 && requestedQuantity <= 18 ? requestedQuantity : 2;
const merchandise = 12000 * quantity;
const money = amount => amount.toLocaleString('ko-KR') + '원';
const fare = params.get('zone') === 'island' ? 6000 : 3000;
const discount = params.get('coupon') === 'yes' ? 2000 : 0;

function purchaseUrl(target, extra = {}) {
  const url = new URL(target, location.href);
  const state = {qty: quantity, zone: fare === 6000 ? 'island' : 'base', coupon: discount ? 'yes' : 'no', ...extra};
  for (const [key, value] of Object.entries(state)) url.searchParams.set(key, value);
  return url.href;
}

function showScene() {
  const requested = location.hash.slice(1);
  const current = scenes.find(scene => scene.id === requested) || scenes[0];
  for (const scene of scenes) scene.hidden = scene !== current;
  sceneSelect.value = current.id;
}

function setFacts(area, values) {
  for (const row of area.querySelectorAll('dl > div')) {
    const label = row.querySelector('dt').textContent;
    if (label in values) row.querySelector('dd').textContent = values[label];
  }
}

sceneSelect.addEventListener('change', () => { location.hash = sceneSelect.value; });
window.addEventListener('hashchange', showScene);
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (form.hasAttribute('data-search')) {
    const query = form.elements.q.value.trim();
    location.hash = !query || '코튼 핸드타월 세이지 욕실'.includes(query) ? 'base' : 'empty';
    return;
  }
  const target = form.dataset.target;
  const source = form.closest('.scene').id;
  if (pageFile === 'access.html' && target === 'account.html' && params.get('return') === 'checkout') {
    location.href = purchaseUrl('checkout.html#member');
  } else if (pageFile === 'cart.html' && source === 'quantity') {
    location.href = purchaseUrl('#base', {qty: document.querySelector('#cart-count').value});
  } else if (form.dataset.total) {
    location.href = purchaseUrl(target, {coupon: source === 'coupon' ? 'yes' : 'no', zone: 'base'});
  } else if (pageFile === 'claim.html' && ['base', 'return', 'exchange'].includes(source)) {
    const reason = form.querySelectorAll('select')[1].value;
    const url = new URL(purchaseUrl(target));
    url.searchParams.set('claimQty', Number.parseInt(form.querySelector('select').value, 10));
    url.searchParams.set('buyerCost', reason === '단순변심' && source !== 'base' ? 'yes' : 'no');
    location.href = url.href;
  } else if (target) {
    location.href = target;
  }
});

if (pageFile === 'cart.html') {
  setFacts(document.querySelector('#base'), {'수량': quantity + '개', '상품 금액': money(merchandise), '결제 예정 금액': money(merchandise + 3000)});
  const input = document.querySelector('#cart-count');
  const output = document.querySelector('#cart-quote');
  function showQuote() {
    output.textContent = input.validity.valid ? '상품 금액 ' + money(12000 * Number(input.value)) : '1~18개를 선택해 주세요.';
  }
  input.value = quantity;
  input.addEventListener('input', showQuote);
  showQuote();
  document.querySelector('a[href="checkout.html"]').href = purchaseUrl('checkout.html', {coupon:'no',zone:'base'});
}
if (pageFile === 'checkout.html') {
  document.querySelector('a[href="access.html?return=checkout"]').href = purchaseUrl('access.html?return=checkout');
  for (const id of ['guest', 'member', 'coupon']) {
    document.getElementById(id).classList.add('confirm-order');
    const scene = document.getElementById(id);
    const total = money(merchandise + 3000 - (id === 'coupon' ? 2000 : 0));
    setFacts(scene, {'수량': quantity + '개', '상품 금액': money(merchandise), '결제 예정 금액': total});
    scene.querySelector('button').textContent = total + ' 결제하기';
  }
  const changed = document.querySelector('#changed a[href="#pg"]');
  changed.href = purchaseUrl('#pg', {zone:'island', coupon:'no'});
  const newTotal = money(merchandise + 6000);
  changed.textContent = newTotal + ' 확인 후 결제하기';
  document.querySelector('#changed p').textContent = '배송비가 3,000원에서 6,000원으로 변경되었습니다. 변경된 합계 ' + newTotal + '을 확인해 주세요.';
  for (const a of document.querySelectorAll('a[href="order.html#paid"]')) a.href = purchaseUrl('order.html#paid');
}
if (pageFile === 'order.html') {
  for (const id of ['paid', 'receipt']) {
    const scene = document.getElementById(id);
    const total = money(merchandise + fare - discount);
    setFacts(scene, {'수량': quantity + '개', '상품 금액': money(merchandise), '승인 금액': total, '결제 금액': total, '배송비': money(fare)});
    if (discount && id === 'paid') scene.querySelector('dl:last-of-type').insertAdjacentHTML('beforeend', '<div><dt>주문 쿠폰</dt><dd>−2,000원</dd></div>');
  }
  document.querySelector('a[href="claim.html"]').href = purchaseUrl('claim.html');
}
if (pageFile === 'claim.html') {
  for (const id of ['base','return','exchange']) {
    const scene = document.getElementById(id);
    setFacts(scene, {'수량': quantity + '개', '상품 금액': money(merchandise)});
    scene.querySelector('.grid .box p').textContent = '예시 주문의 신청 가능 수량은 ' + quantity + '개입니다.';
    const amountSelect = scene.querySelector('select');
    amountSelect.replaceChildren();
    for (let count = 1; count <= quantity; count++) amountSelect.add(new Option(count + '개', count));
    const requested = Number(params.get('claimQty'));
    const count = Number.isInteger(requested) && requested >= 1 && requested <= quantity ? requested : 1;
    const buyerPays = params.get('buyerCost') === 'yes' && id !== 'base';
    const fee = buyerPays ? (id === 'exchange' ? 6000 : 3000) : 0;
    // The example allocates leftover coupon won to the first units of the line.
    const lineDiscount = Math.floor(discount / quantity) * count + Math.min(count, discount % quantity);
    const linePaid = 12000 * count - lineDiscount;
    const refund = linePaid + (quantity === count && id === 'base' ? fare : 0) - fee;
    setFacts(document.getElementById('estimate-' + id), {
      '예시 신청 수량': count + '개', '품목 결제액': money(linePaid), '예시 고객 부담액': money(fee),
      '처리 내용': id === 'exchange' ? '동일 옵션 ' + count + '개 재배송' : '예상 환불 ' + money(refund)
    });
  }
}
showScene();
