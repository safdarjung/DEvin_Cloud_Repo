// What FabricOS is, in one answer-first paragraph, beside the counts that back it up. The counts
// come from home/stats.ts, which a unit test pins to the real catalogues.
import type { CSSProperties } from "react";
import { HOME_MODULES } from "@/components/home/modules-list";
import { HOME_STATS } from "@/components/home/stats";
import { DEFINITION } from "./content";
import { CountUp } from "./count-up";
import { ScrollReveal } from "./scroll-reveal";

const HUES = ["attendance", "fees", "exams", "admissions", "parents", "learning", "office"] as const;
const hue = (i: number) => ({ "--hue": `var(--th-${HUES[i % HUES.length]})` }) as CSSProperties;

const STATS = [
  { n: HOME_STATS.modules, label: "modules", note: "Switch on only what you use." },
  { n: HOME_STATS.aiSkills, label: "AI skills", note: "Each one a switch, per role." },
  { n: HOME_STATS.roles, label: "roles", note: "Each sees only what it may." },
  { n: HOME_STATS.studyLanguages, label: "study languages", note: "For the student's assistant." },
] as const;

const categories = [...new Set(HOME_MODULES.map((m) => m.category))];
const half = Math.ceil(HOME_MODULES.length / 2);
const ROWS = [HOME_MODULES.slice(0, half), HOME_MODULES.slice(half)];

export function ProofStrip() {
  return (
    <section aria-labelledby="proof-title" className="relative border-y border-(color:--fos-line) bg-(color:--fos-bg-2) py-20 md:py-24">
      <ScrollReveal className="mx-auto grid w-full max-w-[1200px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div>
          <h2 id="proof-title" className="fos-eyebrow" data-reveal>
            What it is
          </h2>
          <p className="mt-5 text-xl leading-relaxed tracking-[-0.01em] text-(color:--fos-fg) md:text-[1.375rem]" data-reveal>
            {DEFINITION}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 lg:gap-x-10">
          {STATS.map((s, i) => (
            <div key={s.label} className="flex flex-col border-t border-(color:--fos-line-strong) pt-5" data-reveal style={hue(i + 2)}>
              <dd className="order-1 text-6xl leading-none font-medium tracking-[-0.05em] text-(color:--fos-fg) lg:text-7xl">
                <CountUp to={s.n} />
              </dd>
              <dt className="order-2 mt-3 flex items-center gap-2 font-medium text-(color:--fos-fg)">
                <span aria-hidden className="size-1.5 rounded-full bg-(color:--hue)" />
                {s.label}
              </dt>
              <dd className="order-3 mt-1 text-sm leading-snug text-(color:--fos-muted)">{s.note}</dd>
            </div>
          ))}
        </dl>
      </ScrollReveal>

      <div className="mt-16 grid gap-2.5" aria-label={`All ${HOME_MODULES.length} modules`} role="group">
        {ROWS.map((row, r) => (
          <div key={r} className="fos-marquee" data-dir={r ? "back" : undefined} style={{ "--dur": r ? "95s" : "80s" } as CSSProperties}>
            {[false, true].map((copy) => (
              <ul key={String(copy)} aria-hidden={copy || undefined}>
                {row.map((m) => (
                  <li key={m.key} className="fos-chip" style={hue(categories.indexOf(m.category))}>
                    {m.label}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
