"use server";

// T-025 — website editor actions (06 §W3, 07 §2.2 website.edit/website.publish).
// `savePageVersion` only ever inserts a new `page_versions` row (v+1) —
// 0010's trigger blocks every UPDATE/DELETE outside `app.publish_page`
// anyway, this just keeps the intent explicit. `publishPage` is a thin
// wrapper over `public.publish_page` (0010); the audit row for a publish
// is written inside that function, not duplicated here.
import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import {
  CreatePageSchema,
  PublishPageSchema,
  SavePageVersionSchema,
  SaveWebsiteThemeSchema,
  SetWebsiteLiveSchema,
  UpsertEventSchema,
  UpsertNoticeSchema,
  type CreatePageInput,
  type PublishPageInput,
  type SavePageVersionInput,
  type SaveWebsiteThemeInput,
  type SetWebsiteLiveInput,
  type UpsertEventInput,
  type UpsertNoticeInput,
} from "./schemas";

type WebsiteClient = Awaited<ReturnType<typeof createClient>>;

const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

/** Verifies `pageId` belongs to `ctx.institution` before any write touches it (rule 2). Throws `not_found` otherwise. */
async function loadPageScoped(
  supabase: WebsiteClient,
  ctx: TenantContext,
  pageId: string,
): Promise<{ id: string; websiteId: string; publishedVersionId: string | null }> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, website_id, published_version_id")
    .eq("id", pageId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Page not found.");
  return { id: data.id, websiteId: data.website_id, publishedVersionId: data.published_version_id };
}

/** Finds this institution's one website row, creating it (offline by default) if a prior packet's seed/flow never did. */
async function getOrCreateWebsite(supabase: WebsiteClient, ctx: TenantContext): Promise<{ id: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("websites")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (selectError) throwMapped(selectError);
  if (existing) return { id: existing.id };

  const { data: created, error: insertError } = await supabase
    .from("websites")
    .insert({ institution_id: ctx.institution.id, is_live: false })
    .select("id")
    .single();
  if (insertError) {
    // Lost the race against a concurrent createPage for the same
    // institution — the `unique (institution_id)` constraint (0010) means
    // the other caller's row now exists; use it instead of failing.
    if (isUniqueViolation(insertError)) {
      const { data: raceWinner, error: refetchError } = await supabase
        .from("websites")
        .select("id")
        .eq("institution_id", ctx.institution.id)
        .single();
      if (refetchError) throwMapped(refetchError);
      return { id: raceWinner.id };
    }
    throwMapped(insertError);
  }
  return { id: created.id };
}

export const createPage = defineAction({
  name: "website.page.create",
  schema: CreatePageSchema,
  module: "website",
  permission: "website.edit",
  handler: async (input: CreatePageInput, ctx) => {
    const supabase = await createClient();
    const website = await getOrCreateWebsite(supabase, ctx);

    const { data, error } = await supabase
      .from("pages")
      .insert({
        institution_id: ctx.institution.id,
        website_id: website.id,
        slug: input.slug,
        title: input.title,
      })
      .select("id, slug, title")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A page with this slug already exists.", { slug: ["Slug already in use."] });
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "website.page.created", entityType: "page", entityId: data.id, after: { slug: data.slug } });
    revalidatePath(`/${ctx.institution.slug}/website`);
    return { id: data.id, slug: data.slug, title: data.title };
  },
});

export const savePageVersion = defineAction({
  name: "website.page.save_version",
  schema: SavePageVersionSchema,
  module: "website",
  permission: "website.edit",
  handler: async (input: SavePageVersionInput, ctx) => {
    const supabase = await createClient();
    await loadPageScoped(supabase, ctx, input.pageId);

    // Up to one retry on a version_no race (unique (page_id, version_no),
    // 0010): two concurrent saves must not collide into the same number or
    // silently overwrite one another — the loser recomputes v+1 and
    // retries once; a second collision is reported as `conflict` rather
    // than retried forever.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data: latest, error: latestError } = await supabase
        .from("page_versions")
        .select("version_no")
        .eq("page_id", input.pageId)
        .eq("institution_id", ctx.institution.id)
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throwMapped(latestError);

      const nextVersionNo = (latest?.version_no ?? 0) + 1;

      const { data, error } = await supabase
        .from("page_versions")
        .insert({
          institution_id: ctx.institution.id,
          page_id: input.pageId,
          version_no: nextVersionNo,
          blocks: input.blocks,
          created_by: ctx.user.id,
        })
        .select("id, version_no")
        .single();

      if (!error) {
        await audit(ctx, {
          action: "website.page.version_saved",
          entityType: "page_version",
          entityId: data.id,
          metadata: { pageId: input.pageId, versionNo: data.version_no },
        });
        revalidatePath(`/${ctx.institution.slug}/website/pages/${input.pageId}`);
        return { id: data.id, versionNo: data.version_no };
      }

      if (!isUniqueViolation(error) || attempt === 1) {
        if (isUniqueViolation(error)) {
          throw new AppError("conflict", "Another save landed first; reload and try again.");
        }
        throwMapped(error);
      }
    }
    // Unreachable (the loop above always returns or throws), but keeps the
    // handler's return type total for the compiler.
    throw new AppError("internal", "Unexpected error.");
  },
});

export const publishPage = defineAction({
  name: "website.page.publish",
  schema: PublishPageSchema,
  module: "website",
  permission: "website.publish",
  handler: async (input: PublishPageInput, ctx) => {
    const supabase = await createClient();
    await loadPageScoped(supabase, ctx, input.pageId);

    const { data, error } = await supabase.rpc("publish_page", {
      p_page_id: input.pageId,
      p_version_id: input.versionId,
    });
    if (error) throwMapped(error);

    revalidatePath(`/${ctx.institution.slug}/website/pages/${input.pageId}`);
    // Fix round 2 (e2e, T-027): the public route is `/s/[slug]/[[...path]]`
    // (layout.tsx at `/s/[slug]`). A literal `revalidatePath` without
    // `"layout"` only invalidates the exact matched path — i.e. just the
    // home page (`path: []`) — never any other page's cache entry
    // (`/s/{slug}/{otherSlug}`). `"layout"` cascades to every page nested
    // under that layout, so publishing any page actually takes effect.
    revalidatePath(`/s/${ctx.institution.slug}`, "layout");
    return { id: data.id, publishedVersionId: data.published_version_id };
  },
});

export const setWebsiteLive = defineAction({
  name: "website.live_set",
  schema: SetWebsiteLiveSchema,
  module: "website",
  permission: "website.publish",
  handler: async (input: SetWebsiteLiveInput, ctx) => {
    const supabase = await createClient();
    const website = await getOrCreateWebsite(supabase, ctx);

    // Direct RLS update (0010 `websites_update`), not a security-definer
    // RPC: that policy's role list (owner/principal/admin/admissions) is
    // wider than the `website.publish` matrix row (admissions excluded) —
    // flagged in the completion report; `defineAction`'s permission check
    // above is what actually keeps admissions out of this action.
    const { data, error } = await supabase
      .from("websites")
      .update({ is_live: input.isLive })
      .eq("id", website.id)
      .eq("institution_id", ctx.institution.id)
      .select("id, is_live")
      .single();
    if (error) throwMapped(error);

    await audit(ctx, {
      action: "website.live_set",
      entityType: "website",
      entityId: data.id,
      after: { isLive: data.is_live },
    });
    revalidatePath(`/${ctx.institution.slug}/website`);
    revalidatePath(`/s/${ctx.institution.slug}`, "layout");
    return { id: data.id, isLive: data.is_live };
  },
});

export const saveWebsiteTheme = defineAction({
  name: "website.theme.save",
  schema: SaveWebsiteThemeSchema,
  module: "website",
  // The look changes the live site at once, with no publish step, so it
  // takes the publish permission, same as setWebsiteLive.
  permission: "website.publish",
  handler: async (input: SaveWebsiteThemeInput, ctx) => {
    const supabase = await createClient();
    const website = await getOrCreateWebsite(supabase, ctx);

    const { data, error } = await supabase
      .from("websites")
      .update({ theme: input })
      .eq("id", website.id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Website not found.");

    await audit(ctx, { action: "website.theme.saved", entityType: "website", entityId: data.id, after: input });
    revalidatePath(`/${ctx.institution.slug}/website/theme`);
    revalidatePath(`/s/${ctx.institution.slug}`, "layout");
    return { id: data.id };
  },
});

export const upsertNotice = defineAction({
  name: "website.notice.upsert",
  schema: UpsertNoticeSchema,
  module: "website",
  permission: "website.edit",
  handler: async (input: UpsertNoticeInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      title: input.title,
      body: input.body,
      publish_at: input.publishAt,
      expires_at: input.expiresAt ?? null,
      is_public: input.isPublic,
      audience: input.audience ?? null,
    };

    // `.maybeSingle()`, not `.single()`: an update matching zero rows (wrong
    // tenant, deleted, or a forged id) must surface as `not_found` below —
    // `.single()` raises PGRST116 on zero rows, which `throwMapped` has no
    // `code:` prefix to map and turns into a generic `internal`, making the
    // `if (!data)` not_found branch dead code (fix round 1, code review).
    const query = input.id
      ? supabase.from("notices").update(row).eq("id", input.id).eq("institution_id", ctx.institution.id)
      : supabase.from("notices").insert(row);
    const { data, error } = await query.select("id, is_public, publish_at").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Notice not found.");

    await audit(ctx, {
      action: "website.notice.saved",
      entityType: "notice",
      entityId: data.id,
      after: { isPublic: data.is_public, publishAt: data.publish_at },
    });
    revalidatePath(`/${ctx.institution.slug}/website/notices`);
    revalidatePath(`/s/${ctx.institution.slug}`, "layout");
    return { id: data.id };
  },
});

export const upsertEvent = defineAction({
  name: "website.event.upsert",
  schema: UpsertEventSchema,
  module: "website",
  permission: "website.edit",
  handler: async (input: UpsertEventInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      location: input.location ?? null,
      is_public: input.isPublic,
    };

    // Same fix-round-1 reasoning as upsertNotice above: `.maybeSingle()` so
    // a zero-row update (cross-tenant/forged id) reaches the explicit
    // not_found check instead of being swallowed as `internal` by `.single()`.
    const query = input.id
      ? supabase.from("events").update(row).eq("id", input.id).eq("institution_id", ctx.institution.id)
      : supabase.from("events").insert(row);
    const { data, error } = await query.select("id, is_public, starts_at").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Event not found.");

    await audit(ctx, {
      action: "website.event.saved",
      entityType: "event",
      entityId: data.id,
      after: { isPublic: data.is_public, startsAt: data.starts_at },
    });
    revalidatePath(`/${ctx.institution.slug}/website/events`);
    revalidatePath(`/s/${ctx.institution.slug}`, "layout");
    return { id: data.id };
  },
});
