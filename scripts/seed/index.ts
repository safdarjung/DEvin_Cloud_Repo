import postgres from "postgres";
import { createScriptAdminClient } from "../lib/admin-client.ts";
import { getSeedScale } from "./config.ts";
import { createSeedContext, type SeedContext } from "./lib/context.ts";
import { GRADES, sectionNames } from "./lib/grades.ts";
import { mulberry32, SEED_PRNG_SEED } from "./lib/prng.ts";
import { run as runAcademics } from "./sections/academics.ts";
import { run as runAdmissions } from "./sections/admissions.ts";
import { run as runAttendance } from "./sections/attendance.ts";
import { run as runCore } from "./sections/core.ts";
import { run as runExams } from "./sections/exams.ts";
import { run as runFinance } from "./sections/finance.ts";
import { run as runOperations } from "./sections/operations.ts";
import { run as runPeople } from "./sections/people.ts";
import { run as runTimetable } from "./sections/timetable.ts";
import { run as runWebsite } from "./sections/website.ts";

const SECTIONS: { name: string; run: (ctx: SeedContext) => Promise<void> }[] = [
  { name: "core", run: runCore },
  { name: "people", run: runPeople },
  { name: "academics", run: runAcademics },
  { name: "timetable", run: runTimetable },
  // M13-T11: right after timetable, so public.rooms already exists for assets.room_id.
  { name: "operations", run: runOperations },
  { name: "attendance", run: runAttendance },
  { name: "admissions", run: runAdmissions },
  { name: "finance", run: runFinance },
  { name: "exams", run: runExams },
  { name: "website", run: runWebsite },
];

async function resetIfNeeded(admin: ReturnType<typeof createScriptAdminClient>, sql: ReturnType<typeof postgres>) {
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

  await sql`select app.demo_reset(${institution.id}::uuid)`;
}

/** 05 §8.2 count assertions — thrown loud if a reset ever drifts from the documented contract. */
async function assertCounts(ctx: SeedContext): Promise<void> {
  const expectedSections = GRADES.reduce((sum, grade) => sum + sectionNames(grade.code).length, 0);
  const expectedStudents = expectedSections * 42;

  const counts: Record<string, number> = {};
  for (const table of [
    "students",
    "guardians",
    "guardian_students",
    "staff",
    "class_sections",
    "enrolments",
    "attendance_sessions",
    "attendance_records",
  ] as const) {
    // "*" (not "id") — guardian_students has no `id` column, only a composite PK.
    const { count, error } = await ctx.admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("institution_id", ctx.institutionId);
    if (error) throw new Error(`Count query failed for ${table}: ${error.message}`);
    counts[table] = count ?? 0;
  }
  console.log(`Counts: ${JSON.stringify(counts)}`);

  const expectations: [string, number][] = [
    ["students", expectedStudents],
    ["class_sections", expectedSections],
    ["staff", 106],
    ["enrolments", expectedStudents],
    ["attendance_sessions", expectedSections * 60],
    ["attendance_records", expectedStudents * 60],
  ];
  for (const [table, expected] of expectations) {
    if (counts[table] !== expected) {
      throw new Error(`Count assertion failed: ${table} expected ${expected}, got ${counts[table]}`);
    }
  }
  // 05 §8.1's ~2,300 minimum is a full-scale number (1-2 children per guardian); scale it with SEED_SCALE.
  const minGuardians = Math.floor(expectedStudents * 0.75);
  if (counts.guardians! < minGuardians) {
    throw new Error(`Count assertion failed: guardians expected >= ${minGuardians}, got ${counts.guardians}`);
  }
  if (counts.guardian_students! < expectedStudents) {
    throw new Error(
      `Count assertion failed: guardian_students expected >= ${expectedStudents}, got ${counts.guardian_students}`,
    );
  }

  const { count: homeworkAssignments } = await ctx.admin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institutionId);
  if (homeworkAssignments) {
    throw new Error(`Count assertion failed: assignments (homework) expected 0, got ${homeworkAssignments}`);
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
  const sql = postgres(dbUrl, { max: 1 });

  try {
    await resetIfNeeded(admin, sql);

    const ctx = createSeedContext(mulberry32(SEED_PRNG_SEED), admin, sql);
    console.log(`Seeding (scale: ${getSeedScale()})...`);

    for (const section of SECTIONS) {
      const sectionStartedAt = Date.now();
      await section.run(ctx);
      console.log(`  ${section.name}: ${Date.now() - sectionStartedAt}ms`);
    }

    await assertCounts(ctx);
    console.log(`Seed complete in ${Date.now() - startedAt}ms.`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
