import "server-only";
// Dashboard KPI head counts. Signed-in user's RLS client only.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

/** Active students and active staff visible to the caller. */
export async function peopleCounts(ctx: TenantContext): Promise<{ students: number; staff: number }> {
  const supabase = await createClient();
  const [s, t] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("institution_id", ctx.institution.id).eq("status", "active"),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("institution_id", ctx.institution.id).eq("status", "active"),
  ]);
  if (s.error) throw s.error;
  if (t.error) throw t.error;
  return { students: s.count ?? 0, staff: t.count ?? 0 };
}
