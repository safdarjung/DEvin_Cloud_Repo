import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { confirmUpload, requestUpload } from "@/modules/documents/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M05-T3 — document.requestUpload / document.confirmUpload.
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

describe("document.requestUpload / document.confirmUpload (M05-T3)", () => {
  it("admin requests, uploads, and confirms a PDF -> row active", async () => {
    const inst = await createTestInstitution("doc-upload-ok");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);

      const requested = await callAs(inst, "admin", requestUpload, {
        entityType: "student",
        entityId: studentId,
        kind: "id_proof",
        fileName: "aadhaar.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const uploaded = await inst
        .clientAs("admin")
        .storage.from("tenant-docs")
        .uploadToSignedUrl(requested.data.path, requested.data.token, Buffer.from("%PDF-1.4 minimal"), {
          contentType: "application/pdf",
        });
      expect(uploaded.error).toBeNull();

      const confirmed = await callAs(inst, "admin", confirmUpload, { documentId: requested.data.documentId });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;
      expect(confirmed.data.status).toBe("active");

      const [row] = await sql`select status from public.documents where id = ${requested.data.documentId}`;
      expect(row.status).toBe("active");
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden from requesting an upload", async () => {
    const inst = await createTestInstitution("doc-upload-forbidden");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      const result = await callAs(inst, "teacher", requestUpload, {
        entityType: "student",
        entityId: studentId,
        kind: "id_proof",
        fileName: "aadhaar.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("an unsupported mime type is rejected as validation_failed", async () => {
    const inst = await createTestInstitution("doc-upload-badmime");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      const result = await callAs(inst, "admin", requestUpload, {
        entityType: "student",
        entityId: studentId,
        kind: "id_proof",
        fileName: "notes.txt",
        mime: "text/plain",
        sizeBytes: 1000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a declared size over 10 MB is rejected as validation_failed", async () => {
    const inst = await createTestInstitution("doc-upload-toolarge");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      const result = await callAs(inst, "admin", requestUpload, {
        entityType: "student",
        entityId: studentId,
        kind: "id_proof",
        fileName: "big.pdf",
        mime: "application/pdf",
        sizeBytes: 11 * 1024 * 1024,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("confirming before the object is uploaded is invalid_state", async () => {
    const inst = await createTestInstitution("doc-upload-noobject");
    try {
      const studentId = await studentIdOf(inst.institutionId, inst.users.student.id);
      const requested = await callAs(inst, "admin", requestUpload, {
        entityType: "student",
        entityId: studentId,
        kind: "id_proof",
        fileName: "aadhaar.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;

      const confirmed = await callAs(inst, "admin", confirmUpload, { documentId: requested.data.documentId });
      expect(confirmed.ok).toBe(false);
      if (confirmed.ok) return;
      expect(confirmed.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("an entity from another institution is not_found", async () => {
    await withTwoInstitutions(async (a, b) => {
      const studentBId = await studentIdOf(b.institutionId, b.users.student.id);
      const result = await callAs(a, "admin", requestUpload, {
        entityType: "student",
        entityId: studentBId,
        kind: "id_proof",
        fileName: "aadhaar.pdf",
        mime: "application/pdf",
        sizeBytes: 1000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    });
  });
});
