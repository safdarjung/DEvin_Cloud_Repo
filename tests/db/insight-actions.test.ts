// M19-T16 — insight.review / insight.action / insight.resolve /
// insight.dismiss actions (M19-tasks.md Task 16; migration 0092 part 2's
// decide_insight / record_insight_action RPCs, built in T3).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (leave-actions.test.ts pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { dismissInsight, recordInsightAction, resolveInsight, reviewInsight } from "@/modules/insights/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

interface InsightOverrides {
  domain?: string;
  status?: string;
  reviewer_role?: string;
  approval_required?: boolean;
}

async function insertInsight(institutionId: string, overrides: InsightOverrides = {}): Promise<string> {
  const { data, error } = await adminClient()
    .from("insights")
    .insert({
      institution_id: institutionId,
      signal: "finance.overdue_growth",
      detector_version: 1,
      dedupe_key: `dk-${crypto.randomUUID()}`,
      domain: "finance",
      kind: "descriptive",
      severity: "warning",
      title: "Overdue fees rising",
      pattern: "Overdue fees rose from 1,000 to 2,000 in the last 4 weeks.",
      evidence: [{ label: "Overdue now", value: 2000 }],
      date_from: "2026-09-01",
      date_to: "2026-10-01",
      confidence: 0.6,
      reviewer_role: "accountant",
      entity_type: "fee_structure",
      entity_id: crypto.randomUUID(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function actionInput(insightId: string, overrides: Record<string, unknown> = {}) {
  return {
    insightId,
    action: "Call the top 10 overdue families",
    owner: "Accounts office",
    rationale: "Most of the overdue balance sits with a few families.",
    expectedOutcome: "Overdue balance drops by a third in two weeks.",
    ...overrides,
  };
}

describe("insight.* actions (M19-T16)", () => {
  it("principal review -> reviewing", async () => {
    const inst = await createTestInstitution("insight-act-review");
    try {
      const id = await insertInsight(inst.institutionId);
      const result = await callAs(inst, "principal", reviewInsight, { insightId: id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ id, status: "reviewing" });
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant reviewing an attendance insight -> not_found (not visible to that domain)", async () => {
    const inst = await createTestInstitution("insight-act-domain");
    try {
      const id = await insertInsight(inst.institutionId, { domain: "attendance", reviewer_role: "principal" });
      const result = await callAs(inst, "accountant", reviewInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // app.insight_visible gates before app.can_review_insight (error rules order),
      // so an unrelated domain reads as not_found, never forbidden.
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant resolving an approval-required finance insight -> forbidden (owner/principal only)", async () => {
    const inst = await createTestInstitution("insight-act-approval");
    try {
      const id = await insertInsight(inst.institutionId, { approval_required: true });
      const result = await callAs(inst, "accountant", resolveInsight, { insightId: id, note: "Trying to close this." });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling review -> forbidden (lacks insight.review permission)", async () => {
    const inst = await createTestInstitution("insight-act-teacher");
    try {
      const id = await insertInsight(inst.institutionId);
      const result = await callAs(inst, "teacher", reviewInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("record action planned then done (supersedes) -> 2 rows, 1 current; insight actioned", async () => {
    const inst = await createTestInstitution("insight-act-supersede");
    try {
      const id = await insertInsight(inst.institutionId);
      const planned = await callAs(inst, "accountant", recordInsightAction, actionInput(id));
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.data.status).toBe("planned");

      const done = await callAs(
        inst,
        "accountant",
        recordInsightAction,
        actionInput(id, { status: "done", supersedesId: planned.data.id }),
      );
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.data).toEqual({ id: done.data.id, insightId: id, status: "done" });

      const rows = await sql`select id, supersedes_id from public.insight_actions where insight_id = ${id}::uuid`;
      expect(rows).toHaveLength(2);
      const current = rows.filter((r) => !rows.some((other) => other.supersedes_id === r.id));
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(done.data.id);

      const [insightRow] = await sql`select status from public.insights where id = ${id}::uuid`;
      expect(insightRow.status).toBe("actioned");
    } finally {
      await inst.cleanup();
    }
  });

  it("dismiss on an actioned insight -> invalid_state", async () => {
    const inst = await createTestInstitution("insight-act-dismiss-actioned");
    try {
      const id = await insertInsight(inst.institutionId, { status: "actioned" });
      const result = await callAs(inst, "accountant", dismissInsight, { insightId: id, note: "Not relevant anymore." });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("resolve with a note -> resolved", async () => {
    const inst = await createTestInstitution("insight-act-resolve");
    try {
      const id = await insertInsight(inst.institutionId);
      const result = await callAs(inst, "accountant", resolveInsight, { insightId: id, note: "Handled with the family." });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ id, status: "resolved" });
    } finally {
      await inst.cleanup();
    }
  });

  it("insights module off -> forbidden + MODULE_DISABLED_MESSAGE", async () => {
    const inst = await createTestInstitution("insight-act-module-off");
    try {
      const id = await insertInsight(inst.institutionId);
      await sql`
        update public.institutions
        set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{modules,insights}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;
      const result = await callAs(inst, "accountant", reviewInsight, { insightId: id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
      expect(result.error.message).toBe("Module not enabled for this school.");
    } finally {
      await inst.cleanup();
    }
  });
});
