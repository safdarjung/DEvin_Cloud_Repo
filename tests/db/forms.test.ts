// Features-18 #13 — migration 0122: forms / form_sections / form_responses RLS, guard trigger,
// my_open_forms and submit_form_response.
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const adminClient = () => createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string);
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

const FIELDS = [
  { type: "consent", label: "I agree to the trip", required: true },
  { type: "choice", label: "Meal", options: ["Veg", "Non-veg"], required: true },
  { type: "text", label: "Notes" },
];
const GOOD = [true, 1, null];

async function base(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  const [s] = await sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`;
  const [g] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
  const [t] = await sql`select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'`;
  await createEnrolment(inst.institutionId, s.student_id as string, sectionA, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${g.guardian_id}, ${s.student_id}, 'father', true, true)`;
  await sql`update public.class_sections set class_teacher_id = ${t.staff_id} where id = ${sectionA}`;

  // A second family in section A with its own guardian login, to prove per-child isolation.
  const email = `forms-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("user not created");
  const [g2] = await sql`insert into public.guardians (institution_id, full_name, phone) values (${inst.institutionId}, 'Other Parent', ${`9${Math.floor(100000000 + Math.random() * 900000000)}`}) returning id`;
  await sql`insert into public.memberships (institution_id, user_id, role, guardian_id) values (${inst.institutionId}, ${data.user.id}, 'guardian', ${g2.id})`;
  const [s2] = await sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-06-01', 'other') returning id`;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access) values (${inst.institutionId}, ${g2.id}, ${s2.id}, 'father', true, true)`;
  await createEnrolment(inst.institutionId, s2.id as string, sectionA, yearId, { status: "active" });

  return { sectionA, sectionB, studentId: s.student_id as string, otherStudentId: s2.id as string, otherGuardian: await signedIn(email) };
}

async function makeForm(inst: TestInstitution, sections: string[], opts: { publish?: boolean; fields?: unknown[] } = {}): Promise<string> {
  const admin = inst.clientAs("admin");
  const { data, error } = await admin
    .from("forms")
    .insert({ institution_id: inst.institutionId, title: "Trip consent", fields: (opts.fields ?? FIELDS) as never, created_by: inst.users.admin.id })
    .select("id")
    .single();
  if (error) throw error;
  for (const s of sections) {
    const r = await admin.from("form_sections").insert({ form_id: data!.id, institution_id: inst.institutionId, class_section_id: s });
    if (r.error) throw r.error;
  }
  if (opts.publish) {
    const r = await admin.from("forms").update({ status: "published" }).eq("id", data!.id);
    if (r.error) throw r.error;
  }
  return data!.id as string;
}

const submit = (c: SupabaseClient, formId: string, studentId: string | null, answers: unknown = GOOD) =>
  c.rpc("submit_form_response", { p_form_id: formId, p_student_id: studentId as string, p_answers: answers as never });

describe("forms (0122)", () => {
  it("draft is invisible to respondents and cannot be answered", async () => {
    const inst = await createTestInstitution("forms-draft");
    try {
      const b = await base(inst);
      const formId = await makeForm(inst, [b.sectionA]);
      const open = await inst.clientAs("guardian").rpc("my_open_forms", { p_institution_id: inst.institutionId });
      expect(open.error).toBeNull();
      expect(open.data).toEqual([]);
      const direct = await inst.clientAs("guardian").from("forms").select("id");
      expect(direct.data).toEqual([]);
      const res = await submit(inst.clientAs("guardian"), formId, b.studentId);
      expect(res.error?.message).toContain("code:not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("publish needs an audience section; then guardian, student and teacher each see and answer once", async () => {
    const inst = await createTestInstitution("forms-flow");
    try {
      const b = await base(inst);
      const noAudience = await makeForm(inst, []);
      const bad = await inst.clientAs("admin").from("forms").update({ status: "published" }).eq("id", noAudience);
      expect(bad.error?.message).toContain("code:invalid_state");

      const formId = await makeForm(inst, [b.sectionA], { publish: true });
      const g = await inst.clientAs("guardian").rpc("my_open_forms", { p_institution_id: inst.institutionId });
      expect(g.data).toHaveLength(1);
      expect(g.data![0]).toMatchObject({ student_id: b.studentId, responded: false });
      const t = await inst.clientAs("teacher").rpc("my_open_forms", { p_institution_id: inst.institutionId });
      expect(t.data![0]).toMatchObject({ student_id: null });
      const other = await inst.clientAs("accountant").rpc("my_open_forms", { p_institution_id: inst.institutionId });
      expect(other.data).toEqual([]);

      expect((await submit(inst.clientAs("guardian"), formId, b.studentId)).error).toBeNull();
      expect((await submit(inst.clientAs("student"), formId, b.studentId)).error).toBeNull();
      expect((await submit(inst.clientAs("teacher"), formId, null)).error).toBeNull();

      const again = await submit(inst.clientAs("guardian"), formId, b.studentId);
      expect(again.error?.message).toContain("code:conflict");
      const after = await inst.clientAs("guardian").rpc("my_open_forms", { p_institution_id: inst.institutionId });
      expect(after.data![0].responded).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian cannot answer for another family's child; invalid answers are refused", async () => {
    const inst = await createTestInstitution("forms-bola");
    try {
      const b = await base(inst);
      const formId = await makeForm(inst, [b.sectionA], { publish: true });
      const wrongChild = await submit(inst.clientAs("guardian"), formId, b.otherStudentId);
      expect(wrongChild.error?.message).toContain("code:not_found");
      const asNull = await submit(inst.clientAs("guardian"), formId, null);
      expect(asNull.error?.message).toContain("code:not_found");
      const noConsent = await submit(inst.clientAs("guardian"), formId, b.studentId, [false, 1, null]);
      expect(noConsent.error?.message).toContain("code:validation_failed");
      const badIndex = await submit(inst.clientAs("guardian"), formId, b.studentId, [true, 9, null]);
      expect(badIndex.error?.message).toContain("code:validation_failed");
      const wrongLen = await submit(inst.clientAs("guardian"), formId, b.studentId, [true]);
      expect(wrongLen.error?.message).toContain("code:validation_failed");
      // The other guardian can still answer for their own child, and cannot read the first guardian's rows.
      expect((await submit(b.otherGuardian, formId, b.otherStudentId)).error).toBeNull();
      expect((await submit(inst.clientAs("guardian"), formId, b.studentId)).error).toBeNull();
      const own = await b.otherGuardian.from("form_responses").select("student_id");
      expect(own.data).toEqual([{ student_id: b.otherStudentId }]);
    } finally {
      await inst.cleanup();
    }
  });

  it("a section outside the audience gets no form; closed form refuses answers", async () => {
    const inst = await createTestInstitution("forms-audience");
    try {
      const b = await base(inst);
      const formB = await makeForm(inst, [b.sectionB], { publish: true });
      const open = await inst.clientAs("guardian").rpc("my_open_forms", { p_institution_id: inst.institutionId });
      expect(open.data).toEqual([]);
      expect((await submit(inst.clientAs("guardian"), formB, b.studentId)).error?.message).toContain("code:not_found");

      const formA = await makeForm(inst, [b.sectionA], { publish: true });
      expect((await inst.clientAs("admin").from("forms").update({ status: "closed" }).eq("id", formA)).error).toBeNull();
      expect((await submit(inst.clientAs("guardian"), formA, b.studentId)).error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("published content is frozen; draft edits are validated; non-managers cannot write", async () => {
    const inst = await createTestInstitution("forms-frozen");
    try {
      const b = await base(inst);
      const formId = await makeForm(inst, [b.sectionA], { publish: true });
      const admin = inst.clientAs("admin");
      for (const patch of [{ title: "New" }, { fields: [{ type: "text", label: "x" }] }]) {
        const r = await admin.from("forms").update(patch as never).eq("id", formId);
        expect(r.error?.message).toContain("code:invalid_state");
      }
      const sectionAdd = await admin.from("form_sections").insert({ form_id: formId, institution_id: inst.institutionId, class_section_id: b.sectionB });
      expect(sectionAdd.error).not.toBeNull();

      const tooMany = await admin.from("forms").insert({ institution_id: inst.institutionId, title: "x", fields: Array.from({ length: 31 }, () => ({ type: "text", label: "q" })) as never, created_by: inst.users.admin.id });
      expect(tooMany.error?.message).toContain("code:validation_failed");
      const longLabel = await admin.from("forms").insert({ institution_id: inst.institutionId, title: "x", fields: [{ type: "text", label: "x".repeat(201) }] as never, created_by: inst.users.admin.id });
      expect(longLabel.error?.message).toContain("code:validation_failed");
      const badType = await admin.from("forms").insert({ institution_id: inst.institutionId, title: "x", fields: [{ type: "file", label: "x" }] as never, created_by: inst.users.admin.id });
      expect(badType.error?.message).toContain("code:validation_failed");

      const teacherInsert = await inst.clientAs("teacher").from("forms").insert({ institution_id: inst.institutionId, title: "x", fields: FIELDS as never, created_by: inst.users.teacher.id });
      expect(teacherInsert.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("responses are immutable and respondents cannot write the table directly", async () => {
    const inst = await createTestInstitution("forms-immutable");
    try {
      const b = await base(inst);
      const formId = await makeForm(inst, [b.sectionA], { publish: true });
      expect((await submit(inst.clientAs("guardian"), formId, b.studentId)).error).toBeNull();

      const upd = await inst.clientAs("guardian").from("form_responses").update({ answers: [true, 0, null] as never }).eq("form_id", formId).select();
      expect(upd.data ?? []).toEqual([]);
      const del = await inst.clientAs("admin").from("form_responses").delete().eq("form_id", formId).select();
      expect(del.data ?? []).toEqual([]);
      await expect(sql`update public.form_responses set answers = '[true,0,null]'::jsonb where form_id = ${formId}`).rejects.toThrow();
      await expect(sql`delete from public.form_responses where form_id = ${formId}`).rejects.toThrow();

      const ins = await inst.clientAs("guardian").from("form_responses").insert({
        institution_id: inst.institutionId, form_id: formId, respondent_user_id: inst.users.guardian.id, student_id: b.otherStudentId, answers: GOOD as never,
      });
      expect(ins.error).not.toBeNull();
      const adminRead = await inst.clientAs("admin").from("form_responses").select("id").eq("form_id", formId);
      expect(adminRead.data).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-tenant: other institution cannot see forms or responses, and cannot answer", async () => {
    await withTwoInstitutions(async (a, other) => {
      const b = await base(a);
      const formId = await makeForm(a, [b.sectionA], { publish: true });
      expect((await submit(a.clientAs("guardian"), formId, b.studentId)).error).toBeNull();

      expect((await other.clientAs("admin").from("forms").select("id").eq("id", formId)).data).toEqual([]);
      expect((await other.clientAs("admin").from("form_responses").select("id").eq("form_id", formId)).data).toEqual([]);
      expect((await other.clientAs("admin").from("forms").update({ status: "closed" }).eq("id", formId).select()).data ?? []).toEqual([]);
      const res = await submit(other.clientAs("guardian"), formId, b.studentId);
      expect(res.error?.message).toContain("code:not_found");
      const asOther = await other.clientAs("guardian").rpc("my_open_forms", { p_institution_id: a.institutionId });
      expect(asOther.data).toEqual([]);
    });
  });
});
