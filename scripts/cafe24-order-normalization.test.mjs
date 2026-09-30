import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCafe24Order } from "../lib/cafe24.ts";

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
