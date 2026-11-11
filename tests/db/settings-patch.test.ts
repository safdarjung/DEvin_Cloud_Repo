import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { setAiRoleConfig, setFeatureEnabled, setModuleEnabled } from "@/modules/core/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

// 0144 — institutions.settings writes are atomic patches under a row lock, so
// two admins (or tabs) saving different switches never revert each other.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
type Settings = { modules?: Record<string, boolean>; features?: Record<string, boolean>; ai_roles?: Record<string, Record<string, unknown>>; locale?: unknown };
const settingsOf = async (id: string) => (await sql`select settings from public.institutions where id = ${id}`)[0]!.settings as Settings;

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("settings patch (0144)", () => {
  it("a save from a stale snapshot keeps a switch another admin changed meanwhile", async () => {
    const inst = await createTestInstitution("sp-stale");
    try {
      const stale = await buildContext(inst, "principal");
      expect((await callAs(inst, "admin", setFeatureEnabled, { key: "teacher_ai_visuals", enabled: true })).ok).toBe(true);
      expect((await callAs(inst, "admin", setModuleEnabled, { key: "visitors", enabled: false })).ok).toBe(true);

      setActingClient(inst.clientAs("principal"));
      try {
        expect((await setModuleEnabled(inst.slug, { key: "library", enabled: false }, stale)).ok).toBe(true);
        expect((await setAiRoleConfig(inst.slug, { role: "teacher", patch: { modes: { do: false } } }, stale)).ok).toBe(true);
      } finally {
        setActingClient(null);
      }

      const s = await settingsOf(inst.institutionId);
      expect(s.features?.teacher_ai_visuals).toBe(true);
      expect(s.modules?.visitors).toBe(false); // the switch-off did not come back on
      expect(s.modules?.library).toBe(false);
      expect(s.ai_roles?.teacher).toEqual({ modes: { do: false } });
    } finally {
      await inst.cleanup();
    }
  });

  it("two patches to different keys at the same time are both applied; null removes a key", async () => {
    const inst = await createTestInstitution("sp-race");
    try {
      const patch = (role: "principal" | "admin", p: unknown) =>
        inst.clientAs(role).rpc("patch_institution_settings", { p_institution_id: inst.institutionId, p_patch: p as never });
      const [a, b] = await Promise.all([
        patch("principal", { modules: { library: false } }),
        patch("admin", { features: { teacher_ai_visuals: true }, ai_roles: { student: { modes: { learn: false, do: false } } } }),
      ]);
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
      let s = await settingsOf(inst.institutionId);
      expect(s.modules?.library).toBe(false);
      expect(s.modules?.visitors).toBe(true); // siblings untouched
      expect(s.features?.teacher_ai_visuals).toBe(true);

      const removed = await patch("admin", { ai_roles: { student: { modes: { do: null } } } });
      expect(removed.error).toBeNull();
      s = await settingsOf(inst.institutionId);
      expect(s.ai_roles?.student).toEqual({ modes: { learn: false } });
      expect((removed.data as Settings).ai_roles?.student).toEqual({ modes: { learn: false } });
    } finally {
      await inst.cleanup();
    }
  });

  it("refuses a teacher, another school's admin, and keys outside the whitelist", async () => {
    const a = await createTestInstitution("sp-a");
    const b = await createTestInstitution("sp-b");
    try {
      const before = await settingsOf(a.institutionId);
      const teacher = await a.clientAs("teacher").rpc("patch_institution_settings", { p_institution_id: a.institutionId, p_patch: { modules: { library: false } } });
      expect(teacher.error?.message).toBe("code:forbidden");
      const cross = await b.clientAs("admin").rpc("patch_institution_settings", { p_institution_id: a.institutionId, p_patch: { modules: { library: false } } });
      expect(cross.error?.message).toBe("code:forbidden");
      for (const p of [{ locale: { timezone: "UTC", currency: "USD" } }, { modules: { library: false }, ai: { daily_token_quota: 1 } }, [], "x"]) {
        const bad = await a.clientAs("admin").rpc("patch_institution_settings", { p_institution_id: a.institutionId, p_patch: p as never });
        expect(bad.error?.message, JSON.stringify(p)).toBe("code:validation_failed");
      }
      expect(await settingsOf(a.institutionId)).toEqual(before);
      expect((await a.clientAs("teacher").rpc("patch_institution_settings", { p_institution_id: a.institutionId, p_patch: { setup: {} } })).error?.message).toBe("code:forbidden");
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });
});
