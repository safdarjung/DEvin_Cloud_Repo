import postgres from "postgres";
import { createScriptAdminClient } from "../lib/admin-client.ts";
import { getSeedScale } from "./config.ts";
import { createSeedContext, type SeedContext } from "./lib/context.ts";
import { GRADES, sectionNames } from "./lib/grades.ts";
import { mulberry32, SEED_PRNG_SEED } from "./lib/prng.ts";
import { run as runAcademics } from "./sections/academics.ts";
import { run as runAdmissions } from "./sections/admissions.ts";
import { run as runAttendance } from "./sections/attendance.ts";
import { run as runCertificates } from "./sections/certificates.ts";
import { run as runCore } from "./sections/core.ts";
import { run as runCurriculum } from "./sections/curriculum.ts";
import { run as runExamSeating } from "./sections/exam-seating.ts";
import { run as runExams } from "./sections/exams.ts";
import { run as runFabric } from "./sections/fabric.ts";
import { run as runFeePlans } from "./sections/fee-plans.ts";
import { run as runFinance } from "./sections/finance.ts";
import { run as runHomework } from "./sections/homework.ts";
import { run as runLibrary } from "./sections/library.ts";
import { run as runMastery } from "./sections/mastery.ts";
import { run as runNotifications } from "./sections/notifications.ts";
import { run as runHomeroom } from "./sections/homeroom.ts";
import { run as runOperations } from "./sections/operations.ts";
import { run as runPeople } from "./sections/people.ts";
import { run as runPayroll } from "./sections/payroll.ts";
import { run as runPtm } from "./sections/ptm.ts";
import { run as runAlumni } from "./sections/alumni.ts";
import { run as runStaffing } from "./sections/staffing.ts";
import { run as runTimetable } from "./sections/timetable.ts";
import { run as runHealth } from "./sections/health.ts";
import { run as runHelpdesk } from "./sections/helpdesk.ts";
import { run as runHostel } from "./sections/hostel.ts";
import { run as runSchoolLabs } from "./sections/school-labs.ts";
import { run as runVisitors } from "./sections/visitors.ts";
import { run as runCanteen } from "./sections/canteen.ts";
import { run as runScholarships } from "./sections/scholarships.ts";
import { run as runInventory } from "./sections/inventory.ts";
import { run as runCompliance } from "./sections/compliance.ts";
import { run as runDuties } from "./sections/duties.ts";
import { run as runExpenses } from "./sections/expenses.ts";
import { run as runClubs } from "./sections/clubs.ts";
import { run as runBehaviour } from "./sections/behaviour.ts";
import { run as runAchievements } from "./sections/achievements.ts";
import { run as runSafety } from "./sections/safety.ts";
import { run as runResources } from "./sections/resources.ts";
import { run as runForms } from "./sections/forms.ts";
import { run as runWebsite } from "./sections/website.ts";
import { run as runWorkflows } from "./sections/workflows.ts";

const SECTIONS: { name: string; run: (ctx: SeedContext) => Promise<void> }[] = [
  { name: "core", run: runCore },
  { name: "people", run: runPeople },
  { name: "academics", run: runAcademics },
  { name: "timetable", run: runTimetable },
  { name: "staffing", run: runStaffing },
  // M13-T11: right after timetable, so public.rooms already exists for assets.room_id.
  { name: "operations", run: runOperations },
  { name: "curriculum", run: runCurriculum },
  // Owner decision (2026-11-07): needs academics.ts's class_sections/subject_assignments/
  // curriculum_units and core.ts's named demo logins; no rng draws, so it
  // never shifts any later section's PRNG-derived output.
  { name: "homework", run: runHomework },
  { name: "attendance", run: runAttendance },
  { name: "admissions", run: runAdmissions },
  { name: "finance", run: runFinance },
  // X04-T10: needs finance.ts's fee_structures/invoices.
  { name: "fee-plans", run: runFeePlans },
  // M23-T20: after finance and admissions (both read by its templates' metrics).
  { name: "workflows", run: runWorkflows },
  { name: "exams", run: runExams },
  // M20-T13: after exams — compute_mastery reads exam_papers.unit_ids + marks exams.ts just wrote.
  { name: "mastery", run: runMastery },
  // X06-T10: after exams (own exam/papers) and timetable (rooms) — both already earlier.
  { name: "exam_seating", run: runExamSeating },
  { name: "website", run: runWebsite },
  // X03-T8: reads students/staff ids every earlier section produced.
  { name: "library", run: runLibrary },
  // X02-T11: last — issues demo certificates for already-seeded students.
  { name: "certificates", run: runCertificates },
  // X07-T9: registered last — reads students/guardians/staff ids every earlier section wrote.
  { name: "visitors", run: runVisitors },
  // Features-18 #10: needs people's studentsBySection and core's accountant login.
  { name: "canteen", run: runCanteen },
  // Features-18 #9: needs studentsBySection (people), accountant/admin/principal logins (core), academicYearId.
  { name: "scholarships", run: runScholarships },
  // Features-18 #3: needs core.ts's demo staff logins and people.ts's teacherStaffIds; no rng draws.
  { name: "payroll", run: runPayroll },
  { name: "inventory", run: runInventory },
  // Features-18 #22/#24: compliance needs the admin login; duties needs people.ts teacherStaffIds. No rng draws.
  { name: "compliance", run: runCompliance },
  { name: "duties", run: runDuties },
  // Features-18 #8: needs core's accountant/principal logins; no rng draws.
  { name: "expenses", run: runExpenses },
  // Features-18 #6: needs studentsBySection (people), staff logins (core).
  { name: "clubs", run: runClubs },
  { name: "hostel", run: runHostel },
  // Features-18 #19: needs timetable periods, academics sections/subjects, people teacherStaffIds; no rng draws.
  { name: "school-labs", run: runSchoolLabs },
  { name: "behaviour", run: runBehaviour },
  { name: "achievements", run: runAchievements },
  // Features-18 #21: needs core's demo logins and academics' current-year sections; no rng draws.
  { name: "safety", run: runSafety },
  // Features-18 #23: needs academics sections/subjects/curriculum units and core teacher login.
  { name: "resources", run: runResources },
  { name: "forms", run: runForms },
  { name: "health", run: runHealth },
  { name: "helpdesk", run: runHelpdesk },
  // X08-T10: needs class_sections (academics), studentsBySection (people).
  { name: "ptm", run: runPtm },
  // Features-18 #14: only profiles for already-graduated students (none in demo).
  { name: "alumni", run: runAlumni },
  // X01-T12: last — needs class_sections/subject_assignments (academics),
  // studentsBySection (people), demo logins (core).
  { name: "homeroom", run: runHomeroom },
  // X05-T6: last — needs core.ts's user ids and people.ts's student rows.
  { name: "notifications", run: runNotifications },
  // M27-T2/T3: registered last — real detectors/engines over every earlier section's rows.
  { name: "fabric", run: runFabric },
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

  // Owner decision (2026-11-07): homework.ts seeds 3 assignments per section
  // of grades VI, VIII, X, plus 1 quiz-type assignment for each of the 3
  // named sections (VI-A, VIII-B, X-A) — always present regardless of
  // SEED_SCALE.
  const homeworkSections = ["VI", "VIII", "X"].reduce((sum, code) => sum + sectionNames(code).length, 0);
  const expectedAssignments = homeworkSections * 3 + 3;
  const { count: homeworkAssignments } = await ctx.admin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institutionId);
  if (homeworkAssignments !== expectedAssignments) {
    throw new Error(`Count assertion failed: assignments (homework) expected ${expectedAssignments}, got ${homeworkAssignments}`);
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
