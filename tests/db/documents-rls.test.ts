import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function insertDocument(opts: {
  institutionId: string;
  entityType: string;
  entityId: string;
  createdBy: string;
  path: string;
  status?: string;
}) {
  const [doc] = await sql`
    insert into public.documents (institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, created_by, status)
    values (
      ${opts.institutionId}, ${opts.entityType}, ${opts.entityId}, 'id_proof', 'file.pdf', 'application/pdf', 1000,
      ${opts.path}, ${opts.createdBy}, ${opts.status ?? "pending"}
    )
    returning id
  `;
  return doc.id as string;
}

describe("documents migration (0067) RLS", () => {
  it("guardian sees own child's document row, not another child's", async () => {
    const inst = await createTestInstitution("documents-guardian");
    try {
      const [{ guardian_id: guardianId }] = await sql`
        select guardian_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.guardian.id}
      `;
      const [{ student_id: ownChildId }] = await sql`
        select student_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianId}, ${ownChildId}, 'father', true)
      `;
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-OTHER-CHILD', 'Other', '2015-01-01', 'other')
        returning id
      `;

      const ownDocId = await insertDocument({
        institutionId: inst.institutionId,
        entityType: "student",
        entityId: ownChildId,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/student/${ownChildId}/doc.pdf`,
      });
      await insertDocument({
        institutionId: inst.institutionId,
        entityType: "student",
        entityId: otherStudent.id,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/student/${otherStudent.id}/doc.pdf`,
      });

      const { data, error } = await inst.clientAs("guardian").from("documents").select("id");
      expect(error).toBeNull();
      expect(data?.map((d) => d.id)).toEqual([ownDocId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("student sees own document, not another student's", async () => {
    const inst = await createTestInstitution("documents-student");
    try {
      const [{ student_id: ownId }] = await sql`
        select student_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-OTHER-STUDENT', 'Other', '2015-01-01', 'other')
        returning id
      `;

      const ownDocId = await insertDocument({
        institutionId: inst.institutionId,
        entityType: "student",
        entityId: ownId,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/student/${ownId}/doc.pdf`,
      });
      await insertDocument({
        institutionId: inst.institutionId,
        entityType: "student",
        entityId: otherStudent.id,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/student/${otherStudent.id}/doc.pdf`,
      });

      const { data, error } = await inst.clientAs("student").from("documents").select("id");
      expect(error).toBeNull();
      expect(data?.map((d) => d.id)).toEqual([ownDocId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher sees own staff doc only, not another staff member's", async () => {
    const inst = await createTestInstitution("documents-teacher");
    try {
      const [{ staff_id: teacherStaffId }] = await sql`
        select staff_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
      `;
      const [{ staff_id: accountantStaffId }] = await sql`
        select staff_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.accountant.id}
      `;
      await sql`update public.staff set user_id = ${inst.users.teacher.id} where id = ${teacherStaffId}`;

      const ownDocId = await insertDocument({
        institutionId: inst.institutionId,
        entityType: "staff",
        entityId: teacherStaffId,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/staff/${teacherStaffId}/doc.pdf`,
      });
      await insertDocument({
        institutionId: inst.institutionId,
        entityType: "staff",
        entityId: accountantStaffId,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/staff/${accountantStaffId}/doc.pdf`,
      });

      const { data, error } = await inst.clientAs("teacher").from("documents").select("id");
      expect(error).toBeNull();
      expect(data?.map((d) => d.id)).toEqual([ownDocId]);
    } finally {
      await inst.cleanup();
    }
  });

  it("admissions cannot insert a staff document", async () => {
    const inst = await createTestInstitution("documents-admissions-staff");
    try {
      const [{ staff_id: staffId }] = await sql`
        select staff_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
      `;

      const { error } = await inst.clientAs("admissions").from("documents").insert({
        institution_id: inst.institutionId,
        entity_type: "staff",
        entity_id: staffId,
        kind: "id_proof",
        file_name: "file.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
        path: `${inst.institutionId}/staff/${staffId}/admissions-attempt.pdf`,
        created_by: inst.users.admissions.id,
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution A cannot insert a document whose entity_id is institution B's student", async () => {
    await withTwoInstitutions(async (a, b) => {
      const [{ student_id: studentBId }] = await sql`
        select student_id from public.memberships
        where institution_id = ${b.institutionId} and user_id = ${b.users.student.id}
      `;

      const { error } = await a.clientAs("admin").from("documents").insert({
        institution_id: a.institutionId,
        entity_type: "student",
        entity_id: studentBId,
        kind: "id_proof",
        file_name: "file.pdf",
        mime: "application/pdf",
        size_bytes: 1000,
        path: `${a.institutionId}/student/${studentBId}/cross-tenant-attempt.pdf`,
        created_by: a.users.admin.id,
      });
      expect(error).not.toBeNull();

      const rows = await sql`select id from public.documents where entity_id = ${studentBId} and institution_id = ${a.institutionId}`;
      expect(rows).toHaveLength(0);
    });
  });

  it("path cannot be updated", async () => {
    const inst = await createTestInstitution("documents-path-immutable");
    try {
      const [{ student_id: studentId }] = await sql`
        select student_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      const docId = await insertDocument({
        institutionId: inst.institutionId,
        entityType: "student",
        entityId: studentId,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/student/${studentId}/original.pdf`,
      });

      const { error } = await inst
        .clientAs("admin")
        .from("documents")
        .update({ path: `${inst.institutionId}/student/${studentId}/renamed.pdf` })
        .eq("id", docId);
      expect(error).not.toBeNull();

      const [row] = await sql`select path from public.documents where id = ${docId}`;
      expect(row.path).toBe(`${inst.institutionId}/student/${studentId}/original.pdf`);
    } finally {
      await inst.cleanup();
    }
  });

  it("deleted row stays readable to admin but status cannot move back to active", async () => {
    const inst = await createTestInstitution("documents-status-machine");
    try {
      const [{ student_id: studentId }] = await sql`
        select student_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
      `;
      const docId = await insertDocument({
        institutionId: inst.institutionId,
        entityType: "student",
        entityId: studentId,
        createdBy: inst.users.admin.id,
        path: `${inst.institutionId}/student/${studentId}/status.pdf`,
      });

      const activate = await inst.clientAs("admin").from("documents").update({ status: "active" }).eq("id", docId);
      expect(activate.error).toBeNull();

      const softDelete = await inst
        .clientAs("admin")
        .from("documents")
        .update({ status: "deleted", deleted_at: new Date().toISOString(), deleted_by: inst.users.admin.id })
        .eq("id", docId);
      expect(softDelete.error).toBeNull();

      const revive = await inst.clientAs("admin").from("documents").update({ status: "active" }).eq("id", docId);
      expect(revive.error).not.toBeNull();

      const { data, error } = await inst.clientAs("admin").from("documents").select("id, status").eq("id", docId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: docId, status: "deleted" }]);
    } finally {
      await inst.cleanup();
    }
  });
});
