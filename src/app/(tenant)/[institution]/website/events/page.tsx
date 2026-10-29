import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { EventForm } from "@/modules/website/components/EventForm";
import { listEvents } from "@/modules/website/queries";

export default async function EventsPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "website.edit");

  const events = await listEvents(ctx);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Events</h1>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No events yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Starts at</TableHead>
              <TableHead>Visibility</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{event.title}</TableCell>
                <TableCell>{new Date(event.startsAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={event.isPublic ? "default" : "secondary"}>
                    {event.isPublic ? "public" : "internal"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <EventForm institutionSlug={institutionSlug} />
    </div>
  );
}
