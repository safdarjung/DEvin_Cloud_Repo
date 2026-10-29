import type { HeroBlock } from "@/modules/website/blocks";

export function Hero({ block }: { block: HeroBlock }) {
  return (
    <section className="space-y-4 py-12 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{block.heading}</h1>
      {block.subheading && <p className="text-muted-foreground mx-auto max-w-2xl text-lg">{block.subheading}</p>}
      {block.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- editor-authored image URL, not a static asset next/image can optimize at build time.
        <img src={block.imageUrl} alt="" className="mx-auto max-h-96 w-full rounded-lg object-cover" />
      )}
      {block.cta && (
        <a
          href={block.cta.href}
          className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium"
        >
          {block.cta.label}
        </a>
      )}
    </section>
  );
}
