import "server-only";
// M13-T8 — facilities.* reads: the MaintenanceRequest fixture
// (src/modules/fabric/types.ts, maintenanceRequests generator) replacement.
// Permission is maintenance.request for both exports (all 7 staff roles
// hold it — rulings); RLS narrows maintenance_requests to owner/principal/
// admin (all rows) vs every other staff role (own raised_by only), same
// shape as src/modules/timetable/queries.ts's defense-in-depth filters.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { MaintenanceRequest } from "@/modules/fabric/types";

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Institution-local calendar date for a given timestamp (mirrors attendance/queries.ts's todayInInstitutionTimezone, parameterised by instant rather than "now"). */
function dateInInstitutionTimezone(ctx: TenantContext, isoTimestamp: string): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  const timeZone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(isoTimestamp),
  );
}

export interface AssetRow {
  id: string;
  name: string;
  category: string;
  assetTag: string | null;
  room: string | null;
  location: string | null;
  status: string;
}

/** Assets list for the raise-a-request picker and the facilities view. RLS further narrows to the 7 staff roles (rulings). */
export async function facilitiesAssets(
  ctx: TenantContext,
  filter: { roomId?: string; status?: string } = {},
): Promise<AssetRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("assets")
    .select("id, name, category, asset_tag, location, status, rooms(name)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (filter.roomId) query = query.eq("room_id", filter.roomId);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const room = row.rooms as { name: string } | null;
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      assetTag: row.asset_tag,
      room: room?.name ?? null,
      location: row.location,
      status: row.status,
    };
  });
}

/**
 * Maintenance requests — the MaintenanceRequest fixture shape exactly
 * (rulings): asset defaults to "General" when asset-less; location falls
 * back from the request's own location to the asset's room to the asset's
 * free-text location to ""; assignee is the assigned staff member's name,
 * or null when staff RLS hides that row from the caller (never widen staff
 * RLS to fix this — rulings). RLS further narrows rows to owner/principal/
 * admin (all) vs raised_by = caller (every other staff role).
 */
export async function facilitiesMaintenanceRequests(
  ctx: TenantContext,
  filter: { status?: string; limit?: number } = {},
): Promise<MaintenanceRequest[]> {
  const supabase = await createClient();
  let query = supabase
    .from("maintenance_requests")
    .select("id, location, issue, priority, status, raised_at, assets(name, location, rooms(name)), staff(full_name)")
    .eq("institution_id", ctx.institution.id);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.limit) query = query.limit(filter.limit);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  const mapped = rows.map((row) => {
    const asset = row.assets as { name: string; location: string | null; rooms: { name: string } | null } | null;
    const assignee = row.staff as { full_name: string } | null;
    return {
      raisedAtRaw: row.raised_at,
      request: {
        id: row.id,
        asset: asset?.name ?? "General",
        location: row.location ?? asset?.rooms?.name ?? asset?.location ?? "",
        issue: row.issue,
        priority: row.priority as MaintenanceRequest["priority"],
        status: row.status as MaintenanceRequest["status"],
        raised_at: dateInInstitutionTimezone(ctx, row.raised_at),
        assignee: assignee?.full_name ?? null,
      },
    };
  });

  mapped.sort(
    (a, b) =>
      PRIORITY_RANK[b.request.priority] - PRIORITY_RANK[a.request.priority] ||
      new Date(b.raisedAtRaw).getTime() - new Date(a.raisedAtRaw).getTime(),
  );

  return mapped.map((m) => m.request);
}
