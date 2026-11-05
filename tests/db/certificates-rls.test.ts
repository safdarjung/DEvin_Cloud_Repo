// X02-T2: migration 0091 part 1 — certificates table RLS + guards.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string) {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function insertCertificate(opts: {
  institutionId: string;
  studentId: string;
  issuedBy: string;
  serialNo: string;
  kind?: string;
  lifecycleEventId?: string | null;
}) {
  const [row] = await sql`
    insert into public.certificates (institution_id, student_id, kind, serial_no, lifecycle_event_id, snapshot, issued_by)
    values (
      ${opts.institutionId}, ${opts.studentId}, ${opts.kind ?? "bonafide"}, ${opts.serialNo},
      ${opts.lifecycleEventId ?? null}, '{}', ${opts.issuedBy}
    )
    returning id
  `;
  return row.id as string;
}

describe("migration 0091 part 1: certificates table + RLS + guards", () => {
  it("owner/principal/admin/admissions read a postgres-inserted row; accountant/teacher/guardian/student see none", async () => {
    const inst = await createTestInstitution("certificates-read-scope");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-CERT1");
      await insertCertificate({
        institutionId: inst.institutionId,
        studentId,
        issuedBy: inst.users.admin.id,
        serialNo: "BON/2026/00001",
      });

      for (const role of ["owner", "principal", "admin", "admissions"] as const) {
        const { data, error } = await inst.clientAs(role).from("certificates").select("id");
        expect(error, role).toBeNull();
        expect(data, role).toHaveLength(1);
      }

      for (const role of ["accountant", "exam_controller", "teacher", "guardian", "student"] as const) {
        const { data, error } = await inst.clientAs(role).from("certificates").select("id");
        expect(error, role).toBeNull();
        expect(data, role).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution B sees none of institution A's certificate rows", async () => {
    await withTwoInstitutions(async (a, b) => {
      const studentId = await insertStudent(a.institutionId, "ADM-CERT2");
      await insertCertificate({
        institutionId: a.institutionId,
        studentId,
        issuedBy: a.users.admin.id,
        serialNo: "BON/2026/00002",
      });

      const { data, error } = await b.clientAs("admin").from("certificates").select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  it("an authenticated INSERT is denied (no insert policy)", async () => {
    const inst = await createTestInstitution("certificates-insert-guard");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-CERT3");
      const { error } = await inst.clientAs("admin").from("certificates").insert({
        institution_id: inst.institutionId,
        student_id: studentId,
        kind: "bonafide",
        serial_no: "BON/2026/INSERT",
        snapshot: {},
        issued_by: inst.users.admin.id,
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a postgres UPDATE/DELETE is blocked (invalid_state) but passes under app.allow_reset", async () => {
    const inst = await createTestInstitution("certificates-block-mutation");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-CERT4");
      const id = await insertCertificate({
        institutionId: inst.institutionId,
        studentId,
        issuedBy: inst.users.admin.id,
        serialNo: "BON/2026/00004",
      });

      await expect(sql`update public.certificates set serial_no = 'x' where id = ${id}`).rejects.toThrow(/invalid_state/);
      await expect(sql`delete from public.certificates where id = ${id}`).rejects.toThrow(/invalid_state/);

      await sql.begin(async (tx) => {
        await tx`select set_config('app.allow_reset', 'on', true)`;
        await tx`update public.certificates set serial_no = 'BON/2026/00004-R' where id = ${id}`;
        await tx`delete from public.certificates where id = ${id}`;
      });

      const rows = await sql`select id from public.certificates where id = ${id}`;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("a transfer row without lifecycle_event_id violates the check constraint (23514)", async () => {
    const inst = await createTestInstitution("certificates-transfer-check");
    try {
      const studentId = await insertStudent(inst.institutionId, "ADM-CERT5");
      await expect(
        sql`
          insert into public.certificates (institution_id, student_id, kind, serial_no, snapshot, issued_by)
          values (${inst.institutionId}, ${studentId}, 'transfer', 'TC/2026/00001', '{}', ${inst.users.admin.id})
        `,
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await inst.cleanup();
    }
  });

  it("a duplicate serial within one institution violates uniqueness (23505); the same serial in another institution is accepted", async () => {
    await withTwoInstitutions(async (a, b) => {
      const studentA = await insertStudent(a.institutionId, "ADM-CERT6-A");
      const studentB = await insertStudent(b.institutionId, "ADM-CERT6-B");

      await insertCertificate({
        institutionId: a.institutionId,
        studentId: studentA,
        issuedBy: a.users.admin.id,
        serialNo: "BON/2026/DUP",
      });

      await expect(
        insertCertificate({
          institutionId: a.institutionId,
          studentId: studentA,
          issuedBy: a.users.admin.id,
          serialNo: "BON/2026/DUP",
        }),
      ).rejects.toMatchObject({ code: "23505" });

      const otherInstitutionId = await insertCertificate({
        institutionId: b.institutionId,
        studentId: studentB,
        issuedBy: b.users.admin.id,
        serialNo: "BON/2026/DUP",
      });
      expect(otherInstitutionId).toBeTruthy();
    });
  });
});
