import type { SeedContext } from "../lib/context.ts";

// X02-T11 (seed section `certificates`). `app` is not PostgREST-exposed, so
// app.issue_certificate is called over ctx.sql (same pattern as
// finance.ts's app.generate_invoice) — never via direct table writes, so
// the rows (serial allocation, snapshot) come from the same single code
// path production uses. Actor is the demo principal (05 §8.1). No TC (the
// seed has no exited student) and no photos.
export async function run(ctx: SeedContext): Promise<void> {
  const { data: existing } = await ctx.admin
    .from("certificates")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .limit(1)
    .maybeSingle();
  if (existing) return; // idempotent rerun guard

  const principalUserId = ctx.userIdByLogin["principal"]!;
  const aarav = (ctx.studentsBySection["VI-A"] ?? []).find((s) => s.firstName === "Aarav");
  const ananya = (ctx.studentsBySection["X-A"] ?? []).find((s) => s.firstName === "Ananya");
  if (!aarav || !ananya) {
    throw new Error("certificates seed: Aarav Sharma (VI-A) or Ananya Sharma (X-A) not found.");
  }

  await ctx.sql`
    select app.issue_certificate(${principalUserId}::uuid, ${aarav.id}::uuid, 'bonafide', 'Passport application', null)
  `;
  await ctx.sql`
    select app.issue_certificate(${principalUserId}::uuid, ${ananya.id}::uuid, 'bonafide', 'Scholarship application', null)
  `;
  await ctx.sql`
    select app.issue_certificate(${principalUserId}::uuid, ${ananya.id}::uuid, 'character', null, 'Very good')
  `;
}
