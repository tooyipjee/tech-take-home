import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { clearRegistry, defineWrite, listCapabilities } from "../src/index.ts";

test("a write capability cannot be registered without declared limits", () => {
  clearRegistry();
  assert.throws(
    () =>
      defineWrite({
        name: "bad.noPolicy",
        summary: "missing limits",
        input: z.object({}),
        // @ts-expect-error deliberately invalid declaration
        policy: { scope: "x:write", idempotent: true, approverScope: "approvals:decide" },
        handler: async () => null,
      }),
    /invalid policy/,
  );
});

test("an amount ceiling without an amountField is rejected at boot", () => {
  clearRegistry();
  assert.throws(
    () =>
      defineWrite({
        name: "bad.noAmountField",
        summary: "ceiling with nothing to measure",
        input: z.object({ amountCents: z.number() }),
        policy: {
          scope: "x:write",
          idempotent: true,
          limits: { maxAmountCents: 1000, maxPerHour: 5 },
          approval: { mode: "never" },
          approverScope: "approvals:decide",
        },
        handler: async () => null,
      }),
    /amountField/,
  );
});

test("a well-formed capability registers", () => {
  clearRegistry();
  defineWrite({
    name: "good.capability",
    summary: "fine",
    input: z.object({ amountCents: z.number() }),
    policy: {
      scope: "x:write",
      idempotent: true,
      limits: { maxAmountCents: 1000, maxPerHour: 5 },
      approval: { mode: "above_amount", amountCents: 500 },
      approverScope: "approvals:decide",
      amountField: "amountCents",
    },
    handler: async () => null,
  });
  assert.equal(listCapabilities().length, 1);
});
