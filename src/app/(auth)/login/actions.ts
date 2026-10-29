"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { createClient } from "@/lib/supabase/server";

const LoginInput = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(1),
    next: z.string().optional(),
  })
  .strict();

// Generic error on any failure (07 §1 — never reveal whether the email exists).
const INVALID_CREDENTIALS: ActionResult<null> = {
  ok: false,
  error: { code: "unauthenticated", message: "Invalid email or password." },
};

export async function login(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });

  if (!parsed.success) {
    return INVALID_CREDENTIALS;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return INVALID_CREDENTIALS;
  }

  redirect(sanitizeNextPath(parsed.data.next));
}
