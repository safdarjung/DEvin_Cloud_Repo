import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("app.cron_next_fire (0077)", () => {
  const tz = "Asia/Kolkata";

  it("'0 20 * * *' after 13:00Z fires same day at 14:30Z", async () => {
    const [row] = await sql`select app.cron_next_fire('0 20 * * *', ${tz}, '2026-11-02T13:00:00Z') as fire`;
    expect(new Date(row.fire).toISOString()).toBe("2026-11-02T14:30:00.000Z");
  });

  it("'0 20 * * *' after 15:00Z (past today's fire) rolls to next day 14:30Z", async () => {
    const [row] = await sql`select app.cron_next_fire('0 20 * * *', ${tz}, '2026-11-02T15:00:00Z') as fire`;
    expect(new Date(row.fire).toISOString()).toBe("2026-11-03T14:30:00.000Z");
  });

  it("'30 7 * * 1' (Mondays) after 13:00Z on a Monday rolls to next Monday 02:00Z", async () => {
    const [row] = await sql`select app.cron_next_fire('30 7 * * 1', ${tz}, '2026-11-02T13:00:00Z') as fire`;
    expect(new Date(row.fire).toISOString()).toBe("2026-11-09T02:00:00.000Z");
  });

  it("'0 8 31 2 *' (Feb 31 never exists) is null", async () => {
    const [row] = await sql`select app.cron_next_fire('0 8 31 2 *', ${tz}, '2026-11-02T13:00:00Z') as fire`;
    expect(row.fire).toBeNull();
  });

  it("'*/5 * * * *' (steps unsupported) fails the grammar and is null", async () => {
    const [row] = await sql`select app.cron_next_fire('*/5 * * * *', ${tz}, '2026-11-02T13:00:00Z') as fire`;
    expect(row.fire).toBeNull();
  });
});

describe("scheduled_reports table + write guard + RLS (0077)", () => {
  it("admin insert sets next_run_at and forces created_by to the caller", async () => {
    const inst = await createTestInstitution("sr-insert");
    try {
      const { data, error } = await inst
        .clientAs("admin")
        .from("scheduled_reports")
        .insert({
          institution_id: inst.institutionId,
          name: "Nightly attendance",
          source: "attendance.daily",
          cron: "0 20 * * *",
          recipient_roles: ["principal"],
          created_by: inst.users.teacher.id, // ignored — guard forces the real caller
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data.created_by).toBe(inst.users.admin.id);
      expect(data.next_run_at).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher recipient on attendance.daily is validation_failed (role not allowed for source)", async () => {
    const inst = await createTestInstitution("sr-bad-role");
    try {
      const { error } = await inst.clientAs("admin").from("scheduled_reports").insert({
        institution_id: inst.institutionId,
        name: "Bad recipient",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipient_roles: ["teacher"],
      });

      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant recipient on finance.defaulters is ok", async () => {
    const inst = await createTestInstitution("sr-good-role");
    try {
      const { error } = await inst.clientAs("admin").from("scheduled_reports").insert({
        institution_id: inst.institutionId,
        name: "Defaulters",
        source: "finance.defaulters",
        cron: "0 20 * * *",
        recipient_roles: ["accountant"],
      });

      expect(error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a cron that never fires is validation_failed", async () => {
    const inst = await createTestInstitution("sr-never-fires");
    try {
      const { error } = await inst.clientAs("admin").from("scheduled_reports").insert({
        institution_id: inst.institutionId,
        name: "Never fires",
        source: "attendance.daily",
        cron: "0 8 31 2 *",
        recipient_roles: ["admin"],
      });

      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin updating next_run_at directly (no cron/status change) leaves it unchanged", async () => {
    const inst = await createTestInstitution("sr-noop-update");
    try {
      const { data: created } = await inst
        .clientAs("admin")
        .from("scheduled_reports")
        .insert({
          institution_id: inst.institutionId,
          name: "Stable",
          source: "attendance.daily",
          cron: "0 20 * * *",
          recipient_roles: ["admin"],
        })
        .select()
        .single();

      const forcedFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      const { data: updated, error } = await inst
        .clientAs("admin")
        .from("scheduled_reports")
        .update({ next_run_at: forcedFuture })
        .eq("id", created.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated.next_run_at).toBe(created.next_run_at);
    } finally {
      await inst.cleanup();
    }
  });

  it("pausing nulls next_run_at; resuming recomputes it", async () => {
    const inst = await createTestInstitution("sr-pause-resume");
    try {
      const { data: created } = await inst
        .clientAs("admin")
        .from("scheduled_reports")
        .insert({
          institution_id: inst.institutionId,
          name: "Pausable",
          source: "attendance.daily",
          cron: "0 20 * * *",
          recipient_roles: ["admin"],
        })
        .select()
        .single();

      const { data: paused } = await inst
        .clientAs("admin")
        .from("scheduled_reports")
        .update({ status: "paused" })
        .eq("id", created.id)
        .select()
        .single();
      expect(paused.next_run_at).toBeNull();

      const { data: resumed } = await inst
        .clientAs("admin")
        .from("scheduled_reports")
        .update({ status: "active" })
        .eq("id", created.id)
        .select()
        .single();
      expect(resumed.next_run_at).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("changing institution_id is forbidden", async () => {
    const instA = await createTestInstitution("sr-forbidden-a");
    const instB = await createTestInstitution("sr-forbidden-b");
    try {
      const { data: created } = await instA
        .clientAs("admin")
        .from("scheduled_reports")
        .insert({
          institution_id: instA.institutionId,
          name: "Fixed institution",
          source: "attendance.daily",
          cron: "0 20 * * *",
          recipient_roles: ["admin"],
        })
        .select()
        .single();

      const { error } = await instA
        .clientAs("admin")
        .from("scheduled_reports")
        .update({ institution_id: instB.institutionId })
        .eq("id", created.id);

      expect(error?.message).toContain("code:forbidden");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("duplicate name within an institution is a 23505 conflict", async () => {
    const inst = await createTestInstitution("sr-dup-name");
    try {
      const row = {
        institution_id: inst.institutionId,
        name: "Duplicate",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipient_roles: ["admin"],
      };
      const first = await inst.clientAs("admin").from("scheduled_reports").insert(row);
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").from("scheduled_reports").insert(row);
      expect(second.error?.code).toBe("23505");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher and accountant select 0 rows; insert is denied by RLS (42501)", async () => {
    const inst = await createTestInstitution("sr-rls-staff");
    try {
      for (const role of ["teacher", "accountant"] as const) {
        const { data, error } = await inst.clientAs(role).from("scheduled_reports").select();
        expect(error).toBeNull();
        expect(data).toHaveLength(0);

        const insert = await inst.clientAs(role).from("scheduled_reports").insert({
          institution_id: inst.institutionId,
          name: `Blocked ${role}`,
          source: "attendance.daily",
          cron: "0 20 * * *",
          recipient_roles: ["admin"],
        });
        expect(insert.error?.code).toBe("42501");
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of A inserting with B's institution_id is denied by RLS (42501)", async () => {
    const instA = await createTestInstitution("sr-cross-a");
    const instB = await createTestInstitution("sr-cross-b");
    try {
      const { error } = await instA.clientAs("admin").from("scheduled_reports").insert({
        institution_id: instB.institutionId,
        name: "Cross tenant",
        source: "attendance.daily",
        cron: "0 20 * * *",
        recipient_roles: ["admin"],
      });
      expect(error?.code).toBe("42501");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });
});
