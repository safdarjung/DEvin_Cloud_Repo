import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
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
    <div className="space-y-4">
      <PageHeader title="Events" description="Items marked public appear on the school website." back={{ href: `/${institutionSlug}/website`, label: "Website" }} />
      {events.length === 0 ? (
        <EmptyState title="No events yet" description="Add one below." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Starts at</TableHead>
              <TableHead className="text-right">Visibility</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{event.title}</TableCell>
                <TableCell>{new Date(event.startsAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={event.isPublic ? "success" : "outline"}>
                    {event.isPublic ? "Public" : "Internal"}
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
