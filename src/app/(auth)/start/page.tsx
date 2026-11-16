import type { Metadata } from "next";
import Link from "next/link";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "Set up your school" };

// F18 §H — public: invite code + school + owner account → /<slug>/setup.
export default async function StartPage({ searchParams }: { searchParams: Promise<{ code?: string; email?: string }> }) {
  const { code, email } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Set up your school</h1>
          <p className="text-sm text-muted-foreground">
            Four details and your school is ready. Use the invite link we sent you and the code fills in by itself. You
            become the owner and can add your team next.
          </p>
        </div>
        <StartForm initialCode={typeof code === "string" ? code : ""} initialEmail={typeof email === "string" ? email : ""} />
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
