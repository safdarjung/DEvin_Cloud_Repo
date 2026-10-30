"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions/result";
import { DEMO_ACCOUNT_EMAILS } from "@/lib/auth/demo-accounts";
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

const DemoLoginInput = z
  .object({
    email: z.string().trim().email(),
    next: z.string().optional(),
  })
  .strict();

/**
 * One-click demo login (11 §3). The password never reaches the client: it
 * is read server-side from `SEED_DEMO_PASSWORD` (same fallback the seed
 * uses) and only ever used for the named demo accounts. Gated by the same
 * flag as the "Demo accounts" hint list, so it can never run against a
 * production deployment that has that flag off.
 */
export async function demoLogin(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  if (process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS !== "true") {
    return INVALID_CREDENTIALS;
  }

  const parsed = DemoLoginInput.safeParse({
    email: formData.get("email"),
    next: formData.get("next") || undefined,
  });

  if (!parsed.success || !DEMO_ACCOUNT_EMAILS.includes(parsed.data.email)) {
    return INVALID_CREDENTIALS;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026",
  });

  if (error) {
    return INVALID_CREDENTIALS;
  }

  redirect(sanitizeNextPath(parsed.data.next));
}
