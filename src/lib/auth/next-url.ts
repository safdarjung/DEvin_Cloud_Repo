/**
 * Guards the `?next=` redirect target against open redirects (07 §1 — login
 * errors are generic, but this specifically stops `next` sending a session
 * to an attacker's origin). Only a same-origin path survives; anything else
 * (absolute URL, protocol-relative `//host`, missing) falls back to `/`.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.includes("://")) return "/";
  return next;
}
