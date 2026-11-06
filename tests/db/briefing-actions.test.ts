// M25-T5 — briefing.generate action + briefings.today query. Thin wrappers
// over T4's briefings.ts service (tests/db/briefings-service.test.ts already
// covers role mapping / recipes / write-once); this file covers the action
// boundary: permission/module gating, audit (counts only, once per day),
// and the query reading back what generate wrote.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { generateBriefing } from "@/modules/insights/briefing.actions";
import { briefingsTodayQuery } from "@/modules/insights/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function auditCount(institutionId: string): Promise<number> {
  const rows = await sql`
    select after from public.audit_events
    where institution_id = ${institutionId}::uuid and action = 'briefing.generate'
  `;
  return rows.length;
}

describe("M25-T5 briefing.generate", () => {
  it("principal: generated_by rules, >=3 sources, one audit row (counts only, no item text); generating again keeps one row and the same brief", async () => {
    const inst = await createTestInstitution("briefing-actions-principal");
    try {
      const first = await callAs(inst, "principal", generateBriefing, {});
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      expect(first.data.generated_by).toBe("rules");
      expect(first.data.sources?.length ?? 0).toBeGreaterThanOrEqual(3);

      expect(await auditCount(inst.institutionId)).toBe(1);
      const [audit] = await sql`
        select after from public.audit_events
        where institution_id = ${inst.institutionId}::uuid and action = 'briefing.generate'
      `;
      const after = audit.after as { role: string; date: string; items: number; sources: number };
      expect(after.role).toBe("principal");
      expect(after.items).toBe(first.data.items.length);
      expect(after.sources).toBe(first.data.sources?.length ?? 0);
      expect(JSON.stringify(after)).not.toContain(first.data.items[0]?.text ?? "\u0000no-items\u0000");

      const second = await callAs(inst, "principal", generateBriefing, {});
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("unreachable");
      expect(second.data).toEqual(first.data);
      expect(await auditCount(inst.institutionId)).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher: a teacher brief", async () => {
    const inst = await createTestInstitution("briefing-actions-teacher");
    try {
      const result = await callAs(inst, "teacher", generateBriefing, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.role).toBe("teacher");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: forbidden (no insight.read)", async () => {
    const inst = await createTestInstitution("briefing-actions-guardian");
    try {
      const result = await callAs(inst, "guardian", generateBriefing, {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("exam_controller: generate forbidden 'No briefing for this role.'; today null", async () => {
    const inst = await createTestInstitution("briefing-actions-exam-controller");
    try {
      const generated = await callAs(inst, "exam_controller", generateBriefing, {});
      expect(generated.ok).toBe(false);
      if (generated.ok) throw new Error("unreachable");
      expect(generated.error.code).toBe("forbidden");
      expect(generated.error.message).toBe("No briefing for this role.");

      const today = await callAs(inst, "exam_controller", briefingsTodayQuery, {});
      expect(today.ok).toBe(true);
      if (!today.ok) throw new Error("unreachable");
      expect(today.data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("ai_briefings module off: both generate and today are forbidden with MODULE_DISABLED_MESSAGE", async () => {
    const inst = await createTestInstitution("briefing-actions-module-off");
    try {
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,ai_briefings}', 'false'::jsonb)
        where id = ${inst.institutionId}::uuid
      `;

      const generated = await callAs(inst, "principal", generateBriefing, {});
      expect(generated.ok).toBe(false);
      if (generated.ok) throw new Error("unreachable");
      expect(generated.error.code).toBe("forbidden");
      expect(generated.error.message).toBe(MODULE_DISABLED_MESSAGE);

      const today = await callAs(inst, "principal", briefingsTodayQuery, {});
      expect(today.ok).toBe(false);
      if (today.ok) throw new Error("unreachable");
      expect(today.error.code).toBe("forbidden");
      expect(today.error.message).toBe(MODULE_DISABLED_MESSAGE);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M25-T5 briefings.today", () => {
  it("null before generate; equal to the generated brief after", async () => {
    const inst = await createTestInstitution("briefing-actions-today");
    try {
      const before = await callAs(inst, "principal", briefingsTodayQuery, {});
      expect(before.ok).toBe(true);
      if (!before.ok) throw new Error("unreachable");
      expect(before.data).toBeNull();

      const generated = await callAs(inst, "principal", generateBriefing, {});
      expect(generated.ok).toBe(true);
      if (!generated.ok) throw new Error("unreachable");

      const after = await callAs(inst, "principal", briefingsTodayQuery, {});
      expect(after.ok).toBe(true);
      if (!after.ok) throw new Error("unreachable");
      expect(after.data).toEqual(generated.data);
    } finally {
      await inst.cleanup();
    }
  });
});
