import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { setAiRoleConfig } from "@/modules/core/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const settingsOf = async (id: string) => (await sql`select settings from public.institutions where id = ${id}`)[0]!.settings as { ai_roles?: Record<string, Record<string, unknown>> };

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("control centre settings (core.ai_role.set)", () => {
  it("principal saves mode, group and task overrides and an audit event is written", async () => {
    const inst = await createTestInstitution("cc-ok");
    try {
      const r = await callAs(inst, "principal", setAiRoleConfig, {
        role: "teacher",
        patch: { modes: { manage: true, do: false }, groups: { finance: false }, tasks: { "attendance.mark": false } },
      });
      expect(r.ok).toBe(true);
      expect((await settingsOf(inst.institutionId)).ai_roles?.teacher).toMatchObject({ modes: { manage: true, do: false }, groups: { finance: false }, tasks: { "attendance.mark": false } });
      const [audit] = await sql`select after from public.audit_events where institution_id = ${inst.institutionId} and action = 'core.ai_role.set' order by created_at desc limit 1`;
      expect(audit!.after.role).toBe("teacher");
      expect(audit!.after.tasks).toEqual({ "attendance.mark": false });

      // null removes an override, other keys stay
      const r2 = await callAs(inst, "principal", setAiRoleConfig, { role: "teacher", patch: { modes: { do: null } } });
      expect(r2.ok).toBe(true);
      expect((await settingsOf(inst.institutionId)).ai_roles?.teacher?.modes).toEqual({ manage: true });
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher cannot save", async () => {
    const inst = await createTestInstitution("cc-teacher");
    try {
      const r = await callAs(inst, "teacher", setAiRoleConfig, { role: "teacher", patch: { modes: { manage: true } } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("school A cannot write school B", async () => {
    const a = await createTestInstitution("cc-a");
    const b = await createTestInstitution("cc-b");
    try {
      expect((await callAs(b, "principal", setAiRoleConfig, { role: "student", patch: { modes: { learn: false } } })).ok).toBe(true);
      const direct = await a.clientAs("principal").from("institutions").update({ settings: { hacked: true } }).eq("id", b.institutionId).select("id");
      expect(direct.data ?? []).toHaveLength(0);
      expect((await settingsOf(b.institutionId)).ai_roles?.student).toEqual({ modes: { learn: false } });
      expect((await settingsOf(a.institutionId)).ai_roles?.student).toBeUndefined();
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  it("refuses task names that are not classified catalog rows", async () => {
    const inst = await createTestInstitution("cc-bad");
    try {
      for (const name of ["not.a.real.action", "core.member.setRole", "hostel.vacate"]) {
        const r = await callAs(inst, "principal", setAiRoleConfig, { role: "teacher", patch: { tasks: { [name]: false } } });
        expect(r.ok, name).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("validation_failed");
      }
      const unknownGroup = await callAs(inst, "principal", setAiRoleConfig, { role: "teacher", patch: { groups: { nope: false } } } as never);
      expect(unknownGroup.ok).toBe(false);
    } finally {
      await inst.cleanup();
    }
  });
});
