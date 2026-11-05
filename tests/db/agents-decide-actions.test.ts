import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import { allModulesOn } from "@/lib/modules/catalog";

// M22-T8 — agent.approve / agent.reject (rulings "Who decides", guard
// transitions). `executeProposals` is real here (not mocked): approving a
// `low_risk_reversible`/catalog-allowed proposal really calls the
// registered action (e.g. announcement.create), so "a draft exists" is an
// actual row, not a canned outcome (that's T7's own coverage).
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { approveAgentRun, rejectAgentRun } from "@/modules/agents/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

function serviceClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

async function insertDefinition(institutionId: string, slug: string, isEnabled = true): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_definitions")
    .insert({ institution_id: institutionId, slug, is_enabled: isEnabled })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

interface Proposal {
  action: string;
  input: unknown;
  risk_class: "low_risk_reversible" | "user_confirmed" | "human_approved";
  status: "proposed" | "executed" | "failed" | "skipped";
  error_code: string | null;
}

async function insertRun(
  institutionId: string,
  agentId: string,
  requestedBy: string,
  overrides: Partial<{ riskClass: string; status: string; proposals: Proposal[] }> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_runs")
    .insert({
      institution_id: institutionId,
      agent_id: agentId,
      requested_by: requestedBy,
      task: "Probe task",
      risk_class: overrides.riskClass ?? "human_approved",
      status: overrides.status ?? "awaiting_approval",
      catalog_version: "agents_v1",
      started_at: new Date().toISOString(),
      proposals: overrides.proposals ?? [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

const ANNOUNCEMENT_PROPOSAL: Proposal = {
  action: "announcement.create",
  input: { title: "Agent draft", body: "Draft body from an agent proposal.", audiences: [{ type: "school" }] },
  risk_class: "low_risk_reversible",
  status: "proposed",
  error_code: null,
};

// A second "admin"-role user in the same institution, for the user_confirmed
// "requester vs. a different non-approving holder" case — `createTestInstitution`
// only gives one user per role, so this is a one-off extra membership, signed
// in for real (RLS must see it as "admin", not a fixture object).
async function createSecondAdmin(inst: TestInstitution): Promise<{ ctx: TenantContext; client: SupabaseClient<Database>; cleanup: () => Promise<void> }> {
  const admin = serviceClient();
  const email = `test-agents-admin2-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("failed to create second admin");
  const userId = data.user.id;

  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Second Admin', 'admin')
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, staff_id)
    values (${inst.institutionId}, ${userId}, 'admin', ${staff.id})
  `;

  const client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;

  const ctx: TenantContext = {
    institution: { id: inst.institutionId, slug: inst.slug, name: inst.slug, settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
    user: { id: userId, profile: { fullName: "Second Admin", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "admin", staffId: staff.id as string, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor("admin")),
  };

  return {
    ctx,
    client,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

describe("M22-T8 agent.approve / agent.reject", () => {
  it("human_approved run: admin forbidden, principal approves -> done, announcement draft exists, decided_by principal", async () => {
    const inst = await createTestInstitution("agent-decide-human");
    try {
      const agentId = await insertDefinition(inst.institutionId, "communication");
      const runId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        riskClass: "human_approved",
        proposals: [ANNOUNCEMENT_PROPOSAL],
      });

      const adminResult = await callAs(inst, "admin", approveAgentRun, { runId });
      expect(adminResult).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const result = await callAs(inst, "principal", approveAgentRun, { runId });
      expect(result).toMatchObject({ ok: true, data: { status: "done", executed: 1, failed: 0 } });

      const [row] = await sql`select status, decided_by, finished_at from public.agent_runs where id = ${runId}::uuid`;
      expect(row.status).toBe("done");
      expect(row.decided_by).toBe(inst.users.principal.id);
      expect(row.finished_at).not.toBeNull();

      const announcements = await sql`select count(*)::int as n from public.announcements where institution_id = ${inst.institutionId}`;
      expect(announcements[0].n).toBe(1);

      // approving an already-decided run: invalid_state, not conflict
      const again = await callAs(inst, "principal", approveAgentRun, { runId });
      expect(again).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("two concurrent approves: one done, one conflict, exactly one announcement", async () => {
    const inst = await createTestInstitution("agent-decide-concurrent");
    try {
      const agentId = await insertDefinition(inst.institutionId, "communication");
      const runId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        riskClass: "human_approved",
        proposals: [ANNOUNCEMENT_PROPOSAL],
      });

      // Not `callAs` for both legs: it sets/clears a module-global acting
      // client, which races when two calls under the same role run
      // concurrently. Set it once for both, as the real server client would
      // be per-request anyway.
      const principalCtx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal") as unknown as SupabaseClient<Database>);
      const [first, second] = await Promise.all([
        approveAgentRun(inst.slug, { runId }, principalCtx),
        approveAgentRun(inst.slug, { runId }, principalCtx),
      ]);
      setActingClient(null);
      const outcomes = [first, second];
      const dones = outcomes.filter((r) => r.ok && r.data.status === "done");
      const conflicts = outcomes.filter((r) => !r.ok && r.error.code === "conflict");
      expect(dones).toHaveLength(1);
      expect(conflicts).toHaveLength(1);

      const announcements = await sql`select count(*)::int as n from public.announcements where institution_id = ${inst.institutionId}`;
      expect(announcements[0].n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("user_confirmed run: requesting admin approves -> ok, a different admin -> forbidden", async () => {
    const inst = await createTestInstitution("agent-decide-user-confirmed");
    try {
      const agentId = await insertDefinition(inst.institutionId, "administrative");
      const runId = await insertRun(inst.institutionId, agentId, inst.users.admin.id, {
        riskClass: "user_confirmed",
        proposals: [{ action: "job.requeue", input: { jobId: crypto.randomUUID() }, risk_class: "user_confirmed", status: "proposed", error_code: null }],
      });

      const secondAdmin = await createSecondAdmin(inst);
      try {
        setActingClient(secondAdmin.client);
        const forbidden = await approveAgentRun(inst.slug, { runId }, secondAdmin.ctx);
        expect(forbidden).toMatchObject({ ok: false, error: { code: "forbidden" } });
      } finally {
        setActingClient(null);
        await secondAdmin.cleanup();
      }

      const result = await callAs(inst, "admin", approveAgentRun, { runId });
      expect(result).toMatchObject({ ok: true, data: { status: "done" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("reject with a note: rejected, proposals skipped, then approve -> invalid_state", async () => {
    const inst = await createTestInstitution("agent-decide-reject");
    try {
      const agentId = await insertDefinition(inst.institutionId, "communication");
      const runId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        riskClass: "human_approved",
        proposals: [ANNOUNCEMENT_PROPOSAL],
      });

      const result = await callAs(inst, "principal", rejectAgentRun, { runId, note: "Not a priority right now." });
      expect(result).toMatchObject({ ok: true, data: { status: "rejected" } });

      const [row] = await sql`select status, decision_note, proposals from public.agent_runs where id = ${runId}::uuid`;
      expect(row.status).toBe("rejected");
      expect(row.decision_note).toBe("Not a priority right now.");
      expect(row.proposals).toHaveLength(1);
      expect(row.proposals[0].status).toBe("skipped");

      const announcements = await sql`select count(*)::int as n from public.announcements where institution_id = ${inst.institutionId}`;
      expect(announcements[0].n).toBe(0);

      const again = await callAs(inst, "principal", approveAgentRun, { runId });
      expect(again).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a proposal outside the agent's catalog: skipped/not_allowed, not executed", async () => {
    const inst = await createTestInstitution("agent-decide-outside-catalog");
    try {
      const agentId = await insertDefinition(inst.institutionId, "academic");
      const runId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        riskClass: "human_approved",
        proposals: [{ action: "finance.reminders.send", input: { termId: crypto.randomUUID() }, risk_class: "human_approved", status: "proposed", error_code: null }],
      });

      const result = await callAs(inst, "principal", approveAgentRun, { runId });
      expect(result).toMatchObject({ ok: true, data: { status: "done", executed: 0, failed: 0 } });

      const [row] = await sql`select proposals from public.agent_runs where id = ${runId}::uuid`;
      expect(row.proposals[0].status).toBe("skipped");
      expect(row.proposals[0].error_code).toBe("not_allowed");
    } finally {
      await inst.cleanup();
    }
  });

  it("a disabled agent definition: approve -> invalid_state", async () => {
    const inst = await createTestInstitution("agent-decide-disabled");
    try {
      const agentId = await insertDefinition(inst.institutionId, "finance", false);
      const runId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, { riskClass: "human_approved", proposals: [] });

      const result = await callAs(inst, "principal", approveAgentRun, { runId });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });
});
