import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { clearRegistry, defineWrite, listCapabilities } from "../src/index.ts";

/**
 * The registry is the first of the three places a rule is enforced, and the cheapest:
 * a capability whose declaration cannot be proved after the fact never boots at all.
 */

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
          effect: { table: "widgets", subjectColumn: "widget_id" },
        },
        handler: async () => null,
      }),
    /amountField/,
  );
});

test("a write with no declared effect is rejected: nothing about it could be proved", () => {
  clearRegistry();
  assert.throws(
    () =>
      defineWrite({
        name: "bad.noEffect",
        summary: "writes somewhere unstated",
        input: z.object({ caseId: z.string() }),
        policy: {
          scope: "x:write",
          idempotent: true,
          limits: { maxAmountCents: null, maxPerHour: 5 },
          approval: { mode: "never" },
          approverScope: "approvals:decide",
        },
        handler: async () => null,
      }),
    /declares no effect/,
  );
});

test("approval derived from a record requires the record to be declared", () => {
  clearRegistry();
  assert.throws(
    () =>
      defineWrite({
        name: "bad.derivedWithoutSubject",
        summary: "asks about a row it never names",
        input: z.object({ caseId: z.string() }),
        policy: {
          scope: "x:write",
          idempotent: true,
          limits: { maxAmountCents: null, maxPerHour: 5 },
          approval: {
            mode: "derived_from_subject",
            clauses: [
              { when: "s.risk_band = 'high'", approverScope: "x:decide", because: "high risk" },
            ],
          },
          approverScope: "x:decide",
          effect: { table: "widgets", subjectColumn: "widget_id" },
        },
        handler: async () => null,
      }),
    /declares no subject table/,
  );
});

test("a well-formed capability registers", () => {
  clearRegistry();
  defineWrite({
    name: "good.capability",
    summary: "fine",
    input: z.object({ caseId: z.string() }),
    policy: {
      scope: "x:write",
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 5 },
      approval: {
        mode: "derived_from_subject",
        clauses: [
          { when: "s.risk_band = 'high'", approverScope: "x:decide", because: "high risk" },
        ],
      },
      approverScope: "x:decide",
      subject: { table: "kyc_cases", idField: "caseId" },
      effect: { table: "kyc_case_decisions", subjectColumn: "case_id", oncePerSubject: true },
    },
    handler: async () => null,
  });
  assert.equal(listCapabilities().length, 1);
});
