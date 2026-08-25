import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { PolicyDeclarationError } from "../src/errors.ts";
import { defineWrite } from "../src/registry.ts";
import { getInvariant, invariants, invariantsFor } from "../src/invariants.ts";
import "@rangka/capabilities";

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

test("declaring kyc.case.approve derives its whole rule set", () => {
  assert.deepEqual(
    invariantsFor("kyc.case.approve")
      .map((invariant) => invariant.id)
      .sort(),
    [
      "kyc.case.approve.carries_the_declared_approval",
      "kyc.case.approve.effects_are_attributed",
      "kyc.case.approve.happens_at_most_once_per_subject",
      "kyc.case.approve.is_idempotent",
      "kyc.case.approve.respects_declared_rate",
    ],
    "the derived set changing means a declaration changed; that is a tier-2 review",
  );
});

test("every write in the registry is guarded, and only writes are", () => {
  const guarded = new Map<string, string[]>();
  for (const invariant of invariants()) {
    for (const capability of invariant.postconditionFor) {
      guarded.set(capability, [...(guarded.get(capability) ?? []), invariant.id]);
    }
  }
  assert.deepEqual(
    [...guarded.keys()].sort(),
    [
      "kyc.case.approve",
      "kyc.case.claim",
      "kyc.case.escalate",
      "kyc.case.pii.reveal",
      "kyc.case.reject",
      "kyc.case.requestInfo",
      "kyc.case.sar.file",
    ],
    "a write with no derived rule would be an unprovable money-adjacent action",
  );
  for (const [capability, ids] of guarded) {
    for (const kind of ["effects_are_attributed", "is_idempotent", "respects_declared_rate"]) {
      assert.ok(
        ids.includes(`${capability}.${kind}`),
        `${capability} declares ${kind} but it is never proved`,
      );
    }
  }
});

test("thresholds inside a derived invariant come from the registry, not a second copy", () => {
  const rate = getInvariant("kyc.case.sar.file.respects_declared_rate");
  assert.match(rate?.query ?? "", /from capability_registry where name = 'kyc\.case\.sar\.file'/);
  assert.doesNotMatch(rate?.query ?? "", /\b5\b/, "a hard-coded threshold can drift");
});

test("who must approve is read off the case, not baked into the statement", () => {
  const approval = getInvariant("kyc.case.approve.carries_the_declared_approval");
  // The rule the reviewer wrote — sanctions exposure needs compliance — appears in
  // the proof itself, so history is judged by the same clause the runtime applied.
  assert.match(approval?.query ?? "", /kyc:sar/);
  assert.match(approval?.query ?? "", /kyc_screening_hits/);
  assert.match(approval?.query ?? "", /approver_scope/);
});

test("a write must declare where its effect lands", () => {
  assert.throws(
    () =>
      defineWrite({
        name: "test.unprovable",
        summary: "changes a case without declaring an effect",
        input: z.object({ caseId: z.string() }),
        policy: {
          scope: "kyc:decide",
          idempotent: true,
          limits: { maxAmountCents: null, maxPerHour: 1 },
          approval: { mode: "never" },
          approverScope: "approvals:decide",
        },
        handler: async () => ({}),
      }),
    PolicyDeclarationError,
  );
});

test("no invariant is in force without a test that attacks it, by kind", () => {
  const sources = readdirSync("packages/kernel/test/db")
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => readFileSync(`packages/kernel/test/db/${entry}`, "utf8"))
    .join("\n");
  // Every derived id is re-run against committed data by the reconciliation test;
  // this asserts each *kind* of statement is also attacked by name, so a new
  // derivation cannot ship with nothing but a green reconcile behind it.
  const kinds = new Set(
    invariants().map((invariant) =>
      invariant.id.startsWith("approvals.") ? invariant.id : invariant.id.split(".").pop() ?? "",
    ),
  );
  const untested = [...kinds].filter((kind) => !sources.includes(kind)).sort();
  assert.deepEqual(untested, [], "an invariant with no test is a sentence, not a guarantee");
});

test("getInvariant finds an invariant by id", () => {
  assert.equal(
    getInvariant("kyc.case.approve.carries_the_declared_approval")?.halts[0],
    "kyc.case.approve",
  );
  assert.equal(getInvariant("nope"), undefined);
});
