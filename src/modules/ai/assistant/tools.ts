import "server-only";
// M24-T5 — the assistant's tool set. Read tools are M22's scoped registry
// queries (run as the caller; each re-checks module, Zod and permission);
// `navigate` only returns an in-app link from the caller's own nav; and
// `createTask` only validates a draft for a person to review and save
// (CLAUDE.md rule 6, D43). Nothing here writes or calls an action.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getActionMeta } from "@/lib/actions/registry";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { navItemsFor } from "@/lib/nav";
import { uuid } from "@/lib/schemas/common";
import { RecordInsightActionSchema } from "@/modules/insights/schemas";
import { buildReadTools } from "@/modules/agents/tools";
import { createSourceLog, queriesFor, type AssistantProvider, type SourceLog } from "./catalog";

const TASK_ACTION = "insight.action";

const TaskDraftInput = z
  .object({
    insightId: uuid,
    action: z.string().min(1).max(200),
    owner: z.string().min(1).max(80),
    rationale: z.string().min(1).max(500),
    expectedOutcome: z.string().min(1).max(300),
  })
  .strict();

function navigateTool(ctx: TenantContext) {
  const items = navItemsFor(ctx.permissions, ctx.institution.settings).filter((i) => i.group !== "Fabric");
  if (items.length === 0) return null;
  const hrefs = items.map((i) => i.href) as [string, ...string[]];
  return tool({
    description: `Give the person a link to a page in this app. Pages: ${items.map((i) => `${i.label} (${i.href})`).join(", ")}.`,
    inputSchema: z.object({ href: z.enum(hrefs) }),
    execute: async ({ href }) => {
      const item = items.find((i) => i.href === href)!;
      return { href: `/${ctx.institution.slug}${item.href}`, label: item.label };
    },
  });
}

async function createTaskTool(ctx: TenantContext) {
  await import("@/app/api/v1/actions/all-actions");
  const meta = getActionMeta().get(TASK_ACTION);
  if (!meta || typeof meta.permission !== "string") return null;
  if (!hasPermission(ctx, meta.permission) || !meta.module || !isModuleEnabled(ctx, meta.module)) return null;
  return tool({
    description:
      "Draft a follow-up task for an insight. Nothing is saved: the person reviews the draft and presses Save.",
    inputSchema: TaskDraftInput,
    execute: async (input) => {
      const parsed = RecordInsightActionSchema.safeParse({ ...input, status: "planned" });
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "input")))];
        return `Task draft invalid: ${fields.join(", ")}`;
      }
      return {
        kind: "task_draft" as const,
        action: TASK_ACTION,
        input: parsed.data,
        note: "Draft only. Review it and press Save to record it.",
      };
    },
  });
}

export async function buildAssistantTools(
  ctx: TenantContext,
  provider: AssistantProvider,
  nonce: string,
): Promise<{ tools: ToolSet; sources: SourceLog }> {
  const sources = createSourceLog();
  const { tools: readTools } = await buildReadTools(ctx, queriesFor(provider), nonce, sources.add);
  const tools: ToolSet = { ...readTools };
  const navigate = navigateTool(ctx);
  if (navigate) tools.navigate = navigate;
  const createTask = await createTaskTool(ctx);
  if (createTask) tools.createTask = createTask;
  return { tools, sources };
}
