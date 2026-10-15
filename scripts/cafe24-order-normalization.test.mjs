import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCafe24Order, extractCafe24CardReceiptMethod, extractCafe24YoutubeNickname } from "../lib/cafe24.ts";

test("Cafe24 주문 스냅샷에서 추가된 모든 품목명과 수량을 합친다", () => {
  const normalized = normalizeCafe24Order({
    order: {
      order_id: "20260930-0000152",
      billing_name: "구매자",
      payment_confirmation: "T",
      items: [
        { product_name: "상품 A", quantity: "2", product_price: "10000" },
        { product_name: "상품 B", quantity: "1", product_price: "15000" },
      ],
    },
  });

  assert.equal(normalized?.product, "상품 A · 상품 B");
  assert.equal(normalized?.quantity, 3);
  assert.equal(normalized?.paid, true);
});

const receiptMethods = [
  "포켓몬 AR 이상 · 원피스 패러렐 카드 수령",
  "포켓몬 RR 이상 · 원피스 SR 이상 수령",
  "전체 카드 수령",
];
for (const method of receiptMethods) {
  test("카드 수령 방식과 닉네임을 분리해서 읽는다: " + method, () => {
    const info = "유튜브 닉네임 = 샘플닉네임\n카드 수령 방식 = " + method;
    const order = normalizeCafe24Order({resource:{order_id:"TEST-RECEIPT",billing_name:"샘플",additional_order_info_list:info}});
    assert.equal(order.cardReceiptMethod, method);
    assert.equal(order.youtubeNickname, "샘플닉네임");
  });
}
test("배열·객체·JSON 추가입력도 카드 수령 방식을 읽는다", () => {
  for (const raw of [
    [{name:"유튜브 닉네임",value:"샘플"},{name:"카드 수령 방식",value:receiptMethods[0]}],
    {"카드수령방식":receiptMethods[0]},
    JSON.stringify([{title:"카드 수령 방식",content:receiptMethods[0]}]),
  ]) assert.equal(extractCafe24CardReceiptMethod(raw), receiptMethods[0]);
});
test("카드 수령 방식이 없는 과거 주문에 값을 만들어 넣지 않는다", () => {
  for (const raw of [null, undefined, "유튜브 닉네임 = 샘플", [], {name:"카드 수령 방식",value:""}]) {
    assert.equal(extractCafe24CardReceiptMethod(raw), null);
  }
  assert.equal(extractCafe24YoutubeNickname([{name:"유튜브 닉네임",value:"샘플"}]), "샘플");
});
