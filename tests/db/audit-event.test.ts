import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// D27 — public.record_audit_event (20261028000013) is the only path from app
// code to app.audit(). The actor is always the signed-in caller; the caller
// must be a member of the target institution.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const event = (institutionId: string) => ({
  p_institution_id: institutionId,
  p_action: "attendance.submit",
  p_entity_type: "attendance_session",
  p_entity_id: null,
  p_before: null,
  p_after: { status: "submitted" },
  p_metadata: null,
});

describe("record_audit_event (D27)", () => {
  it("records the event with the caller as actor", async () => {
    const inst = await createTestInstitution("audit-event-member");
    try {
      const { data, error } = await inst.clientAs("teacher").rpc("record_audit_event", event(inst.institutionId));
      expect(error).toBeNull();

      const rows = await sql`
        select institution_id, actor_user_id, action, after from public.audit_events where id = ${data as string}::uuid
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].institution_id).toBe(inst.institutionId);
      expect(rows[0].actor_user_id).toBe(inst.users.teacher.id);
      expect(rows[0].action).toBe("attendance.submit");
      expect(rows[0].after).toEqual({ status: "submitted" });
    } finally {
      await inst.cleanup();
    }
  });

  it("rejects a caller who is not a member of the target institution", async () => {
    await withTwoInstitutions(async (a, b) => {
      const { error } = await b.clientAs("admin").rpc("record_audit_event", event(a.institutionId));
      expect(error?.message).toBe("code:forbidden");
    });
  });

  it("rejects anonymous callers", async () => {
    const inst = await createTestInstitution("audit-event-anon");
    try {
      const { error } = await inst.clientAsAnon().rpc("record_audit_event", event(inst.institutionId));
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("rejects an action name that is not dotted lowercase", async () => {
    const inst = await createTestInstitution("audit-event-bad-action");
    try {
      const { error } = await inst
        .clientAs("teacher")
        .rpc("record_audit_event", { ...event(inst.institutionId), p_action: "Drop Table" });
      expect(error?.message).toBe("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });
});
