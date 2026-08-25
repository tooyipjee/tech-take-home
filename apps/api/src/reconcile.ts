/**
 * One-shot reconciliation, for CI, cron, or a human asking "is it still true?".
 * Exits non-zero on a violation so a scheduler can page on it.
 */
import { migrate, pool } from "@rangka/db";
import { describeViolations, reconcile, syncRegistry } from "@rangka/kernel";
import "@rangka/capabilities";

try {
  await migrate();
  // Invariants read declared thresholds from the registry, so it must reflect the
  // policy this build declares before anything is checked against it.
  await syncRegistry();
  const result = await reconcile();
  if (result.violations.length === 0) {
    console.log(`all invariants held at ${result.checkedAt}`);
  } else {
    console.error(`${result.violations.length} violation(s): ${describeViolations(result.violations)}`);
    if (result.halted.length > 0) console.error(`halted: ${result.halted.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
