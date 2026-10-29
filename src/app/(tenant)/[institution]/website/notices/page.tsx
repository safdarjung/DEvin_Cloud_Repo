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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Notices</h1>
      {notices.length === 0 ? (
        <p className="text-muted-foreground text-sm">No notices yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Publish at</TableHead>
              <TableHead>Visibility</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {notices.map((notice) => (
              <TableRow key={notice.id}>
                <TableCell>{notice.title}</TableCell>
                <TableCell>{new Date(notice.publishAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={notice.isPublic ? "default" : "secondary"}>
                    {notice.isPublic ? "public" : "internal"}
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
