import type { Metadata } from "next";
import Link from "next/link";
import { getClaims } from "@/lib/supabase/server";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Join your school" };

// The invite token lives in the URL hash (#token=…), so it never reaches a server log; the form reads it in the browser.
export default async function InvitePage() {
  const claims = await getClaims();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Join your school</h1>
          <p className="text-sm text-muted-foreground">
            Your school invited you. {claims ? "Confirm below to join." : "Choose a password and you are in."}
          </p>
        </div>
        <InviteForm signedIn={Boolean(claims)} />
        {!claims && (
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
              Sign in
            </Link>
            , then open your invite link again.
          </p>
        )}
      </div>
    </main>
  );
}
