import { sanitizeNextPath } from "@/lib/auth/next-url";
import { LoginForm } from "./login-form";

// 11 §3 — named demo logins (passwords are never hardcoded; SEED_DEMO_PASSWORD only).
const DEMO_ACCOUNT_EMAILS = [
  "principal@demo.coolskool.test",
  "admin@demo.coolskool.test",
  "admissions@demo.coolskool.test",
  "accountant@demo.coolskool.test",
  "examcontroller@demo.coolskool.test",
  "teacher.vi-a@demo.coolskool.test",
  "teacher.viii-b@demo.coolskool.test",
  "teacher.x-a@demo.coolskool.test",
  "guardian.one@demo.coolskool.test",
  "guardian.two@demo.coolskool.test",
  "student.one@demo.coolskool.test",
];

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
        <section aria-label="Demo accounts" className="flex max-w-sm flex-col gap-2 text-center">
          <h2 className="text-sm font-medium">Demo accounts</h2>
          <ul className="text-xs text-muted-foreground">
            {DEMO_ACCOUNT_EMAILS.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
