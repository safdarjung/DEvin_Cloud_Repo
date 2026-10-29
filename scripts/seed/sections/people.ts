import { DEFAULT_INSTITUTION_SETTINGS } from "../../../src/modules/core/schemas.ts";
import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames, type GradeDef } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";
import { FIRST_NAMES_FEMALE, FIRST_NAMES_MALE, LAST_NAMES, pickName } from "../lib/names.ts";

// 05 §8 / 05 §2.2 / 12 §2 "Domain" row — 8 departments, 106 staff (8 already
// created by core.ts for the demo logins: 5 office + the 3 named class
// teachers), 3,024 students (1 already created by core.ts: student.one /
// Ananya), ~2,400 guardians with 1-2 children.

const DEPARTMENTS = [
  "Primary",
  "Middle",
  "Secondary",
  "Senior Secondary",
  "Accounts",
  "Admissions",
  "Exam Cell",
  "Admin",
] as const;

const WING_DEPARTMENT: Record<string, string> = {
  primary: "Primary",
  middle: "Middle",
  secondary: "Secondary",
  senior_secondary: "Senior Secondary",
};
const WING_DESIGNATION: Record<string, string> = {
  primary: "PRT",
  middle: "TGT",
  secondary: "TGT",
  senior_secondary: "PGT",
};

const NEW_TEACHING_COUNT = 97;

interface NamedStudent {
  sectionKey: string;
  firstName: string;
  lastName: string;
  gender: "male" | "female";
  rank: number;
  admissionNo?: string;
  existingId?: string;
}

function namedStudents(ctx: SeedContext): NamedStudent[] {
  return [
    // 05 §8.1 — guardian.one's children.
    { sectionKey: "VI-A", firstName: "Aarav", lastName: "Sharma", gender: "male", rank: 7, admissionNo: "ADM/2024/00412" },
    {
      sectionKey: "X-A",
      firstName: "Ananya",
      lastName: "Sharma",
      gender: "female",
      rank: 12,
      existingId: ctx.linkIdByLogin["student.one"],
    },
    // guardian.two's child.
    { sectionKey: "VIII-B", firstName: "Ishaan", lastName: "Mehta", gender: "male", rank: 3 },
  ];
}

/**
 * 42 first names for one section. Without `special`, pure random fill. With
 * `special`, the target name is placed at exactly `special.rank` (1-based)
 * in alphabetical order: `rank - 1` names strictly before it, the rest
 * strictly after — never reordered afterwards (05 §8.1's fixed roll numbers).
 */
function buildRosterNames(
  rng: () => number,
  pool: readonly string[],
  size: number,
  special?: { firstName: string; rank: number },
): string[] {
  if (!special) {
    return Array.from({ length: size }, () => pool[Math.floor(rng() * pool.length)]!);
  }
  const target = special.firstName.toLowerCase();
  const less = pool.filter((n) => n.toLowerCase() < target);
  const greater = pool.filter((n) => n.toLowerCase() > target);
  const needLess = special.rank - 1;
  const needGreater = size - special.rank;
  const names = [special.firstName];
  for (let i = 0; i < needLess; i++) names.push(less[i % less.length]!);
  for (let i = 0; i < needGreater; i++) names.push(greater[i % greater.length]!);
  return names;
}

function genderOf(firstName: string, malePool: readonly string[]): "male" | "female" {
  return malePool.includes(firstName) ? "male" : "female";
}

function dobFor(rng: () => number, grade: GradeDef): string {
  // 2026-04-01 start of the seeded academic year; Grade I ~ age 6, Grade XII ~ age 17.
  const birthYear = 2026 - (grade.sortKey + 5);
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  return `${birthYear}-${month}-${day}`;
}

/** First digit 9, second digit never 8 — keeps clear of the demo logins' `98000000xx`/`9800000101` phones (reserved for T-029). */
function randomPhone(rng: () => number, used: Set<string>): string {
  for (;;) {
    const second = 1 + Math.floor(rng() * 7);
    const rest = Array.from({ length: 8 }, () => Math.floor(rng() * 10)).join("");
    const phone = `9${second}${rest}`;
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
}

async function nextSequence(ctx: SeedContext, key: string): Promise<string> {
  const rows = await ctx.sql`select app.next_sequence(${ctx.institutionId}::uuid, ${key}) as v`;
  return rows[0]!.v as string;
}

export async function run(ctx: SeedContext): Promise<void> {
  const departmentIdByName: Record<string, string> = {};
  const departmentRows = DEPARTMENTS.map((name) => {
    const id = uuidV5("people", `dept:${name}`);
    departmentIdByName[name] = id;
    return { id, institution_id: ctx.institutionId, name };
  });
  await ctx.admin.from("departments").upsert(departmentRows);

  // core.ts already consumed employee numbers 1..N manually (never through
  // the sequence, for its demo-login staff rows) — prime past however many
  // exist right now so our generated numbers never collide.
  const { count: existingStaffCount } = await ctx.admin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institutionId);
  await ctx.admin.from("institution_sequences").upsert({
    institution_id: ctx.institutionId,
    key: "employee_no",
    next_value: (existingStaffCount ?? 0) + 1,
    pattern: DEFAULT_INSTITUTION_SETTINGS.numbering.employee_no,
  });

  const wingsCycle: string[] = [];
  for (const grade of GRADES) {
    for (let i = 0; i < sectionNames(grade.code).length; i++) wingsCycle.push(grade.gradeGroup);
  }

  const staffRows: Record<string, unknown>[] = [];
  const newTeacherIds: string[] = [];
  for (let i = 0; i < NEW_TEACHING_COUNT; i++) {
    const wing = wingsCycle[i % wingsCycle.length]!;
    const { firstName, lastName } = pickName(ctx.rng, ctx.rng() < 0.5 ? "male" : "female");
    const employeeNo = await nextSequence(ctx, "employee_no");
    const id = uuidV5("people", `staff:teacher:${i}`);
    newTeacherIds.push(id);
    staffRows.push({
      id,
      institution_id: ctx.institutionId,
      employee_no: employeeNo,
      full_name: `${firstName} ${lastName}`,
      designation: WING_DESIGNATION[wing],
      department_id: departmentIdByName[WING_DEPARTMENT[wing]!],
      is_teaching: true,
    });
  }

  {
    const { firstName, lastName } = pickName(ctx.rng, "male");
    const employeeNo = await nextSequence(ctx, "employee_no");
    staffRows.push({
      id: uuidV5("people", "staff:clerk"),
      institution_id: ctx.institutionId,
      employee_no: employeeNo,
      full_name: `${firstName} ${lastName}`,
      designation: "clerk",
      department_id: departmentIdByName.Admin,
      is_teaching: false,
    });
  }

  await insertBatch(ctx.admin, "staff", staffRows);
  ctx.teacherStaffIds = [
    ctx.linkIdByLogin["teacher.vi-a"]!,
    ctx.linkIdByLogin["teacher.viii-b"]!,
    ctx.linkIdByLogin["teacher.x-a"]!,
    ...newTeacherIds,
  ];

  // ---- students (42 per section, named ones at their fixed alphabetical roll) ----
  const named = namedStudents(ctx);
  const namePool = [...FIRST_NAMES_MALE, ...FIRST_NAMES_FEMALE];
  const studentRows: Record<string, unknown>[] = [];
  const genericStudents: { id: string; firstName: string; lastName: string; gender: "male" | "female"; dob: string }[] = [];

  for (const grade of GRADES) {
    for (const sectionName of sectionNames(grade.code)) {
      const key = sectionKey(grade.code, sectionName);
      const special = named.find((n) => n.sectionKey === key);
      const names = buildRosterNames(
        ctx.rng,
        namePool,
        42,
        special ? { firstName: special.firstName, rank: special.rank } : undefined,
      );
      const sectionStudents: { id: string; firstName: string }[] = [];

      for (const firstName of names) {
        if (special && firstName === special.firstName) {
          const dob = dobFor(ctx.rng, grade);
          if (special.existingId) {
            sectionStudents.push({ id: special.existingId, firstName: special.firstName });
          } else {
            const id = uuidV5("people", `student:named:${special.firstName}`);
            const admissionNo = special.admissionNo ?? (await nextSequence(ctx, "admission_no"));
            studentRows.push({
              id,
              institution_id: ctx.institutionId,
              admission_no: admissionNo,
              first_name: special.firstName,
              last_name: special.lastName,
              dob,
              gender: special.gender,
            });
            sectionStudents.push({ id, firstName: special.firstName });
          }
          continue;
        }

        const gender = genderOf(firstName, FIRST_NAMES_MALE);
        const lastName = LAST_NAMES[Math.floor(ctx.rng() * LAST_NAMES.length)]!;
        const dob = dobFor(ctx.rng, grade);
        const id = uuidV5("people", `student:${key}:${sectionStudents.length}`);
        sectionStudents.push({ id, firstName });
        genericStudents.push({ id, firstName, lastName, gender, dob });
      }

      ctx.studentsBySection[key] = sectionStudents;
    }
  }

  // ---- guardians: named families first, then the generic roster paired into ~20% sibling sets ----
  const guardianRows: Record<string, unknown>[] = [];
  const guardianStudentRows: Record<string, unknown>[] = [
    {
      institution_id: ctx.institutionId,
      guardian_id: ctx.linkIdByLogin["guardian.one"],
      student_id: ctx.studentsBySection["VI-A"]!.find((s) => s.firstName === "Aarav")!.id,
      relationship: "mother",
      is_primary: true,
    },
    {
      institution_id: ctx.institutionId,
      guardian_id: ctx.linkIdByLogin["guardian.one"],
      student_id: ctx.studentsBySection["X-A"]!.find((s) => s.firstName === "Ananya")!.id,
      relationship: "mother",
      is_primary: true,
    },
    {
      institution_id: ctx.institutionId,
      guardian_id: ctx.linkIdByLogin["guardian.two"],
      student_id: ctx.studentsBySection["VIII-B"]!.find((s) => s.firstName === "Ishaan")!.id,
      relationship: "father",
      is_primary: true,
    },
  ];

  const usedPhones = new Set<string>(["9800000001", "9800000002"]);
  let guardianCounter = 0;
  for (let i = 0; i < genericStudents.length; ) {
    const s1 = genericStudents[i]!;
    const pairNext = i + 1 < genericStudents.length && ctx.rng() < 0.2;
    const guardianGender: "male" | "female" = ctx.rng() < 0.5 ? "male" : "female";
    const { firstName: guardianFirstName } = pickName(ctx.rng, guardianGender);
    const relationship = guardianGender === "male" ? "father" : "mother";
    const guardianId = uuidV5("people", `guardian:${guardianCounter}`);
    guardianCounter += 1;

    guardianRows.push({
      id: guardianId,
      institution_id: ctx.institutionId,
      full_name: `${guardianFirstName} ${s1.lastName}`,
      phone: randomPhone(ctx.rng, usedPhones),
    });

    const admissionNo1 = await nextSequence(ctx, "admission_no");
    studentRows.push({
      id: s1.id,
      institution_id: ctx.institutionId,
      admission_no: admissionNo1,
      first_name: s1.firstName,
      last_name: s1.lastName,
      dob: s1.dob,
      gender: s1.gender,
    });
    guardianStudentRows.push({
      institution_id: ctx.institutionId,
      guardian_id: guardianId,
      student_id: s1.id,
      relationship,
      is_primary: true,
    });

    if (pairNext) {
      const s2 = genericStudents[i + 1]!;
      const admissionNo2 = await nextSequence(ctx, "admission_no");
      studentRows.push({
        id: s2.id,
        institution_id: ctx.institutionId,
        admission_no: admissionNo2,
        first_name: s2.firstName,
        last_name: s1.lastName, // siblings share a surname
        dob: s2.dob,
        gender: s2.gender,
      });
      guardianStudentRows.push({
        institution_id: ctx.institutionId,
        guardian_id: guardianId,
        student_id: s2.id,
        relationship,
        is_primary: true,
      });
      i += 2;
    } else {
      i += 1;
    }
  }

  await insertBatch(ctx.admin, "guardians", guardianRows);
  await insertBatch(ctx.admin, "students", studentRows);
  await insertBatch(ctx.admin, "guardian_students", guardianStudentRows);
}
