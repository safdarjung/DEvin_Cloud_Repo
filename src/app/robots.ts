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
// /platform = operator console, /start = invite-code school setup (both noindex too).
// /s/<slug> is the PUBLIC school-site renderer: deliberately not listed.
const PRIVATE = ["/api/", "/login", "/logout", "/start", "/select", "/portal", "/platform", "/offline"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
