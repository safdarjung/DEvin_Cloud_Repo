import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { parseGraph, triggerColumns } from "../../../src/modules/workflows/graph.ts";
import { WORKFLOW_TEMPLATES } from "../../../src/modules/workflows/templates.ts";

// M23-T20 (M23-tasks.md Task 20) — the 5 templates (T9), seeded as `active`
// workflows of the demo tenant. Inserted through the service-role admin
// client, which the write guard (0096) treats as trusted (lesson 5: JWT
// claim role = service_role), so `active` is accepted directly and the
// guard itself computes `next_run_at` for the 4 schedule templates. No
// runs, no jobs — the runner/acceptance tasks (T13/T21) exercise those.

export async function run(ctx: SeedContext): Promise<void> {
  const createdBy = ctx.userIdByLogin["principal"]!;

  const rows = WORKFLOW_TEMPLATES.map((template) => {
    const parsed = parseGraph({ nodes: template.nodes, edges: template.edges });
    if (!parsed.ok) {
      throw new Error(`workflows: template ${template.key} failed parseGraph: ${parsed.errors.join("; ")}`);
    }
    const { trigger_type, trigger_config } = triggerColumns(parsed.graph);
    return {
      id: uuidV5("workflows", `workflow:${template.key}`),
      institution_id: ctx.institutionId,
      name: template.name,
      version: 1,
      status: "active",
      trigger_type,
      trigger_config,
      nodes: template.nodes,
      edges: template.edges,
      created_by: createdBy,
    };
  });

  await insertBatch(ctx.admin, "workflows", rows);
}
