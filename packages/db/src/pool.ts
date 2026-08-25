import pg from "pg";

const { Pool } = pg;

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://platform:platform@localhost:5433/platform";

export const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

export type PgClient = pg.PoolClient;

/** Runs `fn` inside a transaction. Rolls back on throw. */
export async function withTransaction<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function withClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
