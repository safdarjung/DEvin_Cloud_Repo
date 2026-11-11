import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { FIRST_NAMES_FEMALE, FIRST_NAMES_MALE, LAST_NAMES } from "../lib/names.ts";
import { demoUsers, insertOnce, isoAt, sectionRng } from "../lib/util.ts";

// scheduled_reports: inserted as service role; the BEFORE trigger validates recipient roles per
// source and computes next_run_at from the cron, so it is not set here.
// import_batches/import_rows: two staged uploads (never committed, so no student or staff is
// created) and one committed historical upload whose rows point at real existing students.

const REPORTS = [
  { name: "Daily attendance summary", source: "attendance.daily", params: { dayOffset: 0 }, cron: "30 15 * * 1-6", roles: ["principal", "admin"], status: "active" },
  { name: "Yesterday's attendance (morning mail)", source: "attendance.daily", params: { dayOffset: -1 }, cron: "0 7 * * 1-6", roles: ["principal"], status: "active" },
  { name: "Weekly fee defaulters", source: "finance.defaulters", params: { minDaysOverdue: 15 }, cron: "0 9 * * 1", roles: ["accountant", "principal"], status: "active" },
  { name: "Month-start long overdue list", source: "finance.defaulters", params: { minDaysOverdue: 60 }, cron: "0 10 1 * *", roles: ["owner", "principal", "admin"], status: "paused" },
] as const;

const GRADE_SECTIONS = [["III", "A"], ["V", "B"], ["VII", "C"], ["IX", "D"]] as const;

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const rng = sectionRng("data-ops");
  const users = await demoUsers(ctx.sql, inst);
  const admin = users["admin"]!;

  await insertOnce(
    ctx.admin,
    "scheduled_reports",
    REPORTS.map((r, i) => ({
      id: uuidV5("data-ops", `report:${r.name}`),
      institution_id: inst,
      name: r.name,
      source: r.source,
      params: r.params,
      cron: r.cron,
      recipient_roles: [...r.roles],
      status: r.status,
      created_by: i % 2 === 0 ? admin : users["principal"]!,
      created_at: isoAt(-40 + i * 5, 6),
    })),
  );

  const sections = await ctx.sql<{ id: string; key: string }[]>`
    select cs.id, g.code || '|' || cs.name as key from public.class_sections cs join public.grades g on g.id = cs.grade_id
    where cs.institution_id = ${inst} and cs.academic_year_id = ${ctx.academicYearId}`;
  const sectionId = new Map(sections.map((s) => [s.key, s.id]));

  // ---- staged student upload: 30 rows, 3 invalid ----
  const studentBatchId = uuidV5("data-ops", "batch:students-staged");
  const studentRows = Array.from({ length: 30 }, (_, i) => {
    const [grade, section] = GRADE_SECTIONS[i % GRADE_SECTIONS.length]!;
    const female = i % 2 === 0;
    const first = (female ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE)[Math.floor(rng() * 20)]!;
    const last = LAST_NAMES[Math.floor(rng() * 20)]!;
    const invalidKind = i === 6 ? "section" : i === 13 ? "phone" : i === 22 ? "duplicate" : null;
    const admissionNo = invalidKind === "duplicate" ? "ADM/2026/9001" : `ADM/2026/${9001 + i}`;
    const data = {
      admission_no: admissionNo,
      first_name: first,
      last_name: last,
      dob: `${2014 - (i % 4)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(3 + (i % 24)).padStart(2, "0")}`,
      gender: female ? "female" : "male",
      class_section_id: invalidKind === "section" ? null : sectionId.get(`${grade}|${section}`) ?? null,
      academic_year_id: ctx.academicYearId,
      roll_no: null,
      guardian_name: `${(i % 2 ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE)[Math.floor(rng() * 20)]} ${last}`,
      guardian_phone: invalidKind === "phone" ? "98765" : `9${String(100000000 + i * 7919123).slice(0, 9)}`,
      guardian_email: null,
      guardian_relationship: i % 2 ? "father" : "mother",
    };
    const errors = invalidKind === "section" ? { section: ["not found"] } : invalidKind === "phone" ? { guardian_phone: ["Invalid phone number."] } : invalidKind === "duplicate" ? { admission_no: ["duplicate in file"] } : null;
    return { row_no: i + 2, data, errors, status: errors ? "invalid" : "valid", entity_id: null as string | null };
  });

  // ---- staged staff upload: 12 rows, 1 invalid ----
  const staffBatchId = uuidV5("data-ops", "batch:staff-staged");
  const designations = ["PRT", "TGT", "TGT", "PGT", "Lab Assistant", "Librarian"];
  const staffRows = Array.from({ length: 12 }, (_, i) => {
    const name = `${(i % 2 ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE)[Math.floor(rng() * 20)]} ${LAST_NAMES[Math.floor(rng() * 20)]}`;
    const bad = i === 8;
    const errors = bad ? { designation: ["Required"] } : null;
    return {
      row_no: i + 2,
      data: { employee_no: `EMP/NEW/${String(i + 1).padStart(3, "0")}`, full_name: name, designation: bad ? "" : designations[i % designations.length]!, department_id: null, phone: null, email: null, is_teaching: i % 6 < 4 },
      errors,
      status: errors ? "invalid" : "valid",
      entity_id: null as string | null,
    };
  });

  // ---- committed historical upload: rows point at 25 real students ----
  const committedBatchId = uuidV5("data-ops", "batch:students-committed");
  const existing = await ctx.sql<{ id: string; admission_no: string; first_name: string; last_name: string | null; dob: string; gender: string; class_section_id: string }[]>`
    select s.id, s.admission_no, s.first_name, s.last_name, s.dob::text, s.gender, e.class_section_id
    from public.students s join public.enrolments e on e.student_id = s.id
    join public.class_sections cs on cs.id = e.class_section_id join public.grades g on g.id = cs.grade_id
    where s.institution_id = ${inst} and g.code = 'I' and cs.name = 'A' order by s.admission_no limit 25`;
  const committedRows = existing.map((s, i) => ({
    row_no: i + 2,
    data: { admission_no: s.admission_no, first_name: s.first_name, last_name: s.last_name, dob: s.dob, gender: s.gender, class_section_id: s.class_section_id, academic_year_id: ctx.academicYearId },
    errors: null,
    status: "committed",
    entity_id: s.id,
  }));

  const batches = [
    { id: studentBatchId, entity_type: "students", status: "staged", file_name: "new_admissions_batch2.csv", rows: studentRows, created_at: isoAt(-2, 7), committed_at: null as string | null },
    { id: staffBatchId, entity_type: "staff", status: "staged", file_name: "contract_staff_nov.csv", rows: staffRows, created_at: isoAt(-1, 6), committed_at: null },
    { id: committedBatchId, entity_type: "students", status: "committed", file_name: "grade1_admissions_2026.csv", rows: committedRows, created_at: isoAt(-120, 5), committed_at: isoAt(-120, 6) },
  ].filter((b) => b.rows.length > 0);

  await insertOnce(
    ctx.admin,
    "import_batches",
    batches.map((b) => {
      const valid = b.rows.filter((r) => r.status !== "invalid").length;
      const done = b.status === "committed";
      return {
        id: b.id,
        institution_id: inst,
        entity_type: b.entity_type,
        status: b.status,
        file_name: b.file_name,
        row_count: b.rows.length,
        valid_count: valid,
        error_count: b.rows.length - valid,
        committed_count: done ? valid : 0,
        skipped_count: 0,
        created_by: admin,
        committed_by: done ? admin : null,
        committed_at: b.committed_at,
        created_at: b.created_at,
      };
    }),
  );
  await insertOnce(
    ctx.admin,
    "import_rows",
    batches.flatMap((b) =>
      b.rows.map((r) => ({
        id: uuidV5("data-ops", `row:${b.id}:${r.row_no}`),
        batch_id: b.id,
        institution_id: inst,
        row_no: r.row_no,
        data: r.data,
        errors: r.errors,
        status: r.status,
        entity_id: r.entity_id,
        created_at: b.created_at,
      })),
    ),
  );
}
