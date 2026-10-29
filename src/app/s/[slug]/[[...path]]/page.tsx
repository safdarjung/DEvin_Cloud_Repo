import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlockRenderer } from "@/modules/website/components/blocks/BlockRenderer";
import { getPublicPage, getPublicSite } from "@/modules/website/queries";

// `pages.slug` stores `"home"` for `/` (05 §2.8); every other path segment
// chain maps to that same slug string (`/admissions` -> `"admissions"`).
// Only a single segment is supported — a page slug is one path component,
// never a nested route — so anything deeper than that also 404s.
function pageSlugFor(path: string[] | undefined): string | null {
  if (!path || path.length === 0) return "home";
  if (path.length > 1) return null;
  return path[0]!;
}

async function loadPage(slugParam: string, pathParam: string[] | undefined) {
  const site = await getPublicSite(slugParam);
  if (!site) return null;

  const pageSlug = pageSlugFor(pathParam);
  if (!pageSlug) return null;

  const page = await getPublicPage(site.institutionId, pageSlug);
  if (!page) return null;

  return { site, page };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}): Promise<Metadata> {
  const { slug, path } = await params;
  const loaded = await loadPage(slug, path);
  if (!loaded) return {};
  return {
    title: `${loaded.page.title} | ${loaded.site.institutionName}`,
  };
}

export default async function PublicPage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path } = await params;
  const loaded = await loadPage(slug, path);
  if (!loaded) notFound();

  return <BlockRenderer blocks={loaded.page.blocks} slug={slug} institutionId={loaded.site.institutionId} />;
}
