import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRewardAmount,
  collapsePartialRecoveryRows,
  netProductAmount,
} from "../lib/rewardCalculation.ts";

test("다수 수량 품목 결제금액을 다시 수량만큼 곱하지 않는다", () => {
  const order = {
    payment_amount: 3_015_300,
    actual_order_amount: { order_price_amount: 3_135_000 },
    items: [{ payment_amount: 3_015_300, quantity: 11, status_code: "N1" }],
  };
  assert.deepEqual(calculateRewardAmount(order, 6), { baseAmount: 3_015_300, amount: 180_918 });
});

test("여러 정상 품목의 결제금액만 합산한다", () => {
  const order = {
    payment_amount: 45_000,
    items: [
      { payment_amount: 30_000, quantity: 2, status_code: "N1" },
      { payment_amount: 15_000, quantity: 1, status_code: "N1" },
    ],
  };
  assert.equal(netProductAmount(order), 45_000);
});

test("취소 또는 반품 품목은 적립 기준에서 제외한다", () => {
  const order = {
    payment_amount: 30_000,
    items: [
      { payment_amount: 30_000, quantity: 1, status_code: "N1" },
      { payment_amount: 20_000, quantity: 1, status_code: "C2" },
      { payment_amount: 10_000, quantity: 1, status_code: "C3" },
    ],
  };
  assert.deepEqual(calculateRewardAmount(order, 3), { baseAmount: 30_000, amount: 900 });
});

test("품목 합계가 주문 총액보다 크면 지급 계산을 중단한다", () => {
  const order = {
    payment_amount: 100_000,
    actual_order_amount: { order_price_amount: 110_000 },
    items: [{ payment_amount: 1_100_000, quantity: 11, status_code: "N1" }],
  };
  assert.equal(calculateRewardAmount(order, 6), null);
});

test("결제금액이나 수량이 유효하지 않으면 지급 계산을 중단한다", () => {
  assert.equal(netProductAmount({ items: [{ payment_amount: -1, quantity: 1 }] }), null);
  assert.equal(netProductAmount({ items: [{ payment_amount: 1000, quantity: 0 }] }), null);
});

test("과지급 일부 회수는 최종 지급액 한 건으로 표시한다", () => {
  const rows = collapsePartialRecoveryRows([
    { id: 2, external_order_id: "order-1", action: "recover", amount: 1_809_180, status: "succeeded" },
    { id: 1, external_order_id: "order-1", action: "issue", amount: 1_990_098, status: "succeeded" },
  ], 30);
  assert.deepEqual(rows, [
    { id: 1, external_order_id: "order-1", action: "issue", amount: 180_918, status: "succeeded" },
  ]);
});

test("전액 회수는 지급과 회수 기록을 유지한다", () => {
  const rows = collapsePartialRecoveryRows([
    { id: 2, external_order_id: "order-1", action: "recover", amount: 1_000, status: "succeeded" },
    { id: 1, external_order_id: "order-1", action: "issue", amount: 1_000, status: "succeeded" },
  ], 30);
  assert.equal(rows.length, 2);
});

