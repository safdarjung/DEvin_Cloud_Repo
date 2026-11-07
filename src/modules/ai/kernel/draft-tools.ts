import "server-only";
// P1 (ai-roles phase 3) — a capability's `drafts` action names become chat
// tools named `draft_<action with . -> _>`. Reuses describeInput/getActionMeta
// /hasPermission/isModuleEnabled — the same permission+module gate as
// buildReadTools (src/modules/agents/tools.ts) — instead of copying it.
// Rule 6 everywhere: the tool only ever returns a draft for a person to
// review and save; it never calls the action (CLAUDE.md, phase3-tasks.md).
import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import { getActionMeta, getRegisteredActions } from "@/lib/actions/registry";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import type { TenantContext } from "@/lib/auth/types";
import { describeInput, toolNameFor } from "@/modules/agents/tools";
import { DRAFTABLE_ACTIONS } from "@/modules/ai/capabilities/catalog";

// Decoupled from the real CapabilityKey/CAPABILITIES union so a unit test
// can pass a fixture capability without adding it to the catalog.
export interface DraftableCapability {
  readonly description: string;
  readonly drafts?: readonly string[];
}

async function loadManifests(): Promise<void> {
  await import("@/app/api/v1/actions/all-actions");
}

function draftTool(action: string, summary: string, schema: z.ZodType) {
  return tool({
    description: `Draft (never saved): ${summary}. The person reviews and saves it themselves.`,
    inputSchema: describeInput(schema),
    execute: async (input: unknown): Promise<string | { kind: "action_draft"; action: string; input: unknown; summary: string }> => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) return `Invalid input: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`;
      return { kind: "action_draft", action, input: parsed.data, summary };
    },
  });
}

export async function buildDraftTools(ctx: TenantContext, capabilities: readonly DraftableCapability[]): Promise<ToolSet> {
  await loadManifests();
  const tools: ToolSet = {};

  for (const cap of capabilities) {
    for (const action of cap.drafts ?? []) {
      if (!DRAFTABLE_ACTIONS.includes(action) || !getRegisteredActions().has(action)) continue;
      const meta = getActionMeta().get(action);
      if (!meta || typeof meta.permission !== "string") continue;
      if (!hasPermission(ctx, meta.permission)) continue;
      if (meta.module !== undefined && !isModuleEnabled(ctx, meta.module)) continue;
      tools[`draft_${toolNameFor(action)}`] = draftTool(action, cap.description, meta.schema);
    }
  }

  return tools;
}
