import { z } from "zod";
import type { JwtPayload } from "@supabase/supabase-js";

export const ForgotPasswordInput = z.object({ email: z.string().trim().email() }).strict();

export const ResetPasswordInput = z
  .object({
    // 72: GoTrue (bcrypt) rejects longer passwords.
    password: z.string().min(10, "Use at least 10 characters.").max(72, "Use at most 72 characters."),
    confirm: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

/**
 * True only for a session minted from a password-reset link (amr "recovery"),
 * so an ordinary or demo session cannot change a password without the email.
 */
export function isRecoverySession(claims: Pick<JwtPayload, "amr"> | null): boolean {
  return (claims?.amr ?? []).some((entry) => typeof entry === "object" && entry.method === "recovery");
}
