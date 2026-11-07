import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { setAiRoleConfig } from "@/modules/core/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function getAuditRow(institutionId: string, action: string) {
  const rows = await sql`
    select * from public.audit_events
    where institution_id = ${institutionId} and action = ${action}
    order by created_at desc
    limit 1
  `;
  return rows[0];
}

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("AI role settings (T2)", () => {
  it("principal writes ai role config -> success", async () => {
    const inst = await createTestInstitution("ai-role-settings-ok");

    const result = await callAs(inst, "principal", setAiRoleConfig, {
      role: "teacher",
      patch: {
        enabled: true,
        cloud: false,
        instructions: "Test instructions",
        daily_token_quota: 1000,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe("teacher");
    expect(result.data.enabled).toBe(true);
    expect(result.data.cloud).toBe(false);
    expect(result.data.instructions).toBe("Test instructions");
    expect(result.data.daily_token_quota).toBe(1000);
  });

  it("teacher is forbidden from writing ai role config", async () => {
    const inst = await createTestInstitution("ai-role-settings-forbidden");

    const result = await callAs(inst, "teacher", setAiRoleConfig, {
      role: "teacher",
      patch: { enabled: true },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("bad capability key is rejected with validation_failed", async () => {
    const inst = await createTestInstitution("ai-role-settings-bad-key");

    const result = await callAs(inst, "principal", setAiRoleConfig, {
      role: "student",
      patch: {
        enabled: true,
        capabilities: { unknown_capability_xyz: true },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("audit row records role and changed keys (not instructions)", async () => {
    const inst = await createTestInstitution("ai-role-settings-audit");

    const result = await callAs(inst, "principal", setAiRoleConfig, {
      role: "guardian",
      patch: {
        enabled: true,
        instructions: "Guardian AI should be helpful",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditRow = await getAuditRow(inst.institutionId, "core.ai_role.set");
    expect(auditRow).toBeDefined();
    expect(auditRow.after.role).toBe("guardian");
    expect(auditRow.after.enabled).toBe(true);
    // Instructions text should not be in audit log
    expect(auditRow.after.instructions).toBeUndefined();
  });
});
