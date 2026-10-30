import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// T-042: direct-PostgREST write bypasses the actions used to hide —
// DBT-20 (applications), DBT-28 (websites.is_live), DBT-32 (memberships).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let a: TestInstitution;
let b: TestInstitution;
let gradeId: string;
let yearId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestInstitution("guards-a"), createTestInstitution("guards-b")]);
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{numbering}', ${sql.json({ application_no: "APP/{YYYY}/{SEQ:5}" })})
    where id = ${a.institutionId}
  `;
  yearId = await createAcademicYear(a.institutionId);
  gradeId = await createGrade(a.institutionId);
}, 120_000);

afterAll(async () => {
  await Promise.all([a.cleanup(), b.cleanup()]);
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
}, 60_000);

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    institution_id: a.institutionId,
    applicant: { firstName: "Direct", lastName: "Write", dob: "2015-01-01", gender: "other" },
    guardian: { fullName: "Direct Guardian", phone: "9800000901", relationship: "father" },
    grade_applied_id: gradeId,
    academic_year_id: yearId,
    ...overrides,
  };
}

describe("DBT-20: applications cannot be created past `submitted` or with a chosen number", () => {
  it("a direct INSERT with a decided/enrolled status is rejected", async () => {
    for (const status of ["accepted", "offered", "enrolled"]) {
      const { error } = await a.clientAs("admissions").from("applications").insert(applicationRow({ status }));
      expect(error?.message).toMatch(/invalid_state/);
    }
  });

  it("a client-supplied application_no is ignored in favour of the sequence", async () => {
    const { data, error } = await a
      .clientAs("admissions")
      .from("applications")
      .insert(applicationRow({ application_no: "APP-PRECLAIMED" }))
      .select("application_no, status")
      .single();
    expect(error).toBeNull();
    expect(data?.application_no).not.toBe("APP-PRECLAIMED");
    expect(data?.status).toBe("submitted");
  });

  it("application_no cannot be changed by a direct UPDATE", async () => {
    const { data: created } = await a
      .clientAs("admissions")
      .from("applications")
      .insert(applicationRow())
      .select("id, application_no")
      .single();
    const { error } = await a
      .clientAs("admissions")
      .from("applications")
      .update({ application_no: "APP-RENUMBERED" })
      .eq("id", created!.id);
    expect(error?.message).toMatch(/invalid_state/);
    const [row] = await sql`select application_no from public.applications where id = ${created!.id}`;
    expect(row.application_no).toBe(created!.application_no);
  });
});

describe("DBT-28: only website.publish roles change websites.is_live", () => {
  let websiteId: string;

  beforeAll(async () => {
    const [row] = await sql`insert into public.websites (institution_id, is_live) values (${a.institutionId}, false) returning id`;
    websiteId = row.id as string;
  });

  it("admissions (website.edit only) cannot take the site live via a direct UPDATE", async () => {
    const { error } = await a.clientAs("admissions").from("websites").update({ is_live: true }).eq("id", websiteId);
    expect(error?.message).toMatch(/forbidden/);
    const [row] = await sql`select is_live from public.websites where id = ${websiteId}`;
    expect(row.is_live).toBe(false);
  });

  it("admissions can still edit non-publish columns", async () => {
    const { error } = await a
      .clientAs("admissions")
      .from("websites")
      .update({ theme: { primary: "#123456" } })
      .eq("id", websiteId);
    expect(error).toBeNull();
  });

  it("owner, principal and admin can toggle is_live", async () => {
    for (const role of ["owner", "principal", "admin"] as const) {
      const { error } = await a.clientAs(role).from("websites").update({ is_live: true }).eq("id", websiteId);
      expect(error).toBeNull();
      await sql`update public.websites set is_live = false where id = ${websiteId}`;
    }
  });

  it("admissions cannot create an already-live website", async () => {
    const { error } = await b.clientAs("admissions").from("websites").insert({ institution_id: b.institutionId, is_live: true });
    expect(error?.message).toMatch(/forbidden/);
  });
});

describe("DBT-32: membership links must point at a row of the same institution", () => {
  // B's own user + B's own linked row, re-used as a membership of A: exactly
  // the malformed row every RLS helper would otherwise trust.
  it.each([
    ["teacher", "staff_id"],
    ["guardian", "guardian_id"],
    ["student", "student_id"],
  ] as const)("%s membership in A linked to B's %s is rejected", async (role, column) => {
    const [foreign] = await sql`
      select ${sql(column)} as id from public.memberships where institution_id = ${b.institutionId} and role = ${role}
    `;
    await expect(
      sql`insert into public.memberships (institution_id, user_id, role, ${sql(column)}) values (${a.institutionId}, ${b.users[role].id}, ${role}, ${foreign.id})`,
    ).rejects.toThrow(/validation_failed/);
  });

  it("re-pointing an existing membership at another institution's staff row is rejected", async () => {
    const [foreignStaff] = await sql`select id from public.staff where institution_id = ${b.institutionId} limit 1`;
    await expect(
      sql`update public.memberships set staff_id = ${foreignStaff.id} where institution_id = ${a.institutionId} and role = 'teacher'`,
    ).rejects.toThrow(/validation_failed/);
  });
});

describe("T-042 review HIGH: members cannot escalate through memberships writes", () => {
  it("admin cannot promote their own membership to owner", async () => {
    const { error } = await a
      .clientAs("admin")
      .from("memberships")
      .update({ role: "owner" })
      .eq("user_id", a.users.admin.id);
    expect(error?.message).toMatch(/forbidden/);
  });

  it("principal cannot promote their own membership to owner", async () => {
    const { error } = await a
      .clientAs("principal")
      .from("memberships")
      .update({ role: "owner" })
      .eq("user_id", a.users.principal.id);
    expect(error?.message).toMatch(/forbidden/);
  });

  it("admin cannot grant owner or principal to another member", async () => {
    const [teacher] = await sql`select staff_id from public.memberships where institution_id = ${a.institutionId} and role = 'teacher'`;
    for (const role of ["owner", "principal"]) {
      const { error } = await a
        .clientAs("admin")
        .from("memberships")
        .insert({ institution_id: a.institutionId, user_id: a.users.teacher.id, role, staff_id: teacher.staff_id });
      expect(error?.message).toMatch(/forbidden/);
    }
  });

  it("admin can still manage a non-privileged member (member.manage)", async () => {
    try {
      const { data, error } = await a
        .clientAs("admin")
        .from("memberships")
        .update({ status: "disabled" })
        .eq("user_id", a.users.accountant.id)
        .select("status");
      expect(error).toBeNull();
      expect(data).toEqual([{ status: "disabled" }]);
    } finally {
      await sql`update public.memberships set status = 'active' where user_id = ${a.users.accountant.id}`;
    }
  });
});

describe("T-042 fix round 1 (review MED): profiles.is_platform_admin is not user-writable", () => {
  it("a member cannot flip their own is_platform_admin", async () => {
    const { error } = await a
      .clientAs("teacher")
      .from("profiles")
      .update({ is_platform_admin: true })
      .eq("id", a.users.teacher.id);
    expect(error).not.toBeNull();
    const [row] = await sql`select is_platform_admin from public.profiles where id = ${a.users.teacher.id}`;
    expect(row.is_platform_admin).toBe(false);
  });

  it("a member can still edit their own display fields", async () => {
    const { data, error } = await a
      .clientAs("teacher")
      .from("profiles")
      .update({ full_name: "Renamed Teacher", phone: "9876500000" })
      .eq("id", a.users.teacher.id)
      .select("full_name");
    expect(error).toBeNull();
    expect(data).toEqual([{ full_name: "Renamed Teacher" }]);
  });
});

describe("T-042 fix round 1 (review LOW): a membership's user and institution are fixed", () => {
  it("admin cannot re-point a teacher membership at another user", async () => {
    const { error } = await a
      .clientAs("admin")
      .from("memberships")
      .update({ user_id: a.users.student.id })
      .eq("user_id", a.users.teacher.id);
    expect(error?.message).toMatch(/forbidden/);
  });

  it("an admin of both institutions cannot move a membership from A to B", async () => {
    const [bStaff] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation)
      values (${b.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Dual admin', 'admin') returning id
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, staff_id)
      values (${b.institutionId}, ${a.users.admin.id}, 'admin', ${bStaff.id})
    `;
    const [bTeacherStaff] = await sql`select staff_id from public.memberships where institution_id = ${b.institutionId} and role = 'teacher'`;
    const { error } = await a
      .clientAs("admin")
      .from("memberships")
      .update({ institution_id: b.institutionId, staff_id: bTeacherStaff.staff_id })
      .eq("institution_id", a.institutionId)
      .eq("user_id", a.users.accountant.id);
    expect(error?.message).toMatch(/forbidden/);
  });
});

describe("DBT-34: guards tolerate an empty request.jwt.claims on a reused session", () => {
  it("a postgres session whose claim was set transaction-locally earlier can still call guarded paths", async () => {
    const single = postgres(process.env.SUPABASE_DB_URL as string, { max: 1 });
    try {
      await single.begin((tx) => tx`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`);
      // The setting now reads back as '' on this connection.
      const [{ claims }] = await single`select current_setting('request.jwt.claims', true) as claims`;
      expect(claims).toBe("");
      const [staff] = await single`select staff_id from public.memberships where institution_id = ${a.institutionId} and role = 'teacher'`;
      await expect(single`select app.staff_in_institution(${staff.staff_id}::uuid, ${a.institutionId}::uuid) as ok`).resolves.toEqual([{ ok: true }]);
    } finally {
      await single.end();
    }
  });
});

describe("T-042 fix round 1 (found): pages.published_version_id guard on a fresh connection", () => {
  // `app.guard_pages_published_version` (0010) tested
  // `current_setting('app.allow_publish', true) <> 'on'`, which is NULL — so
  // no raise — on any connection that never ran app.publish_page. Whether a
  // direct PostgREST write was blocked depended on connection-pool history
  // (tests/db/website-schema.test.ts passed or failed by luck).
  it("an admissions JWT cannot set published_version_id directly, even on a brand-new session", async () => {
    await sql`insert into public.websites (institution_id) values (${b.institutionId}) on conflict do nothing`;
    const [website] = await sql`select id from public.websites where institution_id = ${b.institutionId}`;
    const [page] = await sql`
      insert into public.pages (institution_id, website_id, slug, title)
      values (${b.institutionId}, ${website.id}, ${`fresh-${crypto.randomUUID().slice(0, 8)}`}, 'Fresh') returning id
    `;
    const [version] = await sql`
      insert into public.page_versions (institution_id, page_id, version_no, blocks)
      values (${b.institutionId}, ${page.id}, 1, '[]'::jsonb) returning id
    `;
    const fresh = postgres(process.env.SUPABASE_DB_URL as string, { max: 1 });
    try {
      await expect(
        fresh.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: b.users.admissions.id, role: "authenticated" })}, true)`;
          await tx`set local role authenticated`;
          await tx`update public.pages set published_version_id = ${version.id} where id = ${page.id}`;
        }),
      ).rejects.toThrow(/forbidden/);
    } finally {
      await fresh.end();
    }
    const [row] = await sql`select published_version_id from public.pages where id = ${page.id}`;
    expect(row.published_version_id).toBeNull();
  });
});

describe("T-042 fix round 2 (review MED): marks_guard on a fresh connection", () => {
  // `marks_guard` built `v_bypass` with `or current_setting('app.allow_marks_revision', true) = 'on'`;
  // on a session that never set it that term is NULL, so v_bypass was NULL,
  // `not v_bypass` NULL, and the published-exam check never raised.
  it("an exam_controller JWT cannot insert marks for a published exam, even on a brand-new session", async () => {
    const year = await createAcademicYear(b.institutionId);
    const [term] = await sql`
      insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
      values (${b.institutionId}, ${year}, 'Term 1', 1, '2026-04-01', '2026-09-30') returning id
    `;
    const grade = await createGrade(b.institutionId, { code: "VII" });
    const [section] = await sql`
      insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
      values (${b.institutionId}, ${grade}, ${year}, 'M') returning id
    `;
    const [subject] = await sql`
      insert into public.subjects (institution_id, code, name, kind)
      values (${b.institutionId}, ${`SUB-${crypto.randomUUID().slice(0, 8)}`}, 'Maths', 'scholastic') returning id
    `;
    const [exam] = await sql`
      insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
      values (${b.institutionId}, ${year}, ${term.id}, 'Published exam', 'unit_test', 'published') returning id
    `;
    const [paper] = await sql`
      insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks)
      values (${b.institutionId}, ${exam.id}, ${section.id}, ${subject.id}, 100, 33) returning id
    `;
    const [student] = await sql`select student_id from public.memberships where institution_id = ${b.institutionId} and role = 'student'`;

    // Connect exactly like PostgREST: session_user = authenticator (marks_guard
    // bypasses session_user = 'postgres'), then `set role authenticated`.
    const url = new URL(process.env.SUPABASE_DB_URL as string);
    url.username = "authenticator";
    const fresh = postgres(url.toString(), { max: 1 });
    try {
      await expect(
        fresh.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: b.users.exam_controller.id, role: "authenticated" })}, true)`;
          await tx`set local role authenticated`;
          await tx`
            insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, is_absent)
            values (${b.institutionId}, ${paper.id}, ${student.student_id}, 99, false)
          `;
        }),
      ).rejects.toThrow(/invalid_state/);
    } finally {
      await fresh.end();
    }
    const marks = await sql`select id from public.marks where exam_paper_id = ${paper.id}`;
    expect(marks).toHaveLength(0);
  });
});

describe("T-042 fix round 2 (review LOW): public.generate_invoice never skips its role check on a null uid", () => {
  it("an authenticated session with no sub claim gets unauthenticated, not the unchecked app.generate_invoice", async () => {
    const fresh = postgres(process.env.SUPABASE_DB_URL as string, { max: 1 });
    try {
      await expect(
        fresh.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "authenticated" })}, true)`;
          await tx`set local role authenticated`;
          await tx`select public.generate_invoice(${crypto.randomUUID()}::uuid, ${crypto.randomUUID()}::uuid)`;
        }),
      ).rejects.toThrow(/unauthenticated/);
    } finally {
      await fresh.end();
    }
  });
});
