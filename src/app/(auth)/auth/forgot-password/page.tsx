import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Reset your password</h1>
          <p className="text-sm text-muted-foreground">Enter your email and we will send you a link to choose a new password.</p>
        </div>
        {error === "expired" && (
          <p role="alert" className="text-sm text-destructive">
            That reset link is invalid or has expired. Request a new one.
          </p>
        )}
        <ForgotPasswordForm />
        <p className="text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
