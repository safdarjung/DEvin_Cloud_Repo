"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, Box } from "lucide-react";
import { cn } from "cn";
import { homeIcon } from "@/components/home/icons";
import { HONESTY_TEXT } from "@/components/home/story";
import { tabKeyDown } from "@/components/home/tabs";
import { TOUR_ROLES } from "@/components/tour/roles";
import { DEMO_QUICK_LOGIN } from "@/lib/auth/demo-flag";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = "roles";

/** Five people as tabs: what each one gets, and a one-click demo account on the sample school. */
export function RolesSection() {
  const [active, setActive] = useState(0);
  const role = TOUR_ROLES[active];

  return (
    <SectionShell id={id} className="border-t border-(color:--fos-line)">
      <ScrollReveal>
        <div className="max-w-3xl">
          <p className="fos-eyebrow" data-reveal>
            Who uses it
          </p>
          <h2 id={`${id}-title`} className="fos-h2 mt-5" data-reveal>
            Five people. One record.
          </h2>
          <p className="fos-lead mt-6" data-reveal>
            Each person signs in to their own view of the same records. Pick one, then try their account on a sample school.
          </p>
        </div>

        <div role="tablist" aria-label="People" className="mt-12 flex gap-2 overflow-x-auto pb-2" data-reveal onKeyDown={(e) => tabKeyDown(e, TOUR_ROLES.length, active, setActive)}>
          {TOUR_ROLES.map((r, i) => {
            const on = i === active;
            return (
              <button
                key={r.key}
                type="button"
                role="tab"
                id={`people-tab-${r.key}`}
                aria-selected={on}
                aria-controls="people-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(i)}
                style={{ "--hue": r.accent } as CSSProperties}
                className={cn(
                  "relative min-h-14 shrink-0 rounded-2xl border px-5 py-3 text-left transition-colors duration-300 sm:flex-1",
                  on ? "border-(color:--hue) bg-[color-mix(in_oklab,var(--hue)_12%,var(--fos-surface))]" : "border-(color:--fos-line) hover:border-(color:--fos-line-strong) hover:bg-white/[0.03]",
                )}
              >
                <span className="flex items-center gap-2 font-medium whitespace-nowrap text-(color:--fos-fg)">
                  <span aria-hidden className="size-2 rounded-full bg-(color:--hue)" />
                  {r.label}
                </span>
                <span className="mt-0.5 block text-sm whitespace-nowrap text-(color:--fos-faint)">{r.room}</span>
              </button>
            );
          })}
        </div>

        <div id="people-panel" role="tabpanel" aria-labelledby={`people-tab-${role.key}`} className="fos-panel mt-4 p-6 sm:p-10" style={{ "--hue": role.accent } as CSSProperties} data-reveal>
          <div key={role.key} className="fos-swap grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
            <div>
              <h3 className="text-2xl leading-tight font-medium tracking-[-0.025em] text-(color:--fos-fg) sm:text-[2rem]">{role.tagline}</h3>
              <div className="mt-8 flex flex-wrap gap-3">
                {DEMO_QUICK_LOGIN && (
                  <form method="post" action="/api/public/demo-login">
                    <input type="hidden" name="email" value={role.demoEmail} />
                    <button type="submit" className="fos-btn fos-btn-primary">
                      Try the {role.label} demo
                      <ArrowRight className="size-4" aria-hidden />
                    </button>
                  </form>
                )}
                <Link href={`/tour#tour-${role.key}`} className="fos-btn fos-btn-ghost">
                  <Box className="size-4" aria-hidden />
                  {role.room} in 3D
                </Link>
              </div>
              {DEMO_QUICK_LOGIN && <p className="mt-4 text-sm text-(color:--fos-faint)">Opens a sample school as this person. No sign-up.</p>}
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {role.features.map((f) => {
                const Icon = homeIcon(f.icon);
                return (
                  <li key={f.title} className="flex gap-3.5">
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg border border-(color:--fos-line-strong) text-(color:--hue)">
                      <Icon size={18} strokeWidth={1.8} />
                    </span>
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-medium text-(color:--fos-fg)">
                        {f.title}
                        {f.label ? <span className="fos-honest">{HONESTY_TEXT[f.label]}</span> : null}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-(color:--fos-muted)">{f.blurb}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-(color:--fos-faint)" data-reveal>
          Nine roles in all: owner, principal, administrator, admissions officer, accountant, exam controller, teacher, student and guardian. A person sees only what their role, and their own rows, allow.
        </p>
      </ScrollReveal>
    </SectionShell>
  );
}
