// Public marketing paths. First segments here are reserved: the proxy treats
// them as non-tenant (no login redirect, no demo auto-sign-in), so no
// institution slug may equal one of them.
export const MARKETING_SEGMENTS = [
  "product",
  "modules",
  "ai",
  "security",
  "pricing",
  "how-it-works",
  "faq",
  "demo",
  "contact",
  "roles",
  "legal",
  "offline",
  "sitemap.xml",
  "robots.txt",
  "manifest.webmanifest",
  "llms.txt",
  "for-agents.md",
  "sw.js",
  "opengraph-image",
  "icon",
  "apple-icon",
  "select",
] as const;

const SET = new Set<string>(MARKETING_SEGMENTS);

/** True for "/" and any path whose first segment is a marketing segment. */
export function isMarketingPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return SET.has(pathname.split("/")[1] ?? "");
}
