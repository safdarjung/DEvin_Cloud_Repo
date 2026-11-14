import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CTA, SECTION } from "./content";
import { ScrollReveal } from "./scroll-reveal";

const id = SECTION.tour;

/** The brand weave at loom scale: warp passes over weft on alternating crossings. */
function Weave() {
  const n = 9;
  const step = 30;
  const end = step * (n + 1);
  const gap = 7;
  // Weft is on top where (row + col) is even; each thread is cut where it passes under.
  const weftOver = (r: number, c: number) => (r + c) % 2 === 0;
  const thread = (fixed: number, horizontal: boolean, cutAt: (i: number) => boolean) => {
    let d = "";
    let from = 0;
    for (let i = 1; i <= n; i++) {
      if (!cutAt(i)) continue;
      const to = i * step - gap;
      d += horizontal ? `M${from} ${fixed}H${to}` : `M${fixed} ${from}V${to}`;
      from = i * step + gap;
    }
    return d + (horizontal ? `M${from} ${fixed}H${end}` : `M${fixed} ${from}V${end}`);
  };
  let weft = "";
  let warp = "";
  for (let k = 1; k <= n; k++) {
    weft += thread(k * step, true, (c) => !weftOver(k, c));
    warp += thread(k * step, false, (r) => weftOver(r, k));
  }
  return (
    <svg viewBox={`0 0 ${end} ${end}`} className="h-auto w-full [mask-image:radial-gradient(closest-side,black_40%,transparent)]" fill="none" strokeLinecap="round" strokeWidth="3">
      <defs>
        <linearGradient id="fos-weave" x1="0" y1="0" x2="0" y2={end} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67d7ea" />
          <stop offset="1" stopColor="#8b93ff" />
        </linearGradient>
      </defs>
      <path d={weft} stroke="rgb(238 240 246 / 0.35)" />
      <path d={warp} stroke="url(#fos-weave)" strokeOpacity="0.75" />
    </svg>
  );
}

export function TourCta() {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="relative scroll-mt-20 px-5 py-12 sm:px-8 md:py-20">
      <ScrollReveal className="relative mx-auto max-w-[1200px]">
        <div data-reveal-clip className="relative isolate overflow-hidden rounded-[28px] border border-(color:--fos-line-strong) bg-[linear-gradient(120deg,var(--fos-navy),var(--fos-bg)_60%)] px-6 py-14 sm:px-12 md:py-20">
          <div aria-hidden className="absolute inset-y-0 right-[-2%] -z-10 hidden w-[44%] max-w-[480px] items-center md:flex">
            <div data-parallax="6" className="w-full">
              <Weave />
            </div>
          </div>
          <div className="max-w-xl">
            <h2 id={`${id}-title`} className="fos-h2" data-reveal>
              Walk through a school day, one role at a time.
            </h2>
            <p className="fos-lead mt-5" data-reveal>
              The product tour walks through a 3D school and shows how the principal, administrator, teacher, student and parent each use FabricOS.
            </p>
            <div className="mt-9" data-reveal>
              <Link href={CTA.tour.href} className="fos-btn fos-btn-primary">
                {CTA.tour.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
