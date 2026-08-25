import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { PolicyDeclarationError } from "../src/errors.ts";
import { defineWrite } from "../src/registry.ts";
import { getTenet, tenets, tenetsFor } from "../src/tenets.ts";
import "@platform/capabilities";

/**
 * Structural checks on the derivation. The behavioural proof that each statement
 * actually holds lives in ./db/invariants.test.ts, which attacks them against a
 * real database.
 */
test("every tenet is well formed and says what it was derived from", () => {
  const ids = new Set<string>();
  for (const tenet of tenets()) {
    assert.ok(tenet.id.length > 0, "tenet needs an id");
    assert.ok(!ids.has(tenet.id), `duplicate tenet id ${tenet.id}`);
    ids.add(tenet.id);
    assert.match(tenet.statement, /\.$/, `${tenet.id}: statement should read as a sentence`);
    assert.match(tenet.query, /as subject/, `${tenet.id}: query must return a subject column`);
    assert.match(tenet.query, /as detail/, `${tenet.id}: query must return a detail column`);
    assert.ok(tenet.derivedFrom.length > 0, `${tenet.id}: must name what it derives from`);
  }
});

test("declaring refunds.issue derives its whole rule set", () => {
  assert.deepEqual(
    tenets()
      .map((tenet) => tenet.id)
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
  const guarded = tenetsFor("refunds.issue").map((tenet) => tenet.id);
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

test("thresholds inside a derived tenet come from the registry, not a second copy", () => {
  const ceiling = getTenet("refunds.issue.respects_declared_ceiling");
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

test("no tenet is in force without a test that attacks it", () => {
  const sources = readdirSync("packages/kernel/test/db")
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => readFileSync(`packages/kernel/test/db/${entry}`, "utf8"))
    .join("\n");
  const untested = tenets()
    .map((tenet) => tenet.id)
    .filter((id) => !sources.includes(id));
  assert.deepEqual(untested, [], "a tenet with no test is a sentence, not a guarantee");
});

test("getTenet finds a tenet by id", () => {
  assert.equal(getTenet("refunds.issue.conserves_payments")?.halts[0], "refunds.issue");
  assert.equal(getTenet("nope"), undefined);
});
