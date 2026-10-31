import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_ACCOUNT_EMAILS } from "@/lib/auth/demo-accounts";

/** Demo quick-access is on (NEXT_PUBLIC_DEMO_LOGIN_HINTS) and auto-login is not explicitly disabled, or auto-login is forced on. */
export function demoAutoLoginEnabled(): boolean {
  const flag = process.env.DEMO_AUTO_LOGIN;
  if (flag === "true") return true;
  return flag !== "false" && process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";
}

export const defaultDemoEmail = (): string => process.env.DEMO_AUTO_LOGIN_AS ?? "principal@demo.coolskool.test";

/**
 * Starts a real session for an allow-listed demo account without a password:
 * GoTrue mints a one-time token for the email and the cookie-bound client
 * redeems it, so a wrong or rotated demo password can never break the demo.
 * Only the fixed demo-account emails are accepted; RLS applies as usual.
 */
export async function signInAsDemo(supabase: { auth: Pick<SupabaseClient["auth"], "verifyOtp"> }, email: string): Promise<boolean> {
  if (!DEMO_ACCOUNT_EMAILS.includes(email)) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return false;

  const res = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!res.ok) return false;
  const { hashed_token: tokenHash } = (await res.json()) as { hashed_token?: string };
  if (!tokenHash) return false;

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  return !error;
}
