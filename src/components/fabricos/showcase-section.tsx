import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CTA, SECTION } from "./content";
import { ProductVideo } from "./product-video";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = SECTION.showcase;

export function ShowcaseSection() {
  return (
    <SectionShell id={id} className="bg-(color:--fos-bg-2)" innerClassName="max-w-[1320px]">
      <ScrollReveal>
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h2 id={`${id}-title`} className="fos-h2" data-reveal>
              See FabricOS in action
            </h2>
            <p className="fos-lead mt-6" data-reveal>
              One workspace where records, approvals and AI drafts sit side by side. Open the live demo, or walk through a school day in the product tour.
            </p>
          </div>
          <div className="flex flex-wrap gap-3" data-reveal>
            <Link href={CTA.secondary.href} className="fos-btn fos-btn-primary">
              {CTA.secondary.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href={CTA.tour.href} className="fos-btn fos-btn-ghost">
              {CTA.tour.label}
            </Link>
          </div>
        </div>
        <div
          data-reveal-clip
          className="fos-media mt-14 overflow-hidden rounded-[20px] border border-(color:--fos-line-strong) bg-(color:--fos-surface) shadow-[0_40px_120px_-40px_rgb(75_82_200_/_0.55)]"
        >
          <ProductVideo id="overview" variant="showcase" />
        </div>
      </ScrollReveal>
    </SectionShell>
  );
}
