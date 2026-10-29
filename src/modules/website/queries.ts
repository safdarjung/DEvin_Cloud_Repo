import "server-only";
// T-024 — public site reads (04 §6, 05 §2.8, 06 §W3). Anon client only: the
// renderer never sends a session cookie and never uses the service role.
// RLS class P (05 §5) is the sole access boundary — every query here relies
// on it to keep drafts and offline sites invisible (T5, C-80), never on an
// extra application-level check.
//
// Phase 2 (lead ruling, DBT-11): `public.institutions` must NOT get an anon
// SELECT policy — it would expose `settings`/`ai_policy` to every visitor,
// not just the slug/name the renderer needs. `getPublicSite` below instead
// calls `public.get_public_site(p_slug)` (`20261028000015`), a narrow
// `security definer` RPC granted to `anon` that returns only
// institution_id/name/website_id/theme/nav, one row, only when the website
// is live — zero rows for an unknown or offline slug, same shape as the
// anon RLS predicates on pages/notices/events.
import { cache } from "react";
import { createAnonClient } from "@/lib/supabase/server";
import { parseBlocksSafely, type Block } from "./blocks";

export interface PublicSite {
  institutionId: string;
  institutionName: string;
  nav: unknown;
  theme: unknown;
}

export interface PublicPage {
  id: string;
  slug: string;
  title: string;
  blocks: Block[];
}

export interface PublicNotice {
  id: string;
  title: string;
  body: string;
  publishAt: string;
}

export interface PublicEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
}

/**
 * Resolves a live site by its institution slug. `null` for unknown slug or
 * an offline site — the route/page maps both to a 404 (06 §W3: "unknown or
 * offline slug → not_found") without distinguishing them to the visitor.
 * `cache()`d (04 §4 pattern) so the layout and page don't double-query it
 * for the same request.
 */
export const getPublicSite = cache(async function getPublicSite(slug: string): Promise<PublicSite | null> {
  const supabase = createAnonClient();

  const { data, error } = await supabase.rpc("get_public_site", { p_slug: slug }).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    institutionId: data.institution_id,
    institutionName: data.institution_name,
    nav: data.nav,
    theme: data.theme,
  };
});

/** `path` is the page's slug (`"home"` for `/`), never the URL's leading slash. Returns `null` when the page doesn't exist or has no published version (RLS already hides drafts; this is just "nothing to render"). */
export async function getPublicPage(institutionId: string, path: string): Promise<PublicPage | null> {
  const supabase = createAnonClient();

  const { data: page } = await supabase
    .from("pages")
    .select("id, slug, title, published_version_id")
    .eq("institution_id", institutionId)
    .eq("slug", path)
    .not("published_version_id", "is", null)
    .maybeSingle();
  if (!page || !page.published_version_id) return null;

  const { data: version } = await supabase
    .from("page_versions")
    .select("blocks")
    .eq("id", page.published_version_id)
    .maybeSingle();
  if (!version) return null;

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    blocks: parseBlocksSafely(version.blocks),
  };
}

export async function listPublicNotices(institutionId: string, limit = 5): Promise<PublicNotice[]> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("notices")
    .select("id, title, body, publish_at")
    .eq("institution_id", institutionId)
    .eq("is_public", true)
    .lte("publish_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("publish_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    publishAt: row.publish_at,
  }));
}

export async function listPublicEvents(institutionId: string, limit = 4): Promise<PublicEvent[]> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, ends_at, location")
    .eq("institution_id", institutionId)
    .eq("is_public", true)
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
  }));
}
