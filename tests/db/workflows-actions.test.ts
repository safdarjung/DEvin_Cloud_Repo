import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { saveWorkflow, setWorkflowStatus } from "@/modules/workflows/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M23-T15 — workflow.save / workflow.setStatus (M23-tasks.md rulings
// "Actions"; migration 0096's app.guard_workflow_write drives version
// bumps and status-transition errors).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

// A manual trigger -> end graph: smallest graph parseGraph accepts.
function manualGraph() {
  return {
    nodes: [
      { id: "t", type: "trigger" as const, label: "Start", config: { kind: "manual" } },
      { id: "e", type: "end" as const, label: "End", config: {} },
    ],
    edges: [{ source: "t", target: "e" }],
  };
}

// A 4-node schedule graph: trigger -> condition -> notify -> end (true),
// condition -> end (false). `message` varies to flex the graph-changed path.
function scheduleGraph(message: string) {
  return {
    nodes: [
      { id: "t", type: "trigger" as const, label: "Weekly", config: { kind: "schedule", cron: "0 9 * * 1" } },
      {
        id: "c",
        type: "condition" as const,
        label: "Overdue?",
        config: { metric: "finance.overdue_invoices", op: "gte", value: "1" },
      },
      { id: "n", type: "notify" as const, label: "Notify", config: { audience: "roles", roles: "principal", message } },
      { id: "e", type: "end" as const, label: "End", config: {} },
    ],
    edges: [
      { source: "t", target: "c" },
      { source: "c", target: "n", label: "true" as const },
      { source: "c", target: "e", label: "false" as const },
      { source: "n", target: "e" },
    ],
  };
}

// Same nodes as scheduleGraph, but notify loops back to the condition
// instead of to end — a cycle (c -> n -> c) parseGraph must reject.
function cycleGraph(message: string) {
  const g = scheduleGraph(message);
  return {
    nodes: g.nodes,
    edges: [g.edges[0], g.edges[1], g.edges[2], { source: "n", target: "c" }],
  };
}

// scheduleGraph with the notify node's type swapped to the unsupported
// `tool` type.
function toolNodeGraph(message: string) {
  const g = scheduleGraph(message);
  return {
    nodes: g.nodes.map((n) => (n.id === "n" ? { ...n, type: "tool" as const } : n)),
    edges: g.edges,
  };
}

describe("workflow actions (M23-T15)", () => {
  it("principal saves, edits (version bump) and rejects invalid graphs", async () => {
    const inst = await createTestInstitution("workflow-actions-save");
    try {
      const saved = await callAs(inst, "principal", saveWorkflow, {
        name: "Overdue invoices",
        ...scheduleGraph("{count} invoice(s) overdue."),
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.data.version).toBe(1);
      expect(saved.data.status).toBe("draft");

      const [row] = await sql`select trigger_type, trigger_config from public.workflows where id = ${saved.data.id}::uuid`;
      expect(row.trigger_type).toBe("schedule");
      expect(row.trigger_config).toBe("0 9 * * 1");

      const auditRows = await sql`
        select metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'workflow.saved'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].metadata).toEqual({ id: saved.data.id, version: 1 });

      // Changed graph (different notify message) while draft -> version 2.
      const edited = await callAs(inst, "principal", saveWorkflow, {
        id: saved.data.id,
        name: "Overdue invoices",
        ...scheduleGraph("{count} invoice(s) need a reminder."),
      });
      expect(edited.ok).toBe(true);
      if (!edited.ok) return;
      expect(edited.data.version).toBe(2);

      // Cycle -> validation_failed, fieldErrors.graph, state unchanged.
      const cyclic = await callAs(inst, "principal", saveWorkflow, {
        id: saved.data.id,
        name: "Overdue invoices",
        ...cycleGraph("{count} invoice(s) need a reminder."),
      });
      expect(cyclic.ok).toBe(false);
      if (cyclic.ok) return;
      expect(cyclic.error.code).toBe("validation_failed");
      expect(cyclic.error.fieldErrors?.graph).toBeDefined();

      // `tool` node -> validation_failed.
      const toolNode = await callAs(inst, "principal", saveWorkflow, {
        id: saved.data.id,
        name: "Overdue invoices",
        ...toolNodeGraph("{count} invoice(s) need a reminder."),
      });
      expect(toolNode.ok).toBe(false);
      if (toolNode.ok) return;
      expect(toolNode.error.code).toBe("validation_failed");
      expect(toolNode.error.fieldErrors?.graph).toBeDefined();

      const [stillV2] = await sql`select version from public.workflows where id = ${saved.data.id}::uuid`;
      expect(stillV2.version).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("status transitions: activate sets next_run_at, graph edits lock while active, pause unlocks", async () => {
    const inst = await createTestInstitution("workflow-actions-status");
    try {
      const saved = await callAs(inst, "principal", saveWorkflow, {
        name: "Weekly check",
        ...scheduleGraph("{count} invoice(s) overdue."),
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;

      const activated = await callAs(inst, "principal", setWorkflowStatus, { id: saved.data.id, status: "active" });
      expect(activated.ok).toBe(true);
      if (!activated.ok) return;
      expect(activated.data.status).toBe("active");
      expect(activated.data.nextRunAt).not.toBeNull();

      const statusAudit = await sql`
        select metadata from public.audit_events
        where institution_id = ${inst.institutionId} and action = 'workflow.status'
      `;
      expect(statusAudit).toHaveLength(1);
      expect(statusAudit[0].metadata).toEqual({ id: saved.data.id, from: "draft", to: "active" });

      // Graph edit while active -> invalid_state, friendly message.
      const blockedEdit = await callAs(inst, "principal", saveWorkflow, {
        id: saved.data.id,
        name: "Weekly check",
        ...scheduleGraph("{count} invoice(s) need urgent attention."),
      });
      expect(blockedEdit.ok).toBe(false);
      if (blockedEdit.ok) return;
      expect(blockedEdit.error.code).toBe("invalid_state");
      expect(blockedEdit.error.message).toBe("Pause the workflow to edit it.");

      // Rename-only (same graph) while active -> ok, version unchanged.
      const renamed = await callAs(inst, "principal", saveWorkflow, {
        id: saved.data.id,
        name: "Weekly overdue check",
        ...scheduleGraph("{count} invoice(s) overdue."),
      });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.data.version).toBe(1);

      // Pause -> graph edit now allowed -> version 2 -> activate again.
      const paused = await callAs(inst, "principal", setWorkflowStatus, { id: saved.data.id, status: "paused" });
      expect(paused.ok).toBe(true);
      if (!paused.ok) return;
      expect(paused.data.status).toBe("paused");
      expect(paused.data.nextRunAt).toBeNull();

      const editedWhilePaused = await callAs(inst, "principal", saveWorkflow, {
        id: saved.data.id,
        name: "Weekly overdue check",
        ...scheduleGraph("{count} invoice(s) are still overdue."),
      });
      expect(editedWhilePaused.ok).toBe(true);
      if (!editedWhilePaused.ok) return;
      expect(editedWhilePaused.data.version).toBe(2);

      const reactivated = await callAs(inst, "principal", setWorkflowStatus, { id: saved.data.id, status: "active" });
      expect(reactivated.ok).toBe(true);
      if (!reactivated.ok) return;
      expect(reactivated.data.status).toBe("active");
      expect(reactivated.data.nextRunAt).not.toBeNull();

      // A second, still-draft workflow: draft -> paused is an illegal
      // transition (only active/disabled from draft).
      const draftOnly = await callAs(inst, "principal", saveWorkflow, { name: "Draft only", ...manualGraph() });
      expect(draftOnly.ok).toBe(true);
      if (!draftOnly.ok) return;
      const illegal = await callAs(inst, "principal", setWorkflowStatus, { id: draftOnly.data.id, status: "paused" });
      expect(illegal.ok).toBe(false);
      if (illegal.ok) return;
      expect(illegal.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin/teacher forbidden; module off forbidden; duplicate name conflict; cross-institution not_found", async () => {
    const inst = await createTestInstitution("workflow-actions-forbidden");
    try {
      const asAdmin = await callAs(inst, "admin", saveWorkflow, { name: "Admin probe", ...manualGraph() });
      expect(asAdmin.ok).toBe(false);
      if (asAdmin.ok) return;
      expect(asAdmin.error.code).toBe("forbidden");

      const asTeacher = await callAs(inst, "teacher", saveWorkflow, { name: "Teacher probe", ...manualGraph() });
      expect(asTeacher.ok).toBe(false);
      if (asTeacher.ok) return;
      expect(asTeacher.error.code).toBe("forbidden");

      await setModule(inst.institutionId, "workflows", false);
      const moduleOff = await callAs(inst, "principal", saveWorkflow, { name: "Module off probe", ...manualGraph() });
      expect(moduleOff.ok).toBe(false);
      if (moduleOff.ok) return;
      expect(moduleOff.error.code).toBe("forbidden");
      expect(moduleOff.error.message).toBe("Module not enabled for this school.");
      await setModule(inst.institutionId, "workflows", true);

      const first = await callAs(inst, "principal", saveWorkflow, { name: "Dup name", ...manualGraph() });
      expect(first.ok).toBe(true);

      const dup = await callAs(inst, "principal", saveWorkflow, { name: "Dup name", ...manualGraph() });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("conflict");
      expect(dup.error.fieldErrors?.name).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("updating by another institution's workflow id is not_found", async () => {
    await withTwoInstitutions(async (a, b) => {
      const createdInB = await callAs(b, "principal", saveWorkflow, { name: "B's workflow", ...manualGraph() });
      expect(createdInB.ok).toBe(true);
      if (!createdInB.ok) return;

      const crossInstitutionUpdate = await callAs(a, "principal", saveWorkflow, {
        id: createdInB.data.id,
        name: "Hijacked name",
        ...manualGraph(),
      });
      expect(crossInstitutionUpdate.ok).toBe(false);
      if (crossInstitutionUpdate.ok) return;
      expect(crossInstitutionUpdate.error.code).toBe("not_found");

      const crossInstitutionStatus = await callAs(a, "principal", setWorkflowStatus, {
        id: createdInB.data.id,
        status: "active",
      });
      expect(crossInstitutionStatus.ok).toBe(false);
      if (crossInstitutionStatus.ok) return;
      expect(crossInstitutionStatus.error.code).toBe("not_found");
    });
  });
});
