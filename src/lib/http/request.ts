// Shared request guards for route handlers (DBT-29, T-042). Moved here from
// the two copies in src/app/api/public/enquiry/route.ts and
// src/app/api/ai/quiz/route.ts.

export type BodyReadResult = { ok: true; data: unknown } | { ok: false; tooLarge: boolean };

/**
 * Caps the body at `maxBytes` before it ever reaches `JSON.parse`.
 * `content-length` is checked first as a fast path, but it's a
 * client-supplied header too — can be absent or wrong — so the stream
 * itself is also read with a hard byte ceiling, never trusting the header alone.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, tooLarge: true };
  }

  if (!request.body) {
    try {
      const text = await request.text();
      return { ok: true, data: text.length > 0 ? JSON.parse(text) : undefined };
    } catch {
      return { ok: false, tooLarge: false };
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder().decode(bytes);
    return { ok: true, data: text.length > 0 ? JSON.parse(text) : undefined };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/**
 * CSRF guard for cookie-authenticated, cost-bearing POST handlers. Browsers
 * send `Origin` on every POST; when it is missing, `Sec-Fetch-Site` decides.
 * A request with neither header is not a browser request, so it carries no
 * ambient session cookie to abuse and is allowed (server-to-server, tests).
 * Defense in depth on top of the Supabase SSR cookies' SameSite=Lax.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin !== new URL(request.url).origin;
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}
