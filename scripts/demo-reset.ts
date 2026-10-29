import postgres from "postgres";
import { createScriptAdminClient } from "./lib/admin-client.ts";

async function main() {
  if (process.env.DEMO_RESET_ALLOWED !== "true") {
    console.error('DEMO_RESET_ALLOWED must be "true" to run demo:reset.');
    process.exit(1);
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL is not set.");
    process.exit(1);
  }

  process.env.SERVICE_ROLE_CALLER = "reset";
  const admin = createScriptAdminClient();

  const { data: institution, error } = await admin
    .from("institutions")
    .select("id")
    .eq("slug", "st-josephs-demo")
    .maybeSingle();
  if (error) throw error;

  if (institution) {
    const sql = postgres(dbUrl, { max: 1 });
    const startedAt = Date.now();
    try {
      const counts = await sql`select * from app.demo_reset(${institution.id}::uuid)`;
      console.log(`Reset ${counts.length} table(s) in ${Date.now() - startedAt}ms:`);
      for (const row of counts) {
        console.log(`  ${row.table_name}: ${row.deleted_count}`);
      }
    } finally {
      await sql.end();
    }
  } else {
    console.log("No demo institution found yet — nothing to reset.");
  }

  await import("./seed/index.ts");
}

main().catch((err: unknown) => {
  console.error("demo:reset failed:", err);
  process.exit(1);
});
