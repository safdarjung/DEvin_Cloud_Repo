/**
 * Guards the `?next=` redirect target against open redirects (07 §1 — login
 * errors are generic, but this specifically stops `next` sending a session
 * to an attacker's origin). Only a same-origin path survives; anything else
 * (absolute URL, protocol-relative `//host`, missing) falls back to `/`.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  // Browsers read "\" as "/" and strip tabs/newlines, so "/\evil" or "/\t/evil" leave the origin.
  if (/[\\\x00-\x1f\x7f]/.test(next)) return "/";
  const base = "http://same-origin.invalid";
  return new URL(next, base).origin === base ? next : "/";
}
