import { isMarketingPath } from "@/lib/marketing/routes";

// "start": public invite-code sign-up (F18 §H), reached with no session.
// "auth": password reset (forgot-password, callback, reset-password), reached with no session.
const NON_TENANT_FIRST_SEGMENTS = new Set(["login", "logout", "start", "auth"]);

// @supabase/ssr session cookie `sb-<ref>-auth-token` or one of its chunks (`.0`, `.1`, …).
// The `-code-verifier` PKCE cookie is not a session.
const SESSION_COOKIE = /^sb-.+-auth-token(\.(0|[1-9]\d*))?$/;

// Next's client-router headers (FLIGHT_HEADERS in next/dist/client/components/app-router-headers).
// Next 16 strips them, and `_rsc`, before calling the proxy, so Fetch Metadata below is the
// real signal; these only count if that URL normalization is ever turned off.
const ROUTER_HEADERS = ["rsc", "next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree"];

export type ProxyDecision = "auto-login" | "redirect-to-login" | "pass";

export interface ProxyDecisionInput {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: Headers;
  /** The request arrived with a Supabase session cookie, valid or not (read before getClaims may clear it). */
  hasSessionCookie: boolean;
  claimsValid: boolean;
  autoLoginEnabled: boolean;
}

export function hasSessionCookie(cookies: readonly { name: string; value: string }[]): boolean {
  return cookies.some((c) => c.value !== "" && SESSION_COOKIE.test(c.name));
}

/**
 * A top-level page load a person asked for: GET, Fetch Metadata says navigate/document, and
 * nothing marks it speculative. Client-router (RSC) fetches and prefetches send cors/empty,
 * subresources send their own dest, browser prefetch/prerender sends Sec-Purpose. Clients
 * without Fetch Metadata (curl, crawlers, pre-2023 Safari) are not treated as navigations.
 */
function isPageNavigation(method: string, headers: Headers): boolean {
  if (method !== "GET") return false;
  if (ROUTER_HEADERS.some((h) => headers.has(h))) return false;
  if (`${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.includes("prefetch")) return false;
  return headers.get("sec-fetch-mode") === "navigate" && headers.get("sec-fetch-dest") === "document";
}

/**
 * Session handling for one proxy request (never authorization).
 * auto-login: demo auto-login is on, the request carries no session cookie at all, it is a
 *   page navigation (isPageNavigation), and the path is /select, plain /login, or a tenant path.
 * redirect-to-login: no verified session on a tenant path (anything not marketing or
 *   NON_TENANT_FIRST_SEGMENTS) and auto-login does not apply.
 * pass: everything else.
 */
export function proxyDecision(input: ProxyDecisionInput): ProxyDecision {
  if (input.claimsValid) return "pass";

  const first = input.pathname.split("/")[1] ?? "";
  const isMarketing = isMarketingPath(input.pathname);
  const isTenantPath = !isMarketing && !NON_TENANT_FIRST_SEGMENTS.has(first);
  // /login?switch: role picker. /login?reset: just changed password, show the sign-in form.
  const wantsPicker = input.searchParams.has("switch") || input.searchParams.has("reset");
  const autoLoginPath = isTenantPath || first === "select" || (first === "login" && !wantsPicker);

  if (input.autoLoginEnabled && !input.hasSessionCookie && autoLoginPath && isPageNavigation(input.method, input.headers)) {
    return "auto-login";
  }
  return isTenantPath ? "redirect-to-login" : "pass";
}
