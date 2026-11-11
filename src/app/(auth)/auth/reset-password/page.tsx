import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getClaims } from "@/lib/supabase/server";
import { isRecoverySession } from "../schemas";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // The action re-checks this; the page check only avoids showing a dead form.
  if (!isRecoverySession(await getClaims())) redirect("/auth/forgot-password");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">You will be signed out everywhere and asked to sign in again.</p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
