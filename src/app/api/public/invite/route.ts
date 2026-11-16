import "server-only";
// An email invitation for someone with no account yet. The invite token (256 random bits, only its
// sha256 stored) proves they hold the invite email, the same trust as /start's code. Order: validate →
// rate limit → token must name an open invitation → create the confirmed auth user → sign in →
// accept_invitation as that user (it re-checks email, state and linked records). If joining fails,
// the user created in THIS request is deleted again. Tokens, passwords and emails are never logged.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { fail, mapSqlError, ok, type ActionResult } from "@/lib/actions/result";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { createClient } from "@/lib/supabase/server";
import { JoinWithInviteSchema } from "@/modules/core/setup/schemas";
import { createSchoolStartAdminClient } from "@/modules/core/setup/with-service-role";
import { clientIp } from "@/modules/website/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const INVALID_LINK = "This invite link is not valid any more. Ask your school to send a new one.";
const HAS_ACCOUNT = "You already have an account. Sign in, then open your invite link again.";

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
const json = <T,>(body: ActionResult<T>, status: number) => NextResponse.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) return json(fail("forbidden", "Cross-site request refused."), 403);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return json(fail("validation_failed", "Request body must be JSON under 8 KB."), body.tooLarge ? 413 : 400);
  const parsed = JoinWithInviteSchema.safeParse(body.data);
  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten();
    return json(fail("validation_failed", "Check the highlighted fields.", fieldErrors as Record<string, string[]>), 400);
  }
  const { token, fullName, password } = parsed.data;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("/api/public/invite misconfigured: CRON_SECRET missing");
    return json(fail("internal", "Something went wrong. Please try again."), 500);
  }
  // Same client key and attempt limit as /start (5 per client per 15 min).
  const client = sha256Hex(clientIp(request) + sha256Hex(`${secret}:${new Date().toISOString().slice(0, 10)}`));
  const admin = createSchoolStartAdminClient();
  const attempt = await admin.rpc("record_school_start_attempt", { p_client_hash: client, p_code: token });
  if (attempt.error) {
    const mapped = mapSqlError(attempt.error);
    if (!mapped.ok && mapped.error.code === "rate_limited") return json(fail("rate_limited", "Too many attempts. Try again later."), 429);
    return json(mapped, 500);
  }

  const { data: invitation, error: lookupError } = await admin
    .from("invitations")
    .select("email, institution_id, accepted_at, revoked_at, expires_at")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  if (lookupError) return json(fail("internal", "Something went wrong. Please try again."), 500);
  if (!invitation || invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at) <= new Date()) {
    return json(fail("forbidden", INVALID_LINK), 403);
  }

  const created = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  // The caller holds a valid token for this email, so saying the account exists reveals nothing new.
  if (created.error || !created.data.user) return json(fail("conflict", HAS_ACCOUNT), 409);
  const userId = created.data.user.id;

  const undo = async () => {
    const { count } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) === 0) await admin.auth.admin.deleteUser(userId);
  };
  try {
    const supabase = await createClient();
    const signIn = await supabase.auth.signInWithPassword({ email: invitation.email, password });
    if (signIn.error) {
      await undo();
      return json(fail("internal", "Something went wrong. Please try again."), 500);
    }
    const { data: membershipId, error } = await supabase.rpc("accept_invitation", { p_token: token });
    if (error || !membershipId) {
      await supabase.auth.signOut({ scope: "local" });
      await undo();
      return json(fail("forbidden", INVALID_LINK), 403);
    }
    const { data: school } = await admin.from("institutions").select("slug").eq("id", invitation.institution_id).single();
    return json(ok({ redirectTo: school ? `/${school.slug}` : "/" }), 200);
  } catch {
    console.error("/api/public/invite: joining threw after the user was created");
    await undo();
    return json(fail("internal", "Something went wrong. Please try again."), 500);
  }
}
