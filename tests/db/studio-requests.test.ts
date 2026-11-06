import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// 20261028000107 (live-fabric studio lane) — studio_requests table, write
// guard, RLS, and the propose_studio_request/decide_studio_request
// definers. Mirrors tests/db/workflows-rls.test.ts / workflows-run-actions.test.ts.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function requestRow(institutionId: string, overrides: Record<string, unknown> = {}) {
  return {
    institution_id: institutionId,
    title: "Hostel leave approvals",
    problem: "Wardens manage leaves on paper.",
    desired_outcome: "Digital approval workflow.",
    context: { userRoles: ["warden"], existingSystems: ["Core"], integrations: [], constraints: "" },
    terms: { budgetRange: "under_50k", timeline: "1 month", successCriteria: "All leaves digital." },
    ...overrides,
  };
}

async function insertRequest(
  client: SupabaseClient,
  institutionId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const { data, error } = await client.from("studio_requests").insert(requestRow(institutionId, overrides)).select("id").single();
  if (error) throw error;
  return data as { id: string };
}

const MINIMAL_PROPOSAL = {
  resolution: "new_module",
  interpretation: "A digital leave workflow tied to roles.",
  features: ["Leave request form"],
  acceptanceCriteria: ["95% approved within 6 hours"],
};

describe("studio_requests table + write guard + RLS (0107)", () => {
  it("principal inserts: status forced to submitted, created_by forced to caller", async () => {
    const inst = await createTestInstitution("studio-insert");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .from("studio_requests")
        .insert(requestRow(inst.institutionId, { status: "approved", created_by: inst.users.teacher.id }))
        .select()
        .single();

      expect(error).toBeNull();
      expect(data.status).toBe("submitted");
      expect(data.proposal).toBeNull();
      expect(data.created_by).toBe(inst.users.principal.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin inserts and reads; teacher/accountant/guardian cannot insert and see none", async () => {
    const inst = await createTestInstitution("studio-rls");
    try {
      const adminInsert = await inst.clientAs("admin").from("studio_requests").insert(requestRow(inst.institutionId)).select("id");
      expect(adminInsert.error).toBeNull();
      expect(adminInsert.data).toHaveLength(1);

      const adminSelect = await inst.clientAs("admin").from("studio_requests").select("id");
      expect(adminSelect.error).toBeNull();
      expect(adminSelect.data).toHaveLength(1);

      for (const role of ["teacher", "accountant", "guardian"] as const) {
        const insertAttempt = await inst.clientAs(role).from("studio_requests").insert(requestRow(inst.institutionId));
        expect(insertAttempt.error?.code).toBe("42501");

        const { data, error } = await inst.clientAs(role).from("studio_requests").select("id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("no role can UPDATE the table directly (no UPDATE grant to authenticated)", async () => {
    const inst = await createTestInstitution("studio-no-direct-update");
    try {
      const created = await insertRequest(inst.clientAs("owner"), inst.institutionId);

      const update = await inst.clientAs("owner").from("studio_requests").update({ title: "Hijacked" }).eq("id", created.id);
      expect(update.error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("propose_studio_request: owner proposes a submitted request; admin may also propose", async () => {
    const inst = await createTestInstitution("studio-propose");
    try {
      const created = await insertRequest(inst.clientAs("principal"), inst.institutionId);

      const { data, error } = await inst.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: MINIMAL_PROPOSAL,
      });
      expect(error).toBeNull();
      expect(data.status).toBe("proposed");
      expect(data.proposal).toMatchObject({ resolution: "new_module" });

      // Already proposed: re-proposing is invalid_state.
      const again = await inst.clientAs("admin").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: MINIMAL_PROPOSAL,
      });
      expect(again.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("propose_studio_request: teacher (not leadership) gets not_found", async () => {
    const inst = await createTestInstitution("studio-propose-forbidden");
    try {
      const created = await insertRequest(inst.clientAs("owner"), inst.institutionId);

      const { error } = await inst.clientAs("teacher").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: MINIMAL_PROPOSAL,
      });
      expect(error?.message).toContain("code:not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("decide_studio_request: admin sees the request but cannot decide (forbidden); owner approves", async () => {
    const inst = await createTestInstitution("studio-decide");
    try {
      const created = await insertRequest(inst.clientAs("owner"), inst.institutionId);
      await inst.clientAs("owner").rpc("propose_studio_request", { p_request_id: created.id, p_proposal: MINIMAL_PROPOSAL });

      const asAdmin = await inst.clientAs("admin").rpc("decide_studio_request", {
        p_request_id: created.id,
        p_decision: "approve",
      });
      expect(asAdmin.error?.message).toContain("code:forbidden");

      const asOwner = await inst.clientAs("owner").rpc("decide_studio_request", {
        p_request_id: created.id,
        p_decision: "approve",
        p_note: "Looks good.",
      });
      expect(asOwner.error).toBeNull();
      expect(asOwner.data.status).toBe("approved");
      expect(asOwner.data.notes).toEqual(["Looks good."]);
      expect(asOwner.data.decided_by).toBeTruthy();
      expect(asOwner.data.decided_at).toBeTruthy();

      // Terminal: deciding again is invalid_state.
      const again = await inst.clientAs("principal").rpc("decide_studio_request", {
        p_request_id: created.id,
        p_decision: "reject",
      });
      expect(again.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("decide_studio_request before a proposal exists is invalid_state", async () => {
    const inst = await createTestInstitution("studio-decide-too-early");
    try {
      const created = await insertRequest(inst.clientAs("principal"), inst.institutionId);

      const { error } = await inst.clientAs("principal").rpc("decide_studio_request", {
        p_request_id: created.id,
        p_decision: "approve",
      });
      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  // M1: propose_studio_request validates p_proposal's shape in SQL before
  // writing it (jsonb_typeof object, required keys present with the
  // expected jsonb type, octet_length cap) — defense in depth behind the
  // caller's Zod-validated runStructured output.
  it("propose_studio_request rejects a malformed proposal shape (M1)", async () => {
    const inst = await createTestInstitution("studio-propose-bad-shape");
    try {
      const created = await insertRequest(inst.clientAs("owner"), inst.institutionId);

      const notAnObject = await inst.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: "not an object",
      });
      expect(notAnObject.error?.message).toContain("code:validation_failed");

      const missingKeys = await inst.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: { resolution: "new_module" },
      });
      expect(missingKeys.error?.message).toContain("code:validation_failed");

      const wrongType = await inst.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        // features must be an array, not a string.
        p_proposal: { ...MINIMAL_PROPOSAL, features: "Leave request form" },
      });
      expect(wrongType.error?.message).toContain("code:validation_failed");

      const tooLarge = await inst.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: { ...MINIMAL_PROPOSAL, interpretation: "x".repeat(20_001) },
      });
      expect(tooLarge.error?.message).toContain("code:validation_failed");

      // A valid proposal still goes through.
      const ok = await inst.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: MINIMAL_PROPOSAL,
      });
      expect(ok.error).toBeNull();
      expect(ok.data.status).toBe("proposed");
    } finally {
      await inst.cleanup();
    }
  });

  // M5: notes is always forced to '{}' on insert for a non-trusted (regular
  // authenticated) caller, and the guard trigger itself rejects an appended
  // note over 500 chars (defense in depth behind decide_studio_request's
  // own p_note length check).
  it("notes is forced empty on insert for a non-trusted caller (M5)", async () => {
    const inst = await createTestInstitution("studio-notes-insert-guard");
    try {
      const inserted = await inst
        .clientAs("owner")
        .from("studio_requests")
        .insert(requestRow(inst.institutionId, { notes: ["sneaked in"] }))
        .select("notes")
        .single();
      expect(inserted.error).toBeNull();
      expect(inserted.data!.notes).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("the guard trigger rejects an appended note over 500 chars even on a direct trusted update (M5)", async () => {
    const inst = await createTestInstitution("studio-notes-update-guard");
    try {
      const created = await insertRequest(inst.clientAs("owner"), inst.institutionId);
      await inst.clientAs("owner").rpc("propose_studio_request", { p_request_id: created.id, p_proposal: MINIMAL_PROPOSAL });

      // decide_studio_request's own p_note check already rejects a note this
      // long; bypass it with a direct service-role update (service_role has
      // an UPDATE grant on this table) to exercise the guard trigger's own
      // per-item length check.
      const { error } = await serviceClient()
        .from("studio_requests")
        .update({
          status: "approved",
          decided_by: inst.users.owner.id,
          decided_at: new Date().toISOString(),
          notes: ["x".repeat(501)],
        })
        .eq("id", created.id);
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-institution: a request from institution B is not_found to institution A's owner", async () => {
    const a = await createTestInstitution("studio-cross-a");
    const b = await createTestInstitution("studio-cross-b");
    try {
      const created = await insertRequest(b.clientAs("owner"), b.institutionId);

      const { error } = await a.clientAs("owner").rpc("propose_studio_request", {
        p_request_id: created.id,
        p_proposal: MINIMAL_PROPOSAL,
      });
      expect(error?.message).toContain("code:not_found");
    } finally {
      await Promise.all([a.cleanup(), b.cleanup()]);
    }
  });
});
