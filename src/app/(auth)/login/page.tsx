import { BarChart3, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { LoginForm } from "./login-form";
import { DemoLoginButton } from "./demo-login-button";

const HIGHLIGHTS = [
  { icon: BarChart3, text: "Attendance, fees and results in one live view" },
  { icon: Sparkles, text: "AI that drafts, flags and forecasts — you decide" },
  { icon: ShieldCheck, text: "Every school's data kept strictly its own" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);
  const nextProp = next === "/" ? undefined : next;
  const showQuickAccess = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 size-[28rem] rounded-full bg-white/10 blur-3xl motion-safe:animate-pulse [animation-duration:6s]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-black/20 blur-3xl"
        />
        <div className="relative flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          CoolSkool
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-4xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
            Run your whole school from one calm place.
          </h2>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-primary-foreground/85">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/20">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-primary-foreground/60">Built for Indian private schools.</p>
      </aside>

      <section className="flex flex-col items-center justify-center gap-8 bg-background px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm space-y-7 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 duration-300">
          <div className="space-y-2">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground lg:hidden">
              <GraduationCap className="size-5" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to your school workspace.</p>
          </div>

          <LoginForm next={nextProp} />

          {showQuickAccess && (
            <section aria-labelledby="quick-access-h" className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" aria-hidden />
                <h2 id="quick-access-h" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Quick access
                </h2>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((account) => (
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
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
