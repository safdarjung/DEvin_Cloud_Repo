"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/actions/result";
import { createClient, getClaims } from "@/lib/supabase/server";
import { ForgotPasswordInput, ResetPasswordInput, isRecoverySession } from "./schemas";

// Same answer whether or not the account exists (07 §1 — no user enumeration).
const SENT: ActionResult<null> = { ok: true, data: null };

export async function requestPasswordReset(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = ForgotPasswordInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: { code: "validation_failed", message: "Enter a valid email address." } };
  }

  // Next rejects a Server Action whose Origin differs from its Host, so this is
  // the app's own origin. Supabase's redirect allow-list is what stops a forged Host.
  const origin = URL.parse((await headers()).get("origin") ?? "")?.origin;
  if (!origin || origin === "null") {
    console.error("requestPasswordReset: missing Origin header, no email sent");
    return SENT;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: new URL("/auth/callback", origin).toString(),
  });
  if (error) {
    // Rate limits answer like success too: GoTrue only rate-limits addresses that exist, so a different
    // reply would tell a caller which emails have accounts.
    // Code and status only: GoTrue messages can contain the email address.
    console.error(`requestPasswordReset: supabase error ${error.code ?? "unknown"} (${error.status ?? "no status"})`);
  }
  return SENT;
}

export async function resetPassword(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  if (!isRecoverySession(await getClaims())) {
    redirect("/auth/forgot-password?error=expired");
  }

  const parsed = ResetPasswordInput.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation_failed",
        message: "Check the highlighted fields.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { ok: false, error: { code: "validation_failed", message: "Choose a password you have not used before." } };
    }
    if (error.code === "weak_password") {
      return { ok: false, error: { code: "validation_failed", message: "That password is too weak. Choose a stronger one." } };
    }
    console.error(`resetPassword: supabase error ${error.code ?? "unknown"} (${error.status ?? "no status"})`);
    return { ok: false, error: { code: "internal", message: "Could not update your password. Request a new reset link." } };
  }

  // Global: ends every session, this one included, so the new password is needed everywhere.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) console.error(`resetPassword: sign-out failed ${signOutError.code ?? "unknown"}`);
  redirect("/login?reset=1");
}
