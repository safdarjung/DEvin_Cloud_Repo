"use server";

// M25-T5 — briefing.generate action (M25-tasks.md rulings "Permission",
// "Audit", "ErrorCode map"). Thin wrapper over the T4 service
// (briefings.ts): permission + module gate here, the write (once per day)
// and role mapping stay in ensureBriefing. Style mirrors
// src/modules/insights/explain.actions.ts (service `fail` -> thrown
// AppError).
import { defineAction } from "@/lib/actions/define-action";
import { AppError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { z } from "zod";
import { ensureBriefing } from "@/modules/insights/briefings";

export const generateBriefing = defineAction({
  name: "briefing.generate",
  module: "ai_briefings",
  schema: z.object({}).strict(),
  permission: "insight.read",
  handler: async (_input, ctx) => {
    const result = await ensureBriefing(ctx);
    if (!result.ok) {
      throw new AppError(result.error.code, result.error.message, result.error.fieldErrors);
    }

    if (result.data.created) {
      // No item text (rulings "Audit") — counts only.
      await audit(ctx, {
        action: "briefing.generate",
        entityType: "briefing",
        entityId: result.data.id,
        after: {
          role: result.data.brief.role,
          date: result.data.brief.date,
          items: result.data.brief.items.length,
          sources: result.data.brief.sources?.length ?? 0,
        },
      });
    }

    return result.data.brief;
  },
});
