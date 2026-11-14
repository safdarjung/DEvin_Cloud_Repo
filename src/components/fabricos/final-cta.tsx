import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CTA, FINAL_CTA } from "./content";
import { ScrollReveal } from "./scroll-reveal";

const id = "get-started";

export function FinalCta() {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="relative overflow-hidden border-t border-(color:--fos-line) bg-[radial-gradient(70%_80%_at_50%_100%,rgb(75_82_200_/_0.28),transparent_70%)] py-28 md:py-44"
    >
      <ScrollReveal className="mx-auto max-w-[1000px] px-5 text-center sm:px-8">
        <h2 id={`${id}-title`} className="text-[clamp(2.25rem,1.4rem+3.6vw,4.5rem)] leading-[1.02] font-medium tracking-[-0.04em] text-balance" data-reveal>
          {FINAL_CTA.title}
        </h2>
        <p className="fos-lead mx-auto mt-7" data-reveal>
          {FINAL_CTA.lead}
        </p>
        <div className="mt-11 flex flex-wrap justify-center gap-3" data-reveal>
          <Link href={CTA.primary.href} className="fos-btn fos-btn-primary">
            {CTA.primary.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href={CTA.secondary.href} className="fos-btn fos-btn-ghost">
            {CTA.secondary.label}
          </Link>
        </div>
      </ScrollReveal>
    </section>
  );
}
