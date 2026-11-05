import "server-only";
// M25-T4 — briefing service: role mapping, local "today", source fan-out
// (role-uniform, caller's own RLS) + compose (T2), and the one write path
// through the `briefings` service-role caller (briefings.service-role.ts).
// Callers (actions/queries/route) check permission and module first; these
// functions never do (rulings "Writes").
import { getRegisteredQueries } from "@/lib/actions/define-query";
import { fail, mapSqlError, ok, type ActionResult } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/db/types";
import { institutionTimeZone, localParts } from "@/modules/exams/schedule-conflicts";
import type { BriefingSource, DailyBrief } from "@/modules/fabric/types";
import {
  BRIEF_ROLE,
  briefingSources,
  composeBriefing,
  type BriefRole,
  type BriefingSourceResult,
} from "./briefing-compose";
import { briefingsAdmin } from "./briefings.service-role";

type BriefingRow = Database["public"]["Tables"]["briefings"]["Row"];
type Admin = ReturnType<typeof briefingsAdmin>;

export function briefRoleFor(ctx: TenantContext): BriefRole | null {
  return BRIEF_ROLE[ctx.membership.role] ?? null;
}

/** Institution-local today (M11 localParts/institutionTimeZone — never a new tz helper). */
export function localToday(ctx: TenantContext): { date: string; weekday: number } {
  const { date, weekday } = localParts(new Date().toISOString(), institutionTimeZone(ctx.institution.settings));
  return { date, weekday };
}

// Dynamic, not static (M22-T5 pattern): avoids a static import cycle with
// the query manifest, and matches how agents/tools.ts loads it.
async function loadQueryManifest(): Promise<void> {
  await import("@/app/api/v1/query/all-queries");
}

/**
 * Runs this role's recipe as the caller (each source keeps its own module/
 * Zod/permission gate — rulings "Recipes") and composes the brief. Writes
 * nothing. A source missing from the registry, failing or throwing is
 * skipped and not cited; no source succeeding is `dependency_failed`.
 */
export async function buildBriefing(
  ctx: TenantContext,
): Promise<
  ActionResult<{ role: BriefRole; date: string; headline: string; items: DailyBrief["items"]; sources: BriefingSource[] }>
> {
  const role = briefRoleFor(ctx);
  if (!role) return fail("forbidden", "No briefing for this role.");

  const { date, weekday } = localToday(ctx);
  const sources = briefingSources(role, date, weekday);

  await loadQueryManifest();
  const registry = getRegisteredQueries();

  const attempted = await Promise.all(
    sources.map(async (source): Promise<BriefingSourceResult | null> => {
      const query = registry.get(source.query);
      if (!query) return null;
      try {
        const result = (await query(ctx.institution.slug, source.params)) as ActionResult<unknown>;
        return result.ok ? { ...source, data: result.data } : null;
      } catch {
        const correlationId = crypto.randomUUID();
        console.error(`[${correlationId}] briefing source ${source.query} failed`);
        return null;
      }
    }),
  );

  const results = attempted.filter((r): r is BriefingSourceResult => r !== null);
  if (results.length === 0) return fail("dependency_failed", "Briefing sources are unavailable right now.");

  const composed = composeBriefing({ role, slug: ctx.institution.slug, today: date, weekday, results });
  return ok({ role, date, headline: composed.headline, items: composed.items, sources: composed.sources });
}

async function selectBriefing(
  admin: Admin,
  institutionId: string,
  role: BriefRole,
  date: string,
): Promise<{ data: BriefingRow | null; error: { message: string } | null }> {
  return admin
    .from("briefings")
    .select("*")
    .eq("institution_id", institutionId)
    .eq("role", role)
    .eq("brief_date", date)
    .maybeSingle();
}

export function toDailyBrief(row: BriefingRow): DailyBrief {
  return {
    role: row.role,
    date: row.brief_date,
    headline: row.headline,
    items: row.items as unknown as DailyBrief["items"],
    sources: row.sources as unknown as BriefingSource[],
    generated_by: row.provider === "local" ? "local_model" : row.provider === "cloud" ? "cloud_model" : "rules",
  };
}

/**
 * The day's first generation is the brief — no refresh (rulings "Frozen").
 * Existing row → it; else `buildBriefing` → upsert (ignoreDuplicates, so
 * concurrent first readers get one row) → read back by the unique key
 * (lesson 11: ignoreDuplicates returns no row on the losing side).
 */
export async function ensureBriefing(
  ctx: TenantContext,
): Promise<ActionResult<{ id: string; created: boolean; provider: "local" | "cloud" | null; brief: DailyBrief }>> {
  const role = briefRoleFor(ctx);
  if (!role) return fail("forbidden", "No briefing for this role.");

  const { date } = localToday(ctx);
  const admin = briefingsAdmin();

  const existing = await selectBriefing(admin, ctx.institution.id, role, date);
  if (existing.error) return mapSqlError(existing.error);
  if (existing.data) {
    return ok({
      id: existing.data.id,
      created: false,
      provider: existing.data.provider as "local" | "cloud" | null,
      brief: toDailyBrief(existing.data),
    });
  }

  const built = await buildBriefing(ctx);
  if (!built.ok) return built;

  const { error: upsertError } = await admin.from("briefings").upsert(
    {
      institution_id: ctx.institution.id,
      role: built.data.role,
      brief_date: built.data.date,
      headline: built.data.headline,
      items: built.data.items as unknown as NonNullable<Json>,
      sources: built.data.sources as unknown as NonNullable<Json>,
    },
    { onConflict: "institution_id,role,brief_date", ignoreDuplicates: true },
  );
  if (upsertError) return mapSqlError(upsertError);

  const row = await selectBriefing(admin, ctx.institution.id, role, date);
  if (row.error) return mapSqlError(row.error);
  if (!row.data) return fail("internal", "Failed to read back the briefing.");

  return ok({
    id: row.data.id,
    created: true,
    provider: row.data.provider as "local" | "cloud" | null,
    brief: toDailyBrief(row.data),
  });
}

/** Reads with the caller's own client — RLS is the access boundary. */
export async function readBriefing(ctx: TenantContext): Promise<DailyBrief | null> {
  const role = briefRoleFor(ctx);
  if (!role) return null;
  const { date } = localToday(ctx);
  const supabase = await createClient();
  const { data } = await supabase
    .from("briefings")
    .select("*")
    .eq("institution_id", ctx.institution.id)
    .eq("role", role)
    .eq("brief_date", date)
    .maybeSingle();
  return data ? toDailyBrief(data) : null;
}

/**
 * Narration (rulings "Headline"): `provider` starts null; this fills it
 * once. 0 rows updated means another narrator already won — the caller
 * (the route) re-reads and uses that row instead.
 */
export async function setBriefingHeadline(id: string, headline: string, provider: "local" | "cloud"): Promise<boolean> {
  const admin = briefingsAdmin();
  const { data, error } = await admin
    .from("briefings")
    .update({ headline, provider })
    .eq("id", id)
    .is("provider", null)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
