import type { EventListBlock } from "@/modules/website/blocks";
import { listPublicEvents } from "@/modules/website/queries";

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export async function EventList({ block, institutionId }: { block: EventListBlock; institutionId: string }) {
  const events = await listPublicEvents(institutionId, block.limit ?? 4);
  if (events.length === 0) return null;

  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight">{block.heading ?? "Upcoming events"}</h2>
      <ul className="divide-y rounded-xl border bg-card">
        {events.map((event) => (
          <li key={event.id} className="space-y-1 p-4">
            <h3 className="font-medium">{event.title}</h3>
            <p className="text-sm text-muted-foreground">
              {dateTimeFormat.format(new Date(event.startsAt))}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
