import "server-only";
// AI workflow drafter — a workflow draft from a plain-language description
// (and, for "refine", the editor's current draft), restricted to the
// workflow catalog, the school's own sections and its agents, and validated
// whole by toWorkflowDraft. Invalid output is one clean `ai_invalid_output`,
// never a partial workflow. Persists nothing (rule 6): the editor shows the
// draft; saving stays workflow.save and turning it on workflow.setStatus.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { workflowAgentOptions } from "@/modules/agents/queries";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { buildWorkflowDraftPrompt, WORKFLOW_DRAFT_INSTRUCTIONS } from "@/modules/ai/prompts/workflow-drafts";
import { toWorkflowDraft, workflowDraftGenerationSchema, WorkflowDraftRequestSchema } from "@/modules/ai/workflow-drafts";
import { getTodaySectionsForTeacher } from "@/modules/attendance/queries";
import { isModuleEnabled } from "@/lib/modules/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Up to 8 short steps (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 2048;

export const POST = aiTaskRoute({
  route: "workflow-draft",
  schema: WorkflowDraftRequestSchema,
  // A refine request carries the current draft (at most 30 short steps).
  maxBodyBytes: 32 * 1024,
  permission: "workflow.manage",
  capability: "workflow_draft",
  run: async (ctx, input) => {
    // Owner-module reads under the caller's RLS; agent steps only while the agents module is on.
    const [sections, agents] = await Promise.all([
      getTodaySectionsForTeacher(ctx),
      isModuleEnabled(ctx, "agents") ? workflowAgentOptions(ctx) : Promise.resolve([]),
    ]);
    const options = { sections: sections.map((s) => ({ id: s.id, label: s.label })), agents };

    const generated = await runStructured({
      ctx,
      feature: "workflow_draft",
      schema: workflowDraftGenerationSchema(options),
      instructions: WORKFLOW_DRAFT_INSTRUCTIONS,
      prompt: buildWorkflowDraftPrompt({ description: input.description, sections: options.sections, agents, currentDraft: input.currentDraft }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const draft = toWorkflowDraft(generated.data.data, options);
    if (!draft.ok) return fail("ai_invalid_output", "The AI draft did not fit the workflow rules. Try describing it more clearly.");

    const { provider, model, fallback } = generated.data;
    return ok({ name: draft.name, form: draft.form, provider, model, fallback });
  },
});
