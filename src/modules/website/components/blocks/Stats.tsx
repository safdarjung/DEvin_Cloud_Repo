import type { StatsBlock } from "@/modules/website/blocks";

export function Stats({ block }: { block: StatsBlock }) {
  return (
    <section className="py-8">
      {block.heading && <h2 className="mb-4 text-center text-2xl font-semibold">{block.heading}</h2>}
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
        {block.items.map((item, index) => (
          <div key={index} className="text-center">
            <div className="text-3xl font-bold">{item.value}</div>
            <div className="text-muted-foreground text-sm">{item.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
