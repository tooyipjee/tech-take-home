import pg from "pg";

const { Client } = pg;

const url = process.env.DATABASE_URL ?? "postgres://platform:platform@localhost:5433/platform";

for (let attempt = 1; attempt <= 40; attempt++) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log("database ready");
    process.exit(0);
  } catch {
    await client.end().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.error("database did not become ready in time");
process.exit(1);
