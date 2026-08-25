/**
 * One database, several test files, and no test that can tolerate a stranger in it.
 *
 * Every test in here resets and reseeds the whole database, then asserts about *all* the
 * rows of some kind — every refund against a payment, every audit row for a capability,
 * every approval that exists. The node test runner runs files concurrently (as many as
 * the machine has cores), so on a two-core laptop these files happen to run one at a
 * time and on a CI runner they do not: one file truncates the tables the other is
 * counting, and the failures read like invariant bugs rather than what they are.
 *
 * So each test takes the database exclusively, with a Postgres advisory lock held on its
 * own connection for the length of the test. Serial where it must be, concurrent
 * everywhere else, and the alternative — telling the runner to stop parallelising — is a
 * root-config change that would slow every other suite down to fix this one.
 */
import { pool } from "@rangka/db";
import type { PgClient } from "@rangka/db";

/** Arbitrary but stable: any two holders of this number are these test files. */
const DATABASE_LOCK = 4_155_003;

let holder: PgClient | null = null;

/** Blocks until no other test file is using the database. */
export async function takeDatabase(): Promise<void> {
  const client: PgClient = await pool.connect();
  await client.query("select pg_advisory_lock($1)", [DATABASE_LOCK]);
  holder = client;
}

export async function releaseDatabase(): Promise<void> {
  if (!holder) return;
  const client = holder;
  holder = null;
  await client.query("select pg_advisory_unlock($1)", [DATABASE_LOCK]);
  client.release();
}
