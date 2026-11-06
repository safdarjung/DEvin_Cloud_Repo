import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// M22-T10 — agent_run source of the approvals union (06-backend-packets/
// M22-tasks.md Task 10). Fixture institution (not the seeded demo tenant,
// unlike approvals-pending.test.ts) because runs are server-write-only —
// mirrors tests/db/agents-queries.test.ts's service-role insertRun helper.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { agentDefinitionsQuery } from "@/modules/agents/query-defs";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { withModules } from "../helpers/demo-context";

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

afterAll(async () => {
  await closeActionsHelper();
  await closeRolesHelper();
});

const SECRET_TASK_TEXT = "SECRET-TASK-this-task-text-must-never-leak-into-a-title";

async function insertAwaitingRun(
  institutionId: string,
  agentId: string,
  requestedBy: string,
  riskClass: "human_approved" | "user_confirmed",
  proposalCount: number,
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_runs")
    .insert({
      institution_id: institutionId,
      agent_id: agentId,
      requested_by: requestedBy,
      task: SECRET_TASK_TEXT,
      status: "awaiting_approval",
      risk_class: riskClass,
      catalog_version: "agents_v1",
      started_at: new Date().toISOString(),
      proposals: Array.from({ length: proposalCount }, () => ({
        action: "finance.reminders.send",
        input: {},
        risk_class: riskClass,
        status: "proposed",
        error_code: null,
      })),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function insertDoneRun(institutionId: string, agentId: string, requestedBy: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_runs")
    .insert({
      institution_id: institutionId,
      agent_id: agentId,
      requested_by: requestedBy,
      task: SECRET_TASK_TEXT,
      status: "done",
      risk_class: "human_approved",
      catalog_version: "agents_v1",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      proposals: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe("core.approvals.pending — agent_run source (M22-T10)", () => {
  it("principal sees both awaiting runs oldest first; admin sees only the one they requested; done runs never appear; task text never leaks", async () => {
    const inst = await createTestInstitution("approvals-agent-runs");
    try {
      const defs = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!defs.ok) throw new Error("unreachable");
      const financeId = defs.data.find((d) => d.slug === "finance")!.id;

      const humanApprovedRun = await insertAwaitingRun(
        inst.institutionId,
        financeId,
        inst.users.owner.id,
        "human_approved",
        1,
      );
      const userConfirmedRun = await insertAwaitingRun(
        inst.institutionId,
        financeId,
        inst.users.admin.id,
        "user_confirmed",
        1,
      );
      await insertDoneRun(inst.institutionId, financeId, inst.users.owner.id);

      const principalCtx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const principalRows = await pendingApprovals(principalCtx);
      setActingClient(null);

      const principalAgentRows = principalRows.filter((r) => r.kind === "agent_run");
      expect(principalAgentRows.map((r) => r.id)).toEqual([humanApprovedRun, userConfirmedRun]);
      expect(principalAgentRows.every((r) => r.title === "Finance agent: 1 action(s) to approve")).toBe(true);
      expect(principalRows.some((r) => r.title.includes(SECRET_TASK_TEXT))).toBe(false);

      const adminCtx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const adminRows = await pendingApprovals(adminCtx);
      setActingClient(null);

      const adminAgentRows = adminRows.filter((r) => r.kind === "agent_run");
      expect(adminAgentRows.map((r) => r.id)).toEqual([userConfirmedRun]);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("agents module off drops the source; accountant has neither permission nor module", async () => {
    const inst = await createTestInstitution("approvals-agent-runs-gate");
    try {
      const defs = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!defs.ok) throw new Error("unreachable");
      const financeId = defs.data.find((d) => d.slug === "finance")!.id;
      await insertAwaitingRun(inst.institutionId, financeId, inst.users.owner.id, "human_approved", 1);

      const principalCtx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const withModuleOff = await pendingApprovals(withModules(principalCtx, { agents: false }));
      setActingClient(null);
      expect(withModuleOff.some((r) => r.kind === "agent_run")).toBe(false);

      const accountantCtx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      const accountantRows = await pendingApprovals(accountantCtx);
      setActingClient(null);
      expect(accountantRows).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
