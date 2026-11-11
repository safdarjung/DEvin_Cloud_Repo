import "server-only";
// The signed-in user's saved home-dashboard layout (own row, RLS). The column
// is user-writable over PostgREST, so it is re-validated here; anything that
// does not parse falls back to the default layout.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { DashboardLayoutSchema, type DashboardLayoutInput } from "@/modules/core/schemas";

export async function getDashboardLayout(ctx: TenantContext): Promise<DashboardLayoutInput | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboard_preferences")
    .select("layout")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  const parsed = DashboardLayoutSchema.safeParse(data?.layout);
  return parsed.success ? parsed.data : null;
}
