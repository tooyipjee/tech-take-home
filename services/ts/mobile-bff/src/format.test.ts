import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, maskPan } from "./format.ts";

test("formats pounds and pence", () => {
  assert.equal(formatMoney(123456, "GBP"), "£1234.56");
});

test("masks all but the last four digits", () => {
  assert.equal(maskPan("4111 1111 1111 1234"), "•••• 1234");
});
