import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { deleteDocument, getReadUrl } from "@/modules/documents/actions";
import { listDocumentsForEntity } from "@/modules/documents/queries";
import { callAs, buildContext, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

// M05-T4 — document.getReadUrl / document.delete / documents.listForEntity.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function studentIdOf(institutionId: string, userId: string): Promise<string> {
  const [{ student_id: studentId }] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return studentId as string;
}

async function guardianIdOf(institutionId: string, userId: string): Promise<string> {
  const [{ guardian_id: guardianId }] = await sql`
    select guardian_id from public.memberships where institution_id = ${institutionId} and user_id = ${userId}
  `;
  return guardianId as string;
}

/** Inserts an active document row with NO real object in storage (sufficient
 * for tests that only read the row's own RLS visibility, not the bytes). */
async function insertActiveDocument(opts: {
  institutionId: string;
  entityId: string;
  createdBy: string;
}): Promise<{ id: string; path: string }> {
  const id = crypto.randomUUID();
  const path = `${opts.institutionId}/student/${opts.entityId}/${id}.pdf`;
  await sql`
    insert into public.documents (id, institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, created_by, status)
    values (${id}, ${opts.institutionId}, 'student', ${opts.entityId}, 'id_proof', 'file.pdf', 'application/pdf', 1000, ${path}, ${opts.createdBy}, 'active')
  `;
  return { id, path };
}

/** Inserts a pending row, uploads real bytes to it via a signed upload URL
 * (as `createdBy`'s client), then flips it active with a direct SQL update
 * (bypasses the guard trigger as `session_user = 'postgres'` — same as a
 * real confirmUpload would, without re-testing confirmUpload itself here). */
async function insertActiveDocumentWithBytes(opts: {
  institutionId: string;
  entityId: string;
  createdBy: string;
  uploaderClient: ReturnType<TestInstitution["clientAs"]>;
  bytes: Buffer;
}): Promise<{ id: string; path: string }> {
  const id = crypto.randomUUID();
  const path = `${opts.institutionId}/student/${opts.entityId}/${id}.pdf`;
  await sql`
    insert into public.documents (id, institution_id, entity_type, entity_id, kind, file_name, mime, size_bytes, path, created_by, status)
    values (${id}, ${opts.institutionId}, 'student', ${opts.entityId}, 'id_proof', 'file.pdf', 'application/pdf', 1000, ${path}, ${opts.createdBy}, 'pending')
  `;
  const signed = await opts.uploaderClient.storage.from("tenant-docs").createSignedUploadUrl(path);
  if (signed.error || !signed.data) throw signed.error ?? new Error("no signed upload url");
  const uploaded = await opts.uploaderClient.storage
    .from("tenant-docs")
    .uploadToSignedUrl(path, signed.data.token, opts.bytes, { contentType: "application/pdf" });
  if (uploaded.error) throw uploaded.error;
  await sql`update public.documents set status = 'active' where id = ${id}`;
  return { id, path };
}

describe("document.getReadUrl / document.delete / documents.listForEntity (M05-T4)", () => {
  it("guardian gets a URL for own child's doc and the URL downloads the bytes", async () => {
    const inst = await createTestInstitution("doc-read-ok");
    try {
      const guardianId = await guardianIdOf(inst.institutionId, inst.users.guardian.id);
      const ownChildId = await studentIdOf(inst.institutionId, inst.users.student.id);
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianId}, ${ownChildId}, 'father', true)
      `;

      const bytes = Buffer.from("%PDF-1.4 real content");
      const doc = await insertActiveDocumentWithBytes({
        institutionId: inst.institutionId,
        entityId: ownChildId,
        createdBy: inst.users.admin.id,
        uploaderClient: inst.clientAs("admin"),
        bytes,
      });

      const result = await callAs(inst, "guardian", getReadUrl, { documentId: doc.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.expiresIn).toBe(60);
      expect(result.data.fileName).toBe("file.pdf");
      expect(result.data.mime).toBe("application/pdf");

      const downloaded = await fetch(result.data.url);
      expect(downloaded.ok).toBe(true);
      const downloadedBytes = Buffer.from(await downloaded.arrayBuffer());
      expect(downloadedBytes.equals(bytes)).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian of another child gets not_found", async () => {
    const inst = await createTestInstitution("doc-read-otherchild");
    try {
      const otherStudent = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-OTHER', 'Other', '2015-01-01', 'other')
        returning id
      `;
      const doc = await insertActiveDocument({
        institutionId: inst.institutionId,
        entityId: otherStudent[0].id as string,
        createdBy: inst.users.admin.id,
      });

      const result = await callAs(inst, "guardian", getReadUrl, { documentId: doc.id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("a deleted doc is not_found and storage refuses a fresh signed URL", async () => {
    const inst = await createTestInstitution("doc-read-deleted");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      const doc = await insertActiveDocument({ institutionId: inst.institutionId, entityId: studentId, createdBy: inst.users.admin.id });

      const deleted = await callAs(inst, "admin", deleteDocument, { documentId: doc.id });
      expect(deleted.ok).toBe(true);

      const result = await callAs(inst, "admin", getReadUrl, { documentId: doc.id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");

      const signed = await inst.clientAs("admin").storage.from("tenant-docs").createSignedUrl(doc.path, 60);
      expect(signed.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("listDocumentsForEntity returns active rows' metadata only (no path/url)", async () => {
    const inst = await createTestInstitution("doc-read-list");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      await insertActiveDocument({ institutionId: inst.institutionId, entityId: studentId, createdBy: inst.users.admin.id });
      await insertActiveDocument({ institutionId: inst.institutionId, entityId: studentId, createdBy: inst.users.admin.id });

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as unknown as Parameters<typeof setActingClient>[0]);
      let rows;
      try {
        rows = await listDocumentsForEntity(ctx, "student", studentId);
      } finally {
        setActingClient(null);
      }
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            kind: "id_proof",
            fileName: "file.pdf",
            mime: "application/pdf",
            sizeBytes: 1000,
          }),
        );
        expect(row).not.toHaveProperty("path");
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant reading a student doc gets not_found (RLS), not forbidden", async () => {
    const inst = await createTestInstitution("doc-read-accountant");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      const doc = await insertActiveDocument({ institutionId: inst.institutionId, entityId: studentId, createdBy: inst.users.admin.id });

      const result = await callAs(inst, "accountant", getReadUrl, { documentId: doc.id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
