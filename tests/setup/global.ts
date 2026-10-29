import postgres from "postgres";

// Global setup for the db/security Vitest projects (.env.local is already
// loaded by vitest.config.mts's loadDotEnvLocal). Per-role fixtures and
// clients live in tests/helpers/roles.ts (T-009); this just fails fast with
// a clear message if Supabase isn't up, instead of 30+ cryptic connection
// errors from every test file.
export default async function setup() {
  process.env.SERVICE_ROLE_CALLER = "test";

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error("SUPABASE_DB_URL is not set — run `pnpm db:start` and populate .env.local.");
  }

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 5 });
  try {
    await sql`select 1`;
  } catch (err) {
    throw new Error(
      `Could not reach Supabase at SUPABASE_DB_URL (${dbUrl}). Run \`pnpm db:start\` first.\n${String(err)}`,
    );
  } finally {
    await sql.end();
  }
}
