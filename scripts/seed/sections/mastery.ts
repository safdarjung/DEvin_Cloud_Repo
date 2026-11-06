import type { SeedContext } from "../lib/context.ts";

// M20-T13 — computes mastery_snapshots for the demo tenant once exams.ts has
// written HY-2026's published marks and PT2-X's unit-mapped (unpublished)
// papers. `compute_mastery` is security invoker, service_role-only
// (0093 part 2); ctx.admin is the service-role client every seed section
// already uses.
export async function run(ctx: SeedContext): Promise<void> {
  // Direct SQL, not ctx.admin.rpc: a full-tenant compute (3k students) can outlast the PostgREST
  // statement_timeout under load and leave the demo tenant half-seeded. Lifted for this transaction only.
  await ctx.sql.begin(async (tx) => {
    await tx`set local statement_timeout = 0`;
    await tx`select public.compute_mastery(${ctx.institutionId}::uuid)`;
  });
}
