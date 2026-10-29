import postgres from "postgres";
import { createScriptAdminClient } from "../lib/admin-client.ts";
import { getSeedScale } from "./config.ts";
import { createSeedContext, type SeedContext } from "./lib/context.ts";
import { mulberry32, SEED_PRNG_SEED } from "./lib/prng.ts";
import { run as runAcademics } from "./sections/academics.ts";
import { run as runAdmissions } from "./sections/admissions.ts";
import { run as runAttendance } from "./sections/attendance.ts";
import { run as runCore } from "./sections/core.ts";
import { run as runExams } from "./sections/exams.ts";
import { run as runFinance } from "./sections/finance.ts";
import { run as runPeople } from "./sections/people.ts";
import { run as runWebsite } from "./sections/website.ts";

const SECTIONS: { name: string; run: (ctx: SeedContext) => Promise<void> }[] = [
  { name: "core", run: runCore },
  { name: "people", run: runPeople },
  { name: "academics", run: runAcademics },
  { name: "attendance", run: runAttendance },
  { name: "admissions", run: runAdmissions },
  { name: "finance", run: runFinance },
  { name: "exams", run: runExams },
  { name: "website", run: runWebsite },
];

async function resetIfNeeded(admin: ReturnType<typeof createScriptAdminClient>, dbUrl: string) {
  const { data: institution } = await admin
    .from("institutions")
    .select("id")
    .eq("slug", "st-josephs-demo")
    .maybeSingle();
  if (!institution) return;

  const { count } = await admin
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", institution.id);
  if (!count) return;

  if (process.env.DEMO_RESET_ALLOWED !== "true") {
    console.error(
      `The demo institution already has ${count} student(s). Set DEMO_RESET_ALLOWED=true to reset and reseed, or run \`pnpm demo:reset\`.`,
    );
    process.exit(1);
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql`select app.demo_reset(${institution.id}::uuid)`;
  } finally {
    await sql.end();
  }
}

async function main() {
  process.env.SERVICE_ROLE_CALLER = "seed";

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL is not set.");
    process.exit(1);
  }

  const startedAt = Date.now();
  const admin = createScriptAdminClient();
  await resetIfNeeded(admin, dbUrl);

  const ctx = createSeedContext(mulberry32(SEED_PRNG_SEED), admin);
  console.log(`Seeding (scale: ${getSeedScale()})...`);

  for (const section of SECTIONS) {
    const sectionStartedAt = Date.now();
    await section.run(ctx);
    console.log(`  ${section.name}: ${Date.now() - sectionStartedAt}ms`);
  }

  console.log(`Seed complete in ${Date.now() - startedAt}ms.`);
}

main().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
