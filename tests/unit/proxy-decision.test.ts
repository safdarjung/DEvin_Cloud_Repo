import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETING_SEGMENTS } from "@/lib/marketing/routes";
import { RESERVED_SLUGS } from "@/modules/core/schemas";
import { hasSessionCookie, proxyDecision, type ProxyDecisionInput } from "@/proxy-decision";

// A real top-level navigation (address bar, link click, form-POST 303 follow).
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" };
// A client-router RSC fetch or prefetch as the proxy sees it: Next 16 strips
// rsc / next-router-* before calling the proxy, and fetch() sends cors/empty.
const RSC_AS_SEEN = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin", "next-url": "/demo" };
// The same prefetch if Next ever stops stripping its router headers.
const RSC_RAW = { ...RSC_AS_SEEN, rsc: "1", "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" };

type Over = Partial<Omit<ProxyDecisionInput, "pathname" | "searchParams" | "headers">> & { headers?: Record<string, string> };

function decide(path: string, { headers = NAV, ...over }: Over = {}) {
  const url = new URL(path, "https://demo.example");
  return proxyDecision({
    method: "GET",
    hasSessionCookie: false,
    claimsValid: false,
    autoLoginEnabled: true,
    ...over,
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers: new Headers(headers),
  });
}

describe("proxyDecision: demo auto-login only on a real page navigation", () => {
  it("signs a visitor with no session in on a document navigation to a tenant path", () => {
    expect(decide("/st-josephs/dashboard")).toBe("auto-login");
  });

  it("signs in on a document navigation to /select and to plain /login", () => {
    expect(decide("/select")).toBe("auto-login");
    expect(decide("/login")).toBe("auto-login");
    expect(decide("/login?next=%2Fst-josephs")).toBe("auto-login");
  });

  it("never signs in for a client-router prefetch or RSC fetch", () => {
    for (const headers of [RSC_AS_SEEN, RSC_RAW]) {
      expect(decide("/st-josephs/dashboard", { headers })).toBe("redirect-to-login");
      expect(decide("/login", { headers })).toBe("pass");
      expect(decide("/select", { headers })).toBe("pass");
    }
  });

  it("never signs in for a browser speculative prefetch or prerender", () => {
    expect(decide("/st-josephs", { headers: { ...NAV, "sec-purpose": "prefetch;prerender" } })).toBe("redirect-to-login");
    expect(decide("/st-josephs", { headers: { ...NAV, "sec-purpose": "prefetch" } })).toBe("redirect-to-login");
    expect(decide("/login", { headers: { ...NAV, purpose: "prefetch" } })).toBe("pass");
  });

  it("never signs in for subresource requests or clients without fetch metadata", () => {
    expect(decide("/st-josephs/logo.png", { headers: { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } })).toBe("redirect-to-login");
    expect(decide("/st-josephs", { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" } })).toBe("redirect-to-login");
    expect(decide("/st-josephs", { headers: {} })).toBe("redirect-to-login");
  });

  it("never signs in for non-GET methods", () => {
    for (const method of ["POST", "HEAD", "PUT"]) {
      expect(decide("/st-josephs", { method })).toBe("redirect-to-login");
      expect(decide("/login", { method })).toBe("pass");
    }
  });

  it("never replaces an existing session cookie, even when its claims fail to verify", () => {
    const stale = { hasSessionCookie: true, claimsValid: false };
    expect(decide("/st-josephs/dashboard", stale)).toBe("redirect-to-login");
    expect(decide("/login", stale)).toBe("pass");
    expect(decide("/select", stale)).toBe("pass");
  });

  it("passes any request whose session verified", () => {
    const ok = { hasSessionCookie: true, claimsValid: true };
    expect(decide("/st-josephs/dashboard", ok)).toBe("pass");
    expect(decide("/st-josephs/dashboard", { ...ok, headers: RSC_AS_SEEN })).toBe("pass");
    expect(decide("/login", ok)).toBe("pass");
  });

  it("leaves the role picker, password reset, logout, sign-up and auth pages alone", () => {
    expect(decide("/login?switch=1")).toBe("pass");
    expect(decide("/login?reset=1")).toBe("pass");
    expect(decide("/logout")).toBe("pass");
    expect(decide("/start")).toBe("pass");
    expect(decide("/auth/forgot-password")).toBe("pass");
  });

  it("keeps marketing pages public: no sign-in, no redirect", () => {
    for (const path of ["/", "/demo", "/pricing", "/tour", "/tour/admin.mp4"]) {
      expect(decide(path)).toBe("pass");
      expect(decide(path, { headers: RSC_AS_SEEN })).toBe("pass");
    }
  });

  it("redirects tenant paths to login when auto-login is off", () => {
    expect(decide("/st-josephs", { autoLoginEnabled: false })).toBe("redirect-to-login");
    expect(decide("/login", { autoLoginEnabled: false })).toBe("pass");
    expect(decide("/tour", { autoLoginEnabled: false })).toBe("pass");
  });
});

describe("hasSessionCookie", () => {
  it("recognises the @supabase/ssr session cookie and its chunks", () => {
    expect(hasSessionCookie([{ name: "sb-127-auth-token", value: "base64-x" }])).toBe(true);
    expect(hasSessionCookie([{ name: "sb-abcd-auth-token.0", value: "base64-x" }])).toBe(true);
  });

  it("ignores the PKCE verifier, unrelated and emptied cookies", () => {
    expect(hasSessionCookie([{ name: "sb-abcd-auth-token-code-verifier", value: "v" }])).toBe(false);
    expect(hasSessionCookie([{ name: "theme", value: "dark" }])).toBe(false);
    expect(hasSessionCookie([{ name: "sb-abcd-auth-token", value: "" }])).toBe(false);
  });
});

describe("public paths stay reserved", () => {
  it("/tour is a public marketing path", () => {
    expect(MARKETING_SEGMENTS).toContain("tour");
  });

  it("no school slug can shadow a public marketing segment", () => {
    const slugLike = MARKETING_SEGMENTS.filter((s) => /^[a-z0-9](-?[a-z0-9])*$/.test(s));
    expect(slugLike.filter((s) => !RESERVED_SLUGS.has(s))).toEqual([]);
  });
});

// Wiring: the proxy must read the cookie jar before getClaims (which may clear
// it) and must not call signInAsDemo for background requests.
const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims } }) }));
vi.mock("@/lib/auth/demo-session", () => ({
  demoAutoLoginEnabled: () => true,
  defaultDemoEmail: () => "principal@demo.coolskool.test",
  signInAsDemo: vi.fn(async () => true),
}));

describe("proxy wiring", async () => {
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("@/proxy");
  const { signInAsDemo } = await import("@/lib/auth/demo-session");
  const req = (path: string, headers: Record<string, string>) => new NextRequest(new URL(path, "https://demo.example"), { headers });

  beforeEach(() => getClaims.mockResolvedValue({ data: null }));
  afterEach(() => vi.clearAllMocks());

  it("does not sign in for a prefetch of /login", async () => {
    const res = await proxy(req("/login", RSC_AS_SEEN));
    expect(signInAsDemo).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not replace a session cookie whose claims fail to verify", async () => {
    const res = await proxy(req("/st-josephs", { ...NAV, cookie: "sb-127-auth-token=base64-stale" }));
    expect(signInAsDemo).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://demo.example/login?next=%2Fst-josephs");
  });

  it("signs in on a document navigation and returns to next from /login", async () => {
    const res = await proxy(req("/login?next=%2Fst-josephs", NAV));
    expect(signInAsDemo).toHaveBeenCalledOnce();
    expect(res.headers.get("location")).toBe("https://demo.example/st-josephs");
  });
});
