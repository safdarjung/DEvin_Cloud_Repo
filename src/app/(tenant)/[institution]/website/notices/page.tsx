import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { NoticeForm } from "@/modules/website/components/NoticeForm";
import { listNotices } from "@/modules/website/queries";

export default async function NoticesPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "website.edit");

  const notices = await listNotices(ctx);

  return (
    <div className="space-y-4">
      <PageHeader title="Notices" description="Items marked public appear on the school website." back={{ href: `/${institutionSlug}/website`, label: "Website" }} />
      {notices.length === 0 ? (
        <EmptyState title="No notices yet" description="Add one below." />
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
                <TableCell>{new Date(notice.publishAt).toLocaleString()}</TableCell>
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
      <NoticeForm institutionSlug={institutionSlug} />
    </div>
  );
}
