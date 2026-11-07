import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule } from "@/lib/auth/require";
import { NoticeForm } from "@/modules/website/components/NoticeForm";
import { listNotices } from "@/modules/website/queries";

export default async function NoticesPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  requirePermission(ctx, "website.edit");

  const notices = await listNotices(ctx);

  return (
    <div className="space-y-4">
      <PageHeader title="Notices" description="Items marked public appear on the school website." back={{ href: `/${institutionSlug}/website`, label: "Website" }} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 self-start lg:col-span-2">
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
                  {notices.map((notice) => (
                    <TableRow key={notice.id}>
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
      </div>
    </div>
  );
}
