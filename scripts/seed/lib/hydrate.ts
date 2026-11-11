import type { SeedContext } from "./context.ts";

/** For `--only` runs: rebuild the context pieces new sections read from the already-seeded demo tenant (no writes, no core re-run). */
export async function hydrateContext(ctx: SeedContext): Promise<void> {
  const [inst] = await ctx.sql<{ id: string }[]>`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!inst) throw new Error("hydrateContext: demo institution not found; run the full seed first.");
  ctx.institutionId = inst.id;
  const [year] = await ctx.sql<{ id: string }[]>`select id from public.academic_years where institution_id = ${inst.id} and is_current`;
  ctx.academicYearId = year!.id;
  const rows = await ctx.sql<{ email: string; user_id: string; link: string | null }[]>`
    select u.email, m.user_id, coalesce(m.staff_id, m.guardian_id, m.student_id) as link
    from public.memberships m join auth.users u on u.id = m.user_id
    where m.institution_id = ${inst.id} and u.email like '%@demo.coolskool.test'`;
  for (const r of rows) {
    const key = r.email.split("@")[0]!;
    ctx.userIdByLogin[key] = r.user_id;
    if (r.link) ctx.linkIdByLogin[key] = r.link;
  }
}
