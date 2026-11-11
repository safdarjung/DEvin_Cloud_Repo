import "server-only";
// F18 §H — /start: an invite code turns a stranger into the owner of a new
// school. Order matters (owner decision 2026-11-10): validate → rate limit →
// peek the code and its email binding (service role, one SQL predicate for
// every bad code or wrong email) → only
// then create the auth user (local auth has sign-up disabled) → sign in →
// create_institution_with_invite as that user. If the school is not created,
// the user created in THIS request is deleted again; a pre-existing account is
// never touched and never revealed. Codes, passwords and emails are never logged.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { fail, mapSqlError, ok, type ActionResult } from "@/lib/actions/result";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { createClient } from "@/lib/supabase/server";
import { StartSchoolSchema } from "@/modules/core/setup/schemas";
import { createSchoolStartAdminClient } from "@/modules/core/setup/with-service-role";
import { clientIp } from "@/modules/website/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const BAD_CODE_FLOOR_MS = 250;
const INVALID_CODE = "This invite code is not valid.";
const ACCOUNT_FAILED = "We could not create an account with these details. If you already have one, contact us.";

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

// Same client key as /api/public/lead (0100): ip + daily salt from CRON_SECRET, so no raw IP is stored.
function clientHash(request: Request): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return sha256Hex(clientIp(request) + sha256Hex(`${secret}:${new Date().toISOString().slice(0, 10)}`));
}

function json<T>(body: ActionResult<T>, status: number): Response {
  return NextResponse.json(body, { status });
}

const invalidCode = () => json(fail("forbidden", INVALID_CODE), 403);

type Admin = ReturnType<typeof createSchoolStartAdminClient>;

// Deletes the account this request created, unless it already holds a
// membership (the school committed but the response was lost).
async function removeNewUser(admin: Admin, userId: string): Promise<void> {
  const { count, error } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error || (count ?? 0) > 0) {
    console.error(`/api/public/start: kept new user ${userId} (membership check ${error ? "failed" : "found a membership"})`);
    return;
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) console.error(`/api/public/start: could not delete new user ${userId}`);
}

export async function POST(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) return json(fail("forbidden", "Cross-site request refused."), 403);

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return json(fail("validation_failed", "Request body must be JSON under 8 KB."), body.tooLarge ? 413 : 400);

  const parsed = StartSchoolSchema.safeParse(body.data);
  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten();
    return json(fail("validation_failed", "Check the highlighted fields.", fieldErrors as Record<string, string[]>), 400);
  }
  const { code, schoolName, slug, ownerName, email, password } = parsed.data;

  const client = clientHash(request);
  if (!client) {
    console.error("/api/public/start misconfigured: CRON_SECRET missing");
    return json(fail("internal", "Something went wrong. Please try again."), 500);
  }

  const started = Date.now();
  const admin = createSchoolStartAdminClient();
  // 0127: 5 per client per 15 min, 30 per code per hour, counted in SQL so every instance shares them.
  const attempt = await admin.rpc("record_school_start_attempt", { p_client_hash: client, p_code: code });
  if (attempt.error) {
    const mapped = mapSqlError(attempt.error);
    if (!mapped.ok && mapped.error.code === "rate_limited") return json(fail("rate_limited", "Too many attempts. Try again later."), 429);
    return json(mapped, 500);
  }

  // A code bound to another email is the same "not valid" (0127): no createUser, so no account-exists answer.
  const peek = await admin.rpc("peek_platform_invite_code", { p_code: code, p_email: email });
  if (peek.error) return json(mapSqlError(peek.error), 500);
  if (peek.data !== true) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, started + BAD_CODE_FLOOR_MS - Date.now())));
    return invalidCode();
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: ownerName },
  });
  // One answer for every failure, an existing email included.
  if (created.error || !created.data.user) return json(fail("validation_failed", ACCOUNT_FAILED), 400);
  const userId = created.data.user.id;

  // A throw past this point would otherwise leave a confirmed account with no school.
  try {
    const supabase = await createClient();
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (signIn.error) {
      await removeNewUser(admin, userId);
      return json(fail("internal", "Something went wrong. Please try again."), 500);
    }

    const { data, error } = await supabase.rpc("create_institution_with_invite", { p_code: code, p_name: schoolName, p_slug: slug });
    if (error || !data?.[0]) {
      await supabase.auth.signOut({ scope: "local" });
      await removeNewUser(admin, userId);
      const mapped = error ? mapSqlError(error) : fail("internal", "School was not created.");
      if (mapped.ok) return json(fail("internal", "School was not created."), 500);
      switch (mapped.error.code) {
        case "forbidden":
          return invalidCode(); // lost a race for the last use of the code
        case "conflict":
          return json(fail("conflict", "That web address is taken. Choose another.", { slug: ["already in use"] }), 409);
        case "validation_failed":
          return json(mapped, 400);
        default:
          return json(mapped, 500);
      }
    }

    return json(ok({ redirectTo: `/${data[0].slug}/setup` }), 200);
  } catch {
    console.error("/api/public/start: school setup threw after the user was created");
    await removeNewUser(admin, userId);
    return json(fail("internal", "Something went wrong. Please try again."), 500);
  }
}
