import type { HeroBlock } from "@/modules/website/blocks";

// Hero style comes from the themed wrapper's `data-hero` (theme.ts
// THEMED_SITE_CLASS / `group/site`): split (default), centered, banner.
// `slug` set on the public site: a site-relative CTA ("/admissions") gets the `/s/<slug>` prefix, like the nav (layout.tsx).
export function Hero({ block, slug }: { block: HeroBlock; slug?: string }) {
  const href = block.cta && slug && block.cta.href.startsWith("/") && !block.cta.href.startsWith(`/s/${slug}`) ? `/s/${slug}${block.cta.href === "/" ? "" : block.cta.href}` : block.cta?.href;
  return (
    <section className="grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-2 lg:gap-12 group-data-[hero=banner]/site:my-6 group-data-[hero=banner]/site:rounded-xl group-data-[hero=banner]/site:bg-primary group-data-[hero=banner]/site:px-6 group-data-[hero=banner]/site:text-primary-foreground sm:group-data-[hero=banner]/site:px-10 group-data-[hero=centered]/site:text-center lg:group-data-[hero=centered]/site:grid-cols-1">
      <div className="space-y-5 group-data-[hero=centered]/site:mx-auto group-data-[hero=centered]/site:max-w-2xl">
        <span aria-hidden className="block h-1 w-12 rounded-full bg-accent group-data-[hero=centered]/site:mx-auto" />
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{block.heading}</h1>
        {block.subheading && (
          <p className="max-w-xl text-lg text-muted-foreground group-data-[hero=banner]/site:text-primary-foreground/85 group-data-[hero=centered]/site:mx-auto">
            {block.subheading}
          </p>
        )}
        {block.cta && (
          <a
            href={href}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group-data-[hero=banner]/site:bg-primary-foreground group-data-[hero=banner]/site:text-primary group-data-[hero=banner]/site:hover:bg-primary-foreground/90"
          >
            {block.cta.label}
          </a>
        )}
      </div>
      {block.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- editor-authored image URL, not a static asset next/image can optimize at build time.
        <img src={block.imageUrl} alt="" className="aspect-[4/3] w-full rounded-xl border object-cover shadow-sm" />
      )}
    </section>
  );
}
