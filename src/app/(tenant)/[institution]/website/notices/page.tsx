import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/widgets/viz";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { NoticeForm } from "@/modules/website/components/NoticeForm";
import { listNotices } from "@/modules/website/queries";

// Row entrance: CSS only, `from`-state held during the delay, skipped under reduced motion.
const ROW_ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-(--duration-slow)";
const rowDelay = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 25}ms` });

export default async function NoticesPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  requirePermission(ctx, "website.edit");

  const notices = await listNotices(ctx);
  const publicCount = notices.filter((x) => x.isPublic).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Notices" description="Items marked public appear on the school website." back={{ href: `/${institutionSlug}/website`, label: "Website" }} />
      <FadeIn className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 self-start lg:col-span-2">
          {notices.length > 0 && (
            <div className="border-b-2 border-border px-4 pb-3">
              <ProgressBar
                value={publicCount}
                max={notices.length}
                label="Shown on the public site"
                valueLabel={`${publicCount} of ${notices.length} notices`}
              />
            </div>
          )}
          <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
            {notices.length === 0 ? (
              <EmptyState title="No notices yet" description="Add one with the form." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Publish at</TableHead>
                    <TableHead className="text-right">Visibility</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notices.map((notice, i) => (
                    <TableRow key={notice.id} className={ROW_ENTER} style={rowDelay(i)}>
                      <TableCell>{notice.title}</TableCell>
                      <TableCell className="tabular-nums">{new Date(notice.publishAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={notice.isPublic ? "success" : "outline"}>
                          {notice.isPublic ? "Public" : "Internal"}
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
          <NoticeForm institutionSlug={institutionSlug} />
        </div>
      </FadeIn>
    </div>
  );
}
