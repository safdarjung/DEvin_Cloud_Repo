import { DEMO_ACCOUNT_EMAILS, DEMO_ACCOUNT_LABELS } from "@/lib/auth/demo-accounts";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { LoginForm } from "./login-form";
import { DemoLoginButton } from "./demo-login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);
  const showDemoHints = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">CoolSkool</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue.</p>
      </div>
      <LoginForm next={next === "/" ? undefined : next} />
      {showDemoHints && (
        <section aria-label="Demo accounts" className="flex w-full max-w-sm flex-col gap-2">
          <h2 className="text-center text-sm font-medium">Demo accounts — sign in with one click</h2>
          <ul className="flex flex-col gap-1.5">
            {DEMO_ACCOUNT_EMAILS.map((email) => (
              <li key={email}>
                <DemoLoginButton email={email} label={DEMO_ACCOUNT_LABELS[email] ?? email} next={next} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
