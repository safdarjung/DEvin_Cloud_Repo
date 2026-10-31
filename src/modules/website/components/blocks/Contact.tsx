import type { ContactBlock as ContactBlockType } from "@/modules/website/blocks";

const link = "text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Contact({ block }: { block: ContactBlockType }) {
  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight">{block.heading ?? "Contact us"}</h2>
      <dl className="grid gap-4 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2">
        {block.address && (
          <div>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="mt-0.5">{block.address}</dd>
          </div>
        )}
        {block.phone && (
          <div>
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="mt-0.5">
              <a href={`tel:${block.phone}`} className={link}>{block.phone}</a>
            </dd>
          </div>
        )}
        {block.email && (
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="mt-0.5 break-all">
              <a href={`mailto:${block.email}`} className={link}>{block.email}</a>
            </dd>
          </div>
        )}
        {block.mapUrl && (
          <div>
            <dt className="text-muted-foreground">Location</dt>
            <dd className="mt-0.5">
              <a href={block.mapUrl} className={link}>View on map</a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
