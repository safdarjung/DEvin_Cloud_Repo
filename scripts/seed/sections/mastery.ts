import type { SeedContext } from "../lib/context.ts";

// M20-T13 — computes mastery_snapshots for the demo tenant once exams.ts has
// written HY-2026's published marks and PT2-X's unit-mapped (unpublished)
// papers. `compute_mastery` is security invoker, service_role-only
// (0093 part 2); ctx.admin is the service-role client every seed section
// already uses.
export async function run(ctx: SeedContext): Promise<void> {
  const { error } = await ctx.admin.rpc("compute_mastery", { p_institution_id: ctx.institutionId });
  if (error) throw new Error(`mastery: compute_mastery failed: ${error.message}`);
}
