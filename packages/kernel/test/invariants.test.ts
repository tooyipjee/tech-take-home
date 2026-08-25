import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { PolicyDeclarationError } from "../src/errors.ts";
import { defineWrite } from "../src/registry.ts";
import { getInvariant, invariants, invariantsFor } from "../src/invariants.ts";
import "@platform/capabilities";

/**
 * Structural checks on the derivation. The behavioural proof that each statement
 * actually holds lives in ./db/invariants.test.ts, which attacks them against a
 * real database.
 */
test("every invariant is well formed and says what it was derived from", () => {
  const ids = new Set<string>();
  for (const invariant of invariants()) {
    assert.ok(invariant.id.length > 0, "invariant needs an id");
    assert.ok(!ids.has(invariant.id), `duplicate invariant id ${invariant.id}`);
    ids.add(invariant.id);
    assert.match(invariant.statement, /\.$/, `${invariant.id}: statement should read as a sentence`);
    assert.match(invariant.query, /as subject/, `${invariant.id}: query must return a subject column`);
    assert.match(invariant.query, /as detail/, `${invariant.id}: query must return a detail column`);
    assert.ok(invariant.derivedFrom.length > 0, `${invariant.id}: must name what it derives from`);
  }
});

test("declaring refunds.issue derives its whole rule set", () => {
  assert.deepEqual(
    invariants()
      .map((invariant) => invariant.id)
      .sort(),
    [
      "approvals.decided_by_a_second_person",
      "refunds.issue.carries_the_declared_approval",
      "refunds.issue.conserves_payments",
      "refunds.issue.effects_are_attributed",
      "refunds.issue.is_idempotent",
      "refunds.issue.respects_declared_ceiling",
      "refunds.issue.respects_declared_rate",
    ],
    "the derived set changing means a declaration changed; that is a tier-2 review",
  );
});

test("every rule a policy declares is proved after the fact, in the same transaction", () => {
  const guarded = invariantsFor("refunds.issue").map((invariant) => invariant.id);
  for (const rule of [
    "refunds.issue.conserves_payments",
    "refunds.issue.effects_are_attributed",
    "refunds.issue.respects_declared_ceiling",
    "refunds.issue.carries_the_declared_approval",
    "refunds.issue.respects_declared_rate",
    "refunds.issue.is_idempotent",
  ]) {
    assert.ok(guarded.includes(rule), `${rule} is declared but never proved`);
  }
});

test("thresholds inside a derived invariant come from the registry, not a second copy", () => {
  const ceiling = getInvariant("refunds.issue.respects_declared_ceiling");
  assert.match(ceiling?.query ?? "", /from capability_registry where name = 'refunds\.issue'/);
  assert.doesNotMatch(ceiling?.query ?? "", /200000/, "a hard-coded threshold can drift");
});

test("a capability that moves money must declare where the money lands", () => {
  assert.throws(
    () =>
      defineWrite({
        name: "test.unprovable",
        summary: "moves money without declaring an effect",
        input: z.object({ amountCents: z.number() }),
        policy: {
          scope: "refunds:write",
          idempotent: true,
          limits: { maxAmountCents: 1000, maxPerHour: 1 },
          approval: { mode: "never" },
          approverScope: "approvals:decide",
          amountField: "amountCents",
        },
        handler: async () => ({}),
      }),
    PolicyDeclarationError,
  );
});

test("no invariant is in force without a test that attacks it", () => {
  const sources = readdirSync("packages/kernel/test/db")
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => readFileSync(`packages/kernel/test/db/${entry}`, "utf8"))
    .join("\n");
  const untested = invariants()
    .map((invariant) => invariant.id)
    .filter((id) => !sources.includes(id));
  assert.deepEqual(untested, [], "an invariant with no test is a sentence, not a guarantee");
});

test("getInvariant finds an invariant by id", () => {
  assert.equal(getInvariant("refunds.issue.conserves_payments")?.halts[0], "refunds.issue");
  assert.equal(getInvariant("nope"), undefined);
});
