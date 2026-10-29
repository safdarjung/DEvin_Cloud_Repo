import type { ContactBlock as ContactBlockType } from "@/modules/website/blocks";

export function Contact({ block }: { block: ContactBlockType }) {
  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-semibold">{block.heading ?? "Contact us"}</h2>
      <dl className="space-y-2 text-sm">
        {block.address && (
          <div>
            <dt className="text-muted-foreground inline">Address: </dt>
            <dd className="inline">{block.address}</dd>
          </div>
        )}
        {block.phone && (
          <div>
            <dt className="text-muted-foreground inline">Phone: </dt>
            <dd className="inline">
              <a href={`tel:${block.phone}`}>{block.phone}</a>
            </dd>
          </div>
        )}
        {block.email && (
          <div>
            <dt className="text-muted-foreground inline">Email: </dt>
            <dd className="inline">
              <a href={`mailto:${block.email}`}>{block.email}</a>
            </dd>
          </div>
        )}
        {block.mapUrl && (
          <div>
            <a href={block.mapUrl} className="text-primary underline">
              View on map
            </a>
          </div>
        )}
      </dl>
    </section>
  );
}
