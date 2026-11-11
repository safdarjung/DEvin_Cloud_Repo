import "server-only";
// 0140 item 8: a saved study scope as a study-studio source ("Quiz me",
// "Make flashcards", "Summarise" inside a scoped session). The context is
// rebuilt from the database under the student's RLS; nothing client-sent.
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { getScopeSession, resolveScope } from "@/modules/study/scope.queries";
import type { ResolvedSource } from "@/modules/study/sources";

export async function scopeSource(ctx: TenantContext, itemId: string): Promise<ResolvedSource> {
  const session = await getScopeSession(ctx, itemId);
  if (!session) throw new AppError("not_found", "That study session was not found.");
  const { context } = await resolveScope(ctx, session.scope);
  return {
    title: context.title,
    sourceLabel: "a study scope the student chose (book chapters and curriculum units; the AI has NOT read any NCERT book)",
    lines: context.lines,
    gradeLabel: null,
    subjectName: null,
    subjectId: context.subjectIds.length === 1 ? context.subjectIds[0]! : null,
    unitId: context.unitIds.length === 1 ? context.unitIds[0]! : null,
    resourceId: null,
    focusUnitIds: context.unitIds,
  };
}
