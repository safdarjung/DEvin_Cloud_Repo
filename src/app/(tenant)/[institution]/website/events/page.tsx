import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/widgets/viz";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { EventForm } from "@/modules/website/components/EventForm";
import { listEvents } from "@/modules/website/queries";

export const metadata: Metadata = { title: "Events" };

// Row entrance: CSS only, `from`-state held during the delay, skipped under reduced motion.
const ROW_ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-(--duration-slow)";
const rowDelay = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 25}ms` });

export default async function EventsPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  requirePermission(ctx, "website.edit");

  const events = await listEvents(ctx);
  const publicCount = events.filter((x) => x.isPublic).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Events" description="Items marked public appear on the school website." back={{ href: `/${institutionSlug}/website`, label: "Website" }} />
      <FadeIn className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 self-start lg:col-span-2">
          {events.length > 0 && (
            <div className="border-b-2 border-border px-4 pb-3">
              <ProgressBar
                value={publicCount}
                max={events.length}
                label="Shown on the public site"
                valueLabel={`${publicCount} of ${events.length} events`}
              />
            </div>
          )}
          <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
            {events.length === 0 ? (
              <EmptyState title="No events yet" description="Add one with the form." />
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
                  {events.map((event, i) => (
                    <TableRow key={event.id} className={ROW_ENTER} style={rowDelay(i)}>
                      <TableCell>{event.title}</TableCell>
                      <TableCell className="tabular-nums">{new Date(event.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</TableCell>
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
          </CardContent>
        </Card>
        <div className="min-w-0 self-start">
          <EventForm institutionSlug={institutionSlug} />
        </div>
      </FadeIn>
    </div>
  );
}
