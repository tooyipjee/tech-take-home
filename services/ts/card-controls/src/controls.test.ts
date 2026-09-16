import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./controls.ts";

const open = { frozen: false, blockedCategories: [], contactlessEnabled: true, onlineEnabled: true };
const attempt = { amountCents: 1000, category: "groceries", contactless: false, online: false, spentThisMonthCents: 0 };

test("allows an ordinary purchase", () => {
  assert.deepEqual(evaluate(open, attempt), { allowed: true });
});

test("a frozen card declines everything", () => {
  assert.deepEqual(evaluate({ ...open, frozen: true }, attempt), { allowed: false, reason: "card_frozen" });
});
