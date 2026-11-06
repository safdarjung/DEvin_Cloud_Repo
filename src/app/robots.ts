import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// robots.txt is advisory, NOT a security boundary: anything listed here is
// publicly readable and well-behaved crawlers only. Real protection is auth +
// RLS. Tenant paths (/<slug>/...) cannot be enumerated here, so tenant/auth
// layouts also emit `robots: noindex`.
//
// Training crawlers (GPTBot, Google-Extended, CCBot...) are left allowed: the
// site is public marketing copy we want represented accurately. Revisit if
// that changes; add a per-bot `disallow: "/"` rule here.
const PRIVATE = ["/api/", "/login", "/logout", "/select", "/portal", "/offline"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
