import type { StatsBlock } from "@/modules/website/blocks";

export function Stats({ block }: { block: StatsBlock }) {
  return (
    <section className="py-8">
      {block.heading && <h2 className="mb-5 text-2xl font-semibold tracking-tight">{block.heading}</h2>}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {block.items.map((item, index) => (
          <div key={index} className="bg-card p-5">
            <dd className="text-3xl font-semibold tracking-tight">{item.value}</dd>
            <dt className="mt-1 text-sm text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
