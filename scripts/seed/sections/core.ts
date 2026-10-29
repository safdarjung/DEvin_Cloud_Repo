import { DEFAULT_INSTITUTION_SETTINGS, InstitutionSettingsSchema } from "../../../src/modules/core/schemas.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

// 11 §3 — the eleven demo logins. staff-class roles get a `staff` row,
// guardian/student get the matching table. Named individuals (guardian.one,
// guardian.two, student.one) use their documented 05 §8.1 details; the
// others have no documented personal name, so a generic one is used.
// guardian.one/guardian.two's OTHER children (Aarav, Ishaan) and the
// guardian_students links are T-013's job (people section owns
// guardian_students) — they don't need login access.
const DEMO_LOGINS = [
  { key: "principal", email: "principal@demo.coolskool.test", role: "principal", kind: "staff" as const, name: "Demo Principal" },
  { key: "admin", email: "admin@demo.coolskool.test", role: "admin", kind: "staff" as const, name: "Demo Admin" },
  { key: "admissions", email: "admissions@demo.coolskool.test", role: "admissions", kind: "staff" as const, name: "Demo Admissions" },
  { key: "accountant", email: "accountant@demo.coolskool.test", role: "accountant", kind: "staff" as const, name: "Demo Accountant" },
  { key: "examcontroller", email: "examcontroller@demo.coolskool.test", role: "exam_controller", kind: "staff" as const, name: "Demo Exam Controller" },
  { key: "teacher.vi-a", email: "teacher.vi-a@demo.coolskool.test", role: "teacher", kind: "staff" as const, name: "VI-A Class Teacher" },
  { key: "teacher.viii-b", email: "teacher.viii-b@demo.coolskool.test", role: "teacher", kind: "staff" as const, name: "VIII-B Class Teacher" },
  { key: "teacher.x-a", email: "teacher.x-a@demo.coolskool.test", role: "teacher", kind: "staff" as const, name: "X-A Class Teacher" },
  { key: "guardian.one", email: "guardian.one@demo.coolskool.test", role: "guardian", kind: "guardian" as const, name: "Priya Sharma", phone: "9800000001" },
  { key: "guardian.two", email: "guardian.two@demo.coolskool.test", role: "guardian", kind: "guardian" as const, name: "Rohit Mehta", phone: "9800000002" },
  { key: "student.one", email: "student.one@demo.coolskool.test", role: "student", kind: "student" as const, name: "Ananya Sharma" },
] as const;

async function getOrCreateAuthUser(
  ctx: SeedContext,
  email: string,
  fullName: string,
): Promise<string> {
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (!error && data.user) return data.user.id;

  // demo:reset never deletes auth.users (W13) — a rerun after reset must
  // reuse the existing user instead of failing on the duplicate email.
  if (error && /already.*registered|email_exists/i.test(error.message)) {
    let page = 1;
    for (;;) {
      const { data: list, error: listError } = await ctx.admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) throw listError;
      const existing = list.users.find((u) => u.email === email);
      if (existing) return existing.id;
      if (list.users.length === 0) break;
      page += 1;
    }
  }

  throw error ?? new Error(`createUser(${email}) returned no user and no error`);
}

export async function run(ctx: SeedContext): Promise<void> {
  const settings = InstitutionSettingsSchema.parse(DEFAULT_INSTITUTION_SETTINGS);

  ctx.institutionId = uuidV5("core", "st-josephs-demo");
  await ctx.admin.from("institutions").upsert({
    id: ctx.institutionId,
    slug: "st-josephs-demo",
    name: "St. Joseph's Convent School (Demo)",
    board: "CBSE",
    is_demo: true,
    ai_policy: "local_only",
    settings,
  });

  ctx.campusId = uuidV5("core", "default-campus");
  await ctx.admin.from("campuses").upsert({
    id: ctx.campusId,
    institution_id: ctx.institutionId,
    name: "Main Campus",
    is_default: true,
  });

  ctx.academicYearId = uuidV5("core", "2026-27");
  await ctx.admin.from("academic_years").upsert({
    id: ctx.academicYearId,
    institution_id: ctx.institutionId,
    name: "2026-27",
    starts_on: "2026-04-01",
    ends_on: "2027-03-31",
    is_current: true,
  });

  ctx.termIds.term1 = uuidV5("core", "term-1");
  ctx.termIds.term2 = uuidV5("core", "term-2");
  await ctx.admin.from("terms").upsert([
    {
      id: ctx.termIds.term1,
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      name: "Term 1",
      sequence: 1,
      starts_on: "2026-04-01",
      ends_on: "2026-09-30",
    },
    {
      id: ctx.termIds.term2,
      institution_id: ctx.institutionId,
      academic_year_id: ctx.academicYearId,
      name: "Term 2",
      sequence: 2,
      starts_on: "2026-10-01",
      ends_on: "2027-03-31",
    },
  ]);

  let staffCounter = 0;
  for (const login of DEMO_LOGINS) {
    const userId = await getOrCreateAuthUser(ctx, login.email, login.name);
    ctx.userIdByLogin[login.key] = userId;

    let linkId: string;
    if (login.kind === "staff") {
      staffCounter += 1;
      linkId = uuidV5("people", login.key);
      await ctx.admin.from("staff").upsert({
        id: linkId,
        institution_id: ctx.institutionId,
        employee_no: `EMP/${String(staffCounter).padStart(4, "0")}`,
        full_name: login.name,
        designation: login.role,
        is_teaching: login.role === "teacher",
      });
    } else if (login.kind === "guardian") {
      linkId = uuidV5("people", login.key);
      await ctx.admin.from("guardians").upsert({
        id: linkId,
        institution_id: ctx.institutionId,
        full_name: login.name,
        phone: login.phone,
      });
    } else {
      linkId = uuidV5("people", login.key);
      await ctx.admin.from("students").upsert({
        id: linkId,
        institution_id: ctx.institutionId,
        admission_no: "ADM/2020/00133", // 05 §8.1 — Ananya Sharma (student.one)
        first_name: "Ananya",
        last_name: "Sharma",
        dob: "2011-03-15",
        gender: "female",
      });
    }
    ctx.linkIdByLogin[login.key] = linkId;

    const membership = {
      institution_id: ctx.institutionId,
      user_id: userId,
      role: login.role,
      staff_id: login.kind === "staff" ? linkId : null,
      guardian_id: login.kind === "guardian" ? linkId : null,
      student_id: login.kind === "student" ? linkId : null,
    };
    await ctx.admin.from("memberships").upsert(membership, { onConflict: "institution_id,user_id,role" });
  }
}
