import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { AuditEventRow } from "@/modules/fabric/types";

export interface AuditListFilters {
  from?: string;
  to?: string;
  action?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditListResult {
  rows: AuditEventRow[];
  total: number;
}

export async function listAuditEvents(
  ctx: TenantContext,
  filters: AuditListFilters,
): Promise<AuditListResult> {
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 50, 100);
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("audit_events")
    .select("id, institution_id, actor_user_id, action, entity_type, entity_id, created_at", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (filters.action) {
    query = query.eq("action", filters.action);
  }

  if (filters.entityType) {
    query = query.eq("entity_type", filters.entityType);
  }

  if (filters.from) {
    query = query.gte("created_at", filters.from);
  }

  if (filters.to) {
    query = query.lte("created_at", filters.to);
  }

  const { data: events, error, count } = await query;
  if (error) throw error;

  // Fetch distinct actor_user_ids and their names from profiles
  const actorIds = [
    ...new Set(
      (events ?? [])
        .map((e) => e.actor_user_id)
        .filter((id) => id !== null) as string[],
    ),
  ];

  const actorNames: Record<string, string | null> = {};
  const actorRoles: Record<string, string | null> = {};

  if (actorIds.length > 0) {
    // Fetch actor names from profiles
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    if (profileError) throw profileError;

    for (const p of profiles ?? []) {
      actorNames[p.id] = p.full_name;
    }

    // Fetch actor roles from memberships
    const { data: memberships, error: membershipError } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("institution_id", ctx.institution.id)
      .in("user_id", actorIds);
    if (membershipError) throw membershipError;

    // For each actor, get their role (just pick the first one if multiple)
    for (const m of memberships ?? []) {
      if (!actorRoles[m.user_id]) {
        actorRoles[m.user_id] = m.role;
      }
    }
  }

  const rows: AuditEventRow[] = (events ?? []).map((e) => {
    const actorUserId = e.actor_user_id ?? null;
    return {
      id: e.id,
      institution_id: e.institution_id,
      actor: actorUserId && actorNames[actorUserId] ? actorNames[actorUserId] : "system",
      actor_role: actorUserId && actorRoles[actorUserId] ? actorRoles[actorUserId] : "system",
      event: e.action,
      entity: e.entity_type,
      entity_id: e.entity_id ?? "",
      at: e.created_at,
      summary: `${e.action} on ${e.entity_type}`,
    };
  });

  return {
    rows,
    total: count ?? 0,
  };
}
