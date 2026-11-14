// On the overview page: points visitors to Fabric Vision, the loom story that is the home page (/).
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { HOME_STATS } from "@/components/home/stats";
import { CTA } from "./content";
import { ScrollReveal } from "./scroll-reveal";

const id = "vision";

// What the Fabric Vision page holds, section by section (src/components/home/Home.tsx).
const INSIDE = [
  "Seven everyday problems, each followed through to the fix",
  "Story films of real school days",
  "Five people, each with a one-click demo",
  `All ${HOME_STATS.aiSkills} AI skills on a ball you can spin`,
  `All ${HOME_STATS.modules} modules laid out as one quilt`,
] as const;

export function VisionCta() {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="relative scroll-mt-20 px-5 py-12 sm:px-8 md:py-16">
      <ScrollReveal className="relative mx-auto max-w-[1200px]">
        <div
          data-reveal-clip
          className="grid gap-10 rounded-[28px] border border-(color:--fos-line-strong) bg-[linear-gradient(240deg,var(--fos-navy),var(--fos-bg)_60%)] px-6 py-12 sm:px-12 md:grid-cols-[1.1fr_1fr] md:items-center md:py-16"
        >
          <div>
            <p className="fos-eyebrow" data-reveal>
              Fabric Vision
            </p>
            <h2 id={`${id}-title`} className="fos-h2 mt-3" data-reveal>
              Want every feature in detail?
            </h2>
            <p className="fos-lead mt-5" data-reveal>
              Fabric Vision is the long read. It takes the loose threads of running a school one at a time and shows how FabricOS ties each one off.
            </p>
            <div className="mt-9" data-reveal>
              <Link href={CTA.vision.href} className="fos-btn fos-btn-primary">
                {CTA.vision.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
          <ul className="grid gap-3" aria-label="Inside Fabric Vision" data-reveal>
            {INSIDE.map((item) => (
              <li key={item} className="flex items-start gap-3 text-(color:--fos-muted)">
                <Check className="mt-1 size-4 shrink-0 text-(color:--fos-cyan)" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </ScrollReveal>
    </section>
  );
}
