import type { EventListBlock } from "@/modules/website/blocks";
import { listPublicEvents } from "@/modules/website/queries";

export async function EventList({ block, institutionId }: { block: EventListBlock; institutionId: string }) {
  const events = await listPublicEvents(institutionId, block.limit ?? 4);
  if (events.length === 0) return null;

  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-semibold">{block.heading ?? "Upcoming events"}</h2>
      <ul className="space-y-3">
        {events.map((event) => (
          <li key={event.id} className="rounded-lg border p-4">
            <div className="font-medium">{event.title}</div>
            <div className="text-muted-foreground text-sm">
              {new Date(event.startsAt).toLocaleString()}
              {event.location ? ` · ${event.location}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
