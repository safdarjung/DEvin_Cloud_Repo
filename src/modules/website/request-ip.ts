// Fix round 1 (security review, HIGH — C-81 bypass). Extracted out of
// `src/app/api/public/enquiry/route.ts` so the selection logic is
// unit-testable directly (Next.js route files only recognize HTTP-method
// and route-config exports).
//
// The previous version trusted `x-forwarded-for`/`x-real-ip`
// unconditionally, but on a raw request BOTH are attacker-controlled — a
// bot can set either header to a fresh value on every call and get a
// fresh T12 rate-limit bucket every time. Vercel's own docs settle which
// header is actually trustworthy there: "If you are trying to use Vercel
// behind a proxy, we currently overwrite the X-Forwarded-For header and do
// not forward external IPs. This restriction is in place to prevent IP
// spoofing." — and separately, "`x-real-ip` ... is identical to the
// `x-forwarded-for` header." (https://vercel.com/docs/headers/request-headers,
// "x-forwarded-for" / "x-real-ip" sections).
function firstForwardedIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || null;
}

export function clientIp(request: Request): string {
  const extracted = firstForwardedIp(request) ?? request.headers.get("x-real-ip")?.trim() ?? "unknown";

  if (process.env.VERCEL === "1") {
    // On Vercel this value is the documented trusted header: Vercel's
    // edge sets `x-forwarded-for` itself and strips any client-supplied
    // value (doc quote above); `x-real-ip` is documented as identical to
    // it. Safe to use directly for the T12 rate limit.
    return extracted;
  }

  // shortcut: off Vercel (local dev, or a self-hosted/"institution-
  // controlled" deployment, 04 §8 mode C) there's no such guarantee —
  // whatever sits in front of this process may pass a client-supplied
  // header straight through unmodified, so the IP below is NOT
  // trustworthy and the T12 rate limit it feeds is best-effort only in
  // this mode. Still hash and use whatever is present rather than
  // skipping rate limiting entirely. Upgrade when that deployment mode
  // documents and sets its own trusted proxy header.
  return extracted;
}
