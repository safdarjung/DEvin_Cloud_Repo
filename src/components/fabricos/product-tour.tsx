"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { CTA, SECTION, type VideoId } from "./content";
import { ProductVideo } from "./product-video";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = SECTION.showcase;

// Each step describes only what its recording shows (videos.ts).
const STEPS: readonly { video: VideoId; kicker: string; title: string; body: string; href: string; link: string; hue: string }[] = [
  {
    video: "overview",
    kicker: "The workspace",
    title: "One workspace for the whole day.",
    body: "The principal's dashboard, then admissions, attendance, finance and exams. Every screen reads the same records, so a number means the same thing wherever you meet it.",
    href: CTA.secondary.href,
    link: CTA.secondary.label,
    hue: "var(--fos-indigo)",
  },
  {
    video: "roles",
    kicker: "Roles",
    title: "Each person gets their own view.",
    body: "A class teacher opens today's classes. A parent opens a portal for their own children and nobody else's. Same records, different permissions.",
    href: "#roles",
    link: "Meet the five people",
    hue: "var(--th-parents)",
  },
  {
    video: "agents",
    kicker: "AI agents",
    title: "Agents that propose, not act.",
    body: "Every agent has a scope: what it may read, what it may suggest, and which suggestions need a person's approval before anything changes.",
    href: `#${SECTION.agents}`,
    link: "How agents work",
    hue: "var(--th-exams)",
  },
  {
    video: "automation",
    kicker: "Automation",
    title: "Workflows that wait for a person.",
    body: "A run proposes fee reminders, then holds. The principal approves or rejects it. Nothing is sent on its own.",
    href: `#${SECTION.automation}`,
    link: "See the steps",
    hue: "var(--th-fees)",
  },
  {
    video: "insights",
    kicker: "Insights",
    title: "Signals that show their evidence.",
    body: "Open an insight to see the records behind it, then compare attendance with marks across sections in the analysis lab.",
    href: `#${SECTION.insights}`,
    link: "What gets flagged",
    hue: "var(--th-attendance)",
  },
];

/** Scroll tour: the steps scroll past while one screen stays in view and plays the recording for the step at the middle of the window. */
export function ProductTour() {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const step = STEPS[active];

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    steps.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <SectionShell id={id} className="bg-(color:--fos-bg-2)" innerClassName="max-w-[1320px]">
      <ScrollReveal>
        <div className="max-w-3xl">
          <p className="fos-eyebrow" data-reveal>
            Product tour
          </p>
          <h2 id={`${id}-title`} className="fos-h2 mt-5" data-reveal>
            See it run. Scroll through a real school day.
          </h2>
          <p className="fos-lead mt-6" data-reveal>
            Five short recordings of the running app, with a demo school&apos;s sample data. Scroll, and the screen follows the story.
          </p>
        </div>
      </ScrollReveal>

      <div className="mt-10 lg:mt-4 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
        <div className="sticky top-16 z-10 -mx-5 bg-(color:--fos-bg-2) px-5 pt-3 pb-4 sm:-mx-8 sm:px-8 lg:top-[13vh] lg:order-2 lg:mx-0 lg:self-start lg:bg-transparent lg:p-0" style={{ "--hue": step.hue } as CSSProperties}>
          <div className="rounded-(--fos-radius) shadow-[0_50px_140px_-50px_var(--hue)] transition-shadow duration-700 max-lg:[&_figcaption]:hidden">
            <ProductVideo key={step.video} id={step.video} variant="loop" className="fos-swap" />
          </div>
          <div className="mt-4 flex items-center gap-2" role="group" aria-label="Tour steps">
            {STEPS.map((s, i) => (
              <button
                key={s.video}
                type="button"
                aria-label={`Step ${i + 1}: ${s.kicker}`}
                aria-current={i === active ? "step" : undefined}
                onClick={() => steps.current[i]?.scrollIntoView({ block: "center" })}
                className="group grid h-6 flex-1 place-items-center lg:h-8"
              >
                <span className={cn("h-0.5 w-full rounded-full transition-colors duration-500", i === active ? "bg-(color:--hue)" : "bg-(color:--fos-line-strong) group-hover:bg-(color:--fos-faint)")} />
              </button>
            ))}
          </div>
        </div>

        <ol className="lg:order-1">
          {STEPS.map((s, i) => (
            <li
              key={s.video}
              ref={(el) => {
                steps.current[i] = el;
              }}
              data-step={i}
              style={{ "--hue": s.hue } as CSSProperties}
              className={cn("flex min-h-[58vh] flex-col justify-center py-8 transition-opacity duration-500 lg:min-h-[72vh]", i === active ? "opacity-100" : "opacity-35")}
            >
              <p className="flex items-center gap-3 font-(family-name:--fos-font-mono) text-xs tracking-[0.08em] text-(color:--hue) uppercase">
                <span className="text-(color:--fos-faint)">0{i + 1}</span>
                {s.kicker}
              </p>
              <h3 className="mt-4 text-3xl leading-[1.08] font-medium tracking-[-0.03em] text-(color:--fos-fg) md:text-[2.5rem]">{s.title}</h3>
              <p className="mt-4 max-w-[44ch] text-lg leading-relaxed text-(color:--fos-muted)">{s.body}</p>
              <Link href={s.href} className="mt-6 inline-flex min-h-11 w-fit items-center gap-2 font-medium text-(color:--fos-fg) underline decoration-(--hue) decoration-2 underline-offset-[0.4em] hover:text-(color:--hue)">
                {s.link}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </SectionShell>
  );
}
