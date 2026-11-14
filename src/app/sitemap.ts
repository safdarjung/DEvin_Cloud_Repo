import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// Public marketing URLs only. No tenant, auth, portal or api paths.
const PATHS = [
  "/", "/product", "/product/overview", "/modules", "/ai", "/security", "/pricing", "/how-it-works",
  "/faq", "/demo", "/roles", "/contact",
  "/legal/privacy", "/legal/terms", "/legal/cookies", "/legal/data-processing", "/legal/acceptable-use",
];

export default function sitemap(): MetadataRoute.Sitemap {
  // No lastModified: no real per-page date source; a fake one is worse than none.
  return PATHS.map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}` }));
}
