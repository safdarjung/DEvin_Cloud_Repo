// T-043 — load-script shared helpers: target guard + session cookies.
// Plain Node (`node --env-file-if-exists=.env.local scripts/load/*.ts`),
// same pattern as scripts/jobs-run.ts and scripts/ai-bench/bench.ts.
import { createServerClient, type GetAllCookies, type SetAllCookies } from "@supabase/ssr";

/**
 * Refuses to run unless `LOAD_TARGET_URL` is set and is local, or the
 * hosted demo URL has been explicitly confirmed (`LOAD_HOSTED_CONFIRMED=
 * true`). T-044's hosted preview environment is a separate, unapproved
 * packet — these scripts never assume it exists.
 */
export function requireLoadTarget(): string {
  const url = process.env.LOAD_TARGET_URL;
  if (!url) {
    console.error("LOAD_TARGET_URL is not set. Refusing to run — see scripts/load/README.md.");
    process.exit(1);
  }
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  if (!isLocal && process.env.LOAD_HOSTED_CONFIRMED !== "true") {
    console.error(
      `LOAD_TARGET_URL (${url}) is not local and LOAD_HOSTED_CONFIRMED is not "true". ` +
        "Hosted runs need an explicit opt-in (T-044 preview is not approved as of T-043).",
    );
    process.exit(1);
  }
  return url.replace(/\/+$/, "");
}

/**
 * Signs in via the Supabase password grant (packet: "never stores tokens
 * on disk") and returns the `@supabase/ssr` session cookie header this
 * user's real browser would send — an in-memory jar only, nothing written
 * to disk. Delegates the cookie encoding/chunking to `@supabase/ssr` itself
 * rather than re-implementing its `base64-` chunked format by hand.
 */
export async function loginCookieHeader(email: string, password: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
  }

  const jar = new Map<string, string>();
  const getAll: GetAllCookies = () => Array.from(jar, ([name, value]) => ({ name, value }));
  const setAll: SetAllCookies = (cookiesToSet) => {
    for (const { name, value } of cookiesToSet) jar.set(name, value);
  };

  const supabase = createServerClient(supabaseUrl, publishableKey, { cookies: { getAll, setAll } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`login failed for ${email}: ${error?.message ?? "no session returned"}`);
  }

  return Array.from(jar, ([name, value]) => `${name}=${value}`).join("; ");
}

export interface PercentileStats {
  p50: number;
  p95: number;
  max: number;
  count: number;
  errors: number;
}

export function summarize(latenciesMs: number[], errors: number): PercentileStats {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const at = (q: number): number => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0, count: sorted.length, errors };
}
