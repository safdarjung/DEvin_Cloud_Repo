import { BarChart3, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
import { sanitizeNextPath } from "@/lib/auth/next-url";
import { BrandVisual } from "./brand-visual";
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
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);
  const nextProp = next === "/" ? undefined : next;
  const showQuickAccess = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.17_0.03_255)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full text-white/[0.06]">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="pointer-events-none absolute -right-16 -bottom-16 size-[30rem] opacity-70">
          <BrandVisual />
        </div>
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-[26rem] rounded-full bg-[oklch(0.77_0.1_190)]/15 blur-3xl" />
        <div className="relative flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          Fabric
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-4xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
            Run your whole school from one calm place.
          </h2>
          <svg viewBox="0 0 320 72" className="h-16 w-full max-w-xs text-[oklch(0.77_0.1_190)]" role="img" aria-label="Attendance trend, illustrative">
            <path
              d="M0 56 C30 52 50 40 80 44 S130 60 160 36 S220 18 250 26 S300 8 320 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              pathLength="1"
              className="[stroke-dasharray:1] motion-safe:animate-[draw_1.6s_var(--ease-out)_both]"
            />
          </svg>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/80">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">Built for Indian private schools.</p>
      </aside>

      <section className="flex flex-col items-center justify-center gap-8 bg-background px-5 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-8">
        <div className="w-full max-w-sm space-y-7 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 duration-300">
          <div className="space-y-2">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground lg:hidden">
              <GraduationCap className="size-5" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to your school workspace.</p>
          </div>

          {params.reset === "1" && (
            <p role="status" className="rounded-lg bg-muted px-3 py-2.5 text-sm">
              Password updated. Sign in.
            </p>
          )}

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
