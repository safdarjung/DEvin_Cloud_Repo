// M02-T6 — tenant-editor wrappers for ./queries.ts, exposed at
// /api/v1/query/website.<fn>. Public fns (getPublicSite, getPublicPage,
// listPublicNotices, listPublicEvents) skipped (public site's own anon
// path). permission: website.edit — every tenant page here gates on this.
import { defineQuery } from "@/lib/actions/define-query";
import { uuid } from "@/lib/schemas/common";
import { z } from "zod";
import { getPageWithVersions, getVersion, getWebsite, listEvents, listNotices, listPages } from "./queries";

const noInput = z.object({}).strict();

export const listPagesQuery = defineQuery({ name: "website.listPages", schema: noInput, module: "website", permission: "website.edit", handler: (_input, ctx) => listPages(ctx) });

export const getPageWithVersionsQuery = defineQuery({
  name: "website.getPageWithVersions",
  schema: z.object({ pageId: uuid }).strict(),
  module: "website",
  permission: "website.edit",
  handler: (input, ctx) => getPageWithVersions(ctx, input.pageId),
});

export const getVersionQuery = defineQuery({
  name: "website.getVersion",
  schema: z.object({ pageId: uuid, versionId: uuid }).strict(),
  module: "website",
  permission: "website.edit",
  handler: (input, ctx) => getVersion(ctx, input.pageId, input.versionId),
});

export const listNoticesQuery = defineQuery({ name: "website.listNotices", schema: noInput, module: "website", permission: "website.edit", handler: (_input, ctx) => listNotices(ctx) });

export const listEventsQuery = defineQuery({ name: "website.listEvents", schema: noInput, module: "website", permission: "website.edit", handler: (_input, ctx) => listEvents(ctx) });

export const getWebsiteQuery = defineQuery({ name: "website.getWebsite", schema: noInput, module: "website", permission: "website.edit", handler: (_input, ctx) => getWebsite(ctx) });
