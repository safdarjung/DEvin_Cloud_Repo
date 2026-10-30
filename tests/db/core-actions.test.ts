import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setTeacherAgentEnabled } from "@/modules/core/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("setTeacherAgentEnabled (D30)", () => {
  it("owner can disable then re-enable the flag, patching settings without touching other keys", async () => {
    const inst = await createTestInstitution("core-entitlements");
    await sql`update public.institutions set settings = jsonb_build_object('numbering', jsonb_build_object('admission_no', 'ADM/{SEQ:5}')) where id = ${inst.institutionId}`;

    const disabled = await callAs(inst, "owner", setTeacherAgentEnabled, { enabled: false });
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.data.enabled).toBe(false);

    const [row] = await sql`select settings from public.institutions where id = ${inst.institutionId}`;
    expect(row.settings.features).toEqual({ teacher_ai_agent: false });
    expect(row.settings.numbering).toEqual({ admission_no: "ADM/{SEQ:5}" });

    const enabled = await callAs(inst, "owner", setTeacherAgentEnabled, { enabled: true });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.data.enabled).toBe(true);
  });

  it("a teacher without institution.settings.manage is forbidden", async () => {
    const inst = await createTestInstitution("core-entitlements-forbidden");
    const result = await callAs(inst, "teacher", setTeacherAgentEnabled, { enabled: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("rejects a non-boolean input", async () => {
    const inst = await createTestInstitution("core-entitlements-invalid");
    const ctx = await buildContext(inst, "owner");
    const result = await setTeacherAgentEnabled(inst.slug, { enabled: "yes" }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });
});
