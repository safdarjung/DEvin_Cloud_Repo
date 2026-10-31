import type { HeroBlock } from "@/modules/website/blocks";

export function Hero({ block }: { block: HeroBlock }) {
  return (
    <section className="grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-2 lg:gap-12">
      <div className="space-y-5">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{block.heading}</h1>
        {block.subheading && <p className="max-w-xl text-lg text-muted-foreground">{block.subheading}</p>}
        {block.cta && (
          <a
            href={block.cta.href}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
