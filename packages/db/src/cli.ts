import { migrate } from "./migrate.ts";
import { resetAndSeed, seed } from "./seed.ts";
import { pool } from "./pool.ts";

const command = process.argv[2];

try {
  if (command === "migrate") {
    const applied = await migrate();
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "no pending migrations");
  } else if (command === "seed") {
    await seed();
    console.log("seeded");
  } else if (command === "reset") {
    await migrate();
    await resetAndSeed();
    console.log("database reset and seeded");
  } else {
    console.error("usage: cli.ts <migrate|seed|reset>");
    process.exit(1);
  }
} finally {
  await pool.end();
}
