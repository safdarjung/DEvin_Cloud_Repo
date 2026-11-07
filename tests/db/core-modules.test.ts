import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setModuleEnabled } from "@/modules/core/actions";
import { listModules } from "@/modules/core/queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("setModuleEnabled (MOD-T4)", () => {
  it("owner disables an optional module: stored false, audited, listModules reflects it", async () => {
    // `assignments` has no dependents and no `requires` of its own, unlike
    // `timetable` (see the dependents-conflict test below).
    const inst = await createTestInstitution("mod-set-assignments");

    const result = await callAs(inst, "owner", setModuleEnabled, { key: "assignments", enabled: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ key: "assignments", enabled: false });

    const [row] = await sql`select settings from public.institutions where id = ${inst.institutionId}`;
    expect(row.settings.modules.assignments).toBe(false);

    const [auditRow] = await sql`
      select action, after from public.audit_events
      where institution_id = ${inst.institutionId} and action = 'core.module.set'
      order by created_at desc limit 1
    `;
    expect(auditRow.action).toBe("core.module.set");
    expect(auditRow.after).toEqual({ key: "assignments", enabled: false });

    const ctx = await buildContext(inst, "owner");
    const groups = await listModules(ctx);
    const academics = groups.find((g) => g.category === "Academics");
    const assignments = academics?.modules.find((m) => m.key === "assignments");
    expect(assignments?.enabled).toBe(false);
  });

  it("a core key is rejected with invalid_state", async () => {
    const inst = await createTestInstitution("mod-set-core");
    const result = await callAs(inst, "owner", setModuleEnabled, { key: "attendance", enabled: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_state");
  });

  it("disabling timetable while substitution (which requires it) is on is a conflict naming Substitution", async () => {
    const inst = await createTestInstitution("mod-set-timetable-dep");
    const result = await callAs(inst, "owner", setModuleEnabled, { key: "timetable", enabled: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
    expect(result.error.message).toContain("Substitution");
  });

  it("enabling online_payments while finance_plus is off is a conflict", async () => {
    const inst = await createTestInstitution("mod-set-online-payments");
    // Set directly: turning finance_plus off through the action would itself
    // conflict here, since online_payments (default on) requires it — that
    // path is covered by the dependents-conflict test above.
    await sql`
      update public.institutions
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{modules}', '{"finance_plus": false, "online_payments": false}'::jsonb)
      where id = ${inst.institutionId}
    `;

    const result = await callAs(inst, "owner", setModuleEnabled, { key: "online_payments", enabled: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
  });

  it("disabling website while the public site is live is a conflict", async () => {
    const inst = await createTestInstitution("mod-set-website-live");
    await sql`
      insert into public.websites (institution_id, is_live)
      values (${inst.institutionId}, true)
    `;
    const result = await callAs(inst, "owner", setModuleEnabled, { key: "website", enabled: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
  });

  it("a teacher without institution.settings.manage is forbidden", async () => {
    const inst = await createTestInstitution("mod-set-forbidden");
    const result = await callAs(inst, "teacher", setModuleEnabled, { key: "timetable", enabled: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });
});

describe("listModules (MOD-T4)", () => {
  // T6 (ai-roles): teacher_ai_agent/student_ai_* feature toggles moved from
  // this page to /settings/ai's per-role capability switches, so ai_teacher
  // no longer lists them here.
  it("has 11 categories in display order, core modules enabled, ai_teacher lists no options", async () => {
    const inst = await createTestInstitution("mod-list");
    const ctx = await buildContext(inst, "owner");
    const groups = await listModules(ctx);

    expect(groups).toHaveLength(11);
    expect(groups.map((g) => g.category)).toEqual([
      "Core",
      "Academics",
      "Exams",
      "Admissions & Website",
      "People & HR",
      "Finance+",
      "Operations",
      "Communication",
      "Reports",
      "AI",
      "Intelligence",
    ]);

    const core = groups.find((g) => g.category === "Core");
    expect(core?.modules.every((m) => m.core && m.enabled)).toBe(true);

    const ai = groups.find((g) => g.category === "AI");
    const aiTeacher = ai?.modules.find((m) => m.key === "ai_teacher");
    expect(aiTeacher?.options).toEqual([]);
  });
});
