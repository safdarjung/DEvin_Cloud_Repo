import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setFeatureEnabled } from "@/modules/core/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("setFeatureEnabled (D30/D33)", () => {
  it("owner can disable then re-enable a flag, patching settings without touching other keys", async () => {
    const inst = await createTestInstitution("core-entitlements");
    await sql`update public.institutions set settings = jsonb_build_object('numbering', jsonb_build_object('admission_no', 'ADM/{SEQ:5}')) where id = ${inst.institutionId}`;

    const disabled = await callAs(inst, "owner", setFeatureEnabled, { key: "teacher_ai_agent", enabled: false });
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.data).toEqual({ key: "teacher_ai_agent", enabled: false });

    const [row] = await sql`select settings from public.institutions where id = ${inst.institutionId}`;
    expect(row.settings.features).toEqual({ teacher_ai_agent: false });
    expect(row.settings.numbering).toEqual({ admission_no: "ADM/{SEQ:5}" });

    const enabled = await callAs(inst, "owner", setFeatureEnabled, { key: "teacher_ai_agent", enabled: true });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.data.enabled).toBe(true);
  });

  it("a different key is written independently of an existing one", async () => {
    const inst = await createTestInstitution("core-entitlements-multi");
    await sql`update public.institutions set settings = jsonb_build_object('features', jsonb_build_object('teacher_ai_agent', true)) where id = ${inst.institutionId}`;

    const result = await callAs(inst, "owner", setFeatureEnabled, { key: "student_ai_study", enabled: true });
    expect(result.ok).toBe(true);

    const [row] = await sql`select settings from public.institutions where id = ${inst.institutionId}`;
    expect(row.settings.features).toEqual({ teacher_ai_agent: true, student_ai_study: true });
  });

  it("a teacher without institution.settings.manage is forbidden", async () => {
    const inst = await createTestInstitution("core-entitlements-forbidden");
    const result = await callAs(inst, "teacher", setFeatureEnabled, { key: "teacher_ai_agent", enabled: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("rejects a non-boolean input", async () => {
    const inst = await createTestInstitution("core-entitlements-invalid");
    const ctx = await buildContext(inst, "owner");
    const result = await setFeatureEnabled(inst.slug, { key: "teacher_ai_agent", enabled: "yes" }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });

  it("rejects a key outside the closed catalog", async () => {
    const inst = await createTestInstitution("core-entitlements-unknown-key");
    const ctx = await buildContext(inst, "owner");
    const result = await setFeatureEnabled(inst.slug, { key: "not_a_real_feature", enabled: true }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
  });
});
