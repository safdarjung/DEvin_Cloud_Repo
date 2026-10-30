import { DEMO_ACCOUNT_GROUPS, DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
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
  const nextProp = next === "/" ? undefined : next;
  const showDemoHints = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center gap-8 px-4 py-10 sm:py-16">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold">CoolSkool</h1>
        <p className="text-sm text-muted-foreground">
          {showDemoHints ? "St. Joseph's Convent School (Demo)" : "Sign in to continue."}
        </p>
      </div>
      <div className={showDemoHints ? "grid w-full max-w-4xl gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start" : "w-full max-w-sm"}>
        {showDemoHints && (
          <section aria-labelledby="demo-accounts-h" className="flex flex-col gap-6 lg:order-1">
            <div className="flex flex-col gap-1">
              <h2 id="demo-accounts-h" className="text-base font-medium">
                Pick who you&apos;re signing in as
              </h2>
              <p className="text-sm text-muted-foreground">One tap — each account opens on the screen it actually uses.</p>
            </div>
            {DEMO_ACCOUNT_GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-2.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DEMO_ACCOUNTS.filter((a) => a.group === group).map((account) => (
                    <DemoLoginButton
                      key={account.email}
                      email={account.email}
                      name={account.name}
                      role={account.role}
                      blurb={account.blurb}
                      icon={<account.icon />}
                      next={nextProp}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        <section
          aria-labelledby="manual-signin-h"
          className={
            showDemoHints
              ? "flex flex-col gap-4 rounded-xl bg-muted/40 p-5 ring-1 ring-foreground/10 lg:order-2 lg:sticky lg:top-16"
              : "flex flex-col gap-4"
          }
        >
          <h2 id="manual-signin-h" className="text-sm font-medium text-muted-foreground">
            {showDemoHints ? "Or sign in manually" : "Email and password"}
          </h2>
          <LoginForm next={nextProp} />
        </section>
      </div>
    </main>
  );
}
