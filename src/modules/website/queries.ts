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
import { createAnonClient, createClient } from "@/lib/supabase/server";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { parseBlocksSafely, type Block } from "./blocks";
import { parseThemeSafely, type WebsiteTheme } from "./theme";

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

// ---------------------------------------------------------------------------
// T-025 — tenant editor reads (member client, RLS class P). Every row is
// scoped to `ctx.institution.id`; the member-SELECT policies (0010) already
// restrict to the caller's own institution, this just keeps the query
// itself narrow (rule 1) rather than relying on RLS alone to filter.
// ---------------------------------------------------------------------------

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  publishedVersionId: string | null;
  updatedAt: string;
}

export async function listPages(ctx: TenantContext): Promise<PageSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pages")
    .select("id, slug, title, published_version_id, updated_at")
    .eq("institution_id", ctx.institution.id)
    .order("slug");
  if (error) throwMapped(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    publishedVersionId: row.published_version_id,
    updatedAt: row.updated_at,
  }));
}

export interface VersionSummary {
  id: string;
  versionNo: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface PageWithVersions {
  id: string;
  slug: string;
  title: string;
  publishedVersionId: string | null;
  versions: VersionSummary[];
}

/** `null` when the page doesn't exist or belongs to a different institution — RLS would already hide it, this just gives the page.tsx a clean not_found instead of a thrown error. */
export async function getPageWithVersions(ctx: TenantContext, pageId: string): Promise<PageWithVersions | null> {
  const supabase = await createClient();
  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id, slug, title, published_version_id")
    .eq("id", pageId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (pageError) throwMapped(pageError);
  if (!page) return null;

  const { data: versions, error: versionsError } = await supabase
    .from("page_versions")
    .select("id, version_no, published_at, created_at")
    .eq("page_id", pageId)
    .eq("institution_id", ctx.institution.id)
    .order("version_no", { ascending: false });
  if (versionsError) throwMapped(versionsError);

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    publishedVersionId: page.published_version_id,
    versions: (versions ?? []).map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      publishedAt: v.published_at,
      createdAt: v.created_at,
    })),
  };
}

export interface VersionDetail {
  id: string;
  pageId: string;
  versionNo: number;
  blocks: Block[];
  publishedAt: string | null;
}

/** `null` when the version doesn't exist, isn't this page's, or isn't this institution's. */
export async function getVersion(ctx: TenantContext, pageId: string, versionId: string): Promise<VersionDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("page_versions")
    .select("id, page_id, version_no, blocks, published_at")
    .eq("id", versionId)
    .eq("page_id", pageId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) return null;

  return {
    id: data.id,
    pageId: data.page_id,
    versionNo: data.version_no,
    blocks: parseBlocksSafely(data.blocks),
    publishedAt: data.published_at,
  };
}

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  expiresAt: string | null;
  isPublic: boolean;
  audience: unknown;
}

/** Every notice for the institution, draft or public — the editor needs to see what isn't live yet (packet, unlike listPublicNotices). */
export async function listNotices(ctx: TenantContext): Promise<NoticeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notices")
    .select("id, title, body, publish_at, expires_at, is_public, audience")
    .eq("institution_id", ctx.institution.id)
    .order("publish_at", { ascending: false });
  if (error) throwMapped(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    publishAt: row.publish_at,
    expiresAt: row.expires_at,
    isPublic: row.is_public,
    audience: row.audience,
  }));
}

export interface EventRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  isPublic: boolean;
}

export async function listEvents(ctx: TenantContext): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, ends_at, location, is_public")
    .eq("institution_id", ctx.institution.id)
    .order("starts_at", { ascending: true });
  if (error) throwMapped(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    isPublic: row.is_public,
  }));
}

export interface WebsiteSummary {
  id: string;
  isLive: boolean;
  theme: WebsiteTheme;
}

/** `null` when no website row exists yet for this institution (fresh test fixture; demo/seeded institutions always have one). */
export async function getWebsite(ctx: TenantContext): Promise<WebsiteSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("websites")
    .select("id, is_live, theme")
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) return null;
  return { id: data.id, isLive: data.is_live, theme: parseThemeSafely(data.theme) };
}
