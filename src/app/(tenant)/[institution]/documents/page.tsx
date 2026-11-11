import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ListPager } from "@/components/list-pager";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { DocumentRowActions, UploadForm } from "@/modules/documents/components/document-forms";
import { documentOwnerOptions, listDocuments, DOCUMENTS_PAGE_SIZE } from "@/modules/documents/queries";
import { ENTITY_TYPES } from "@/modules/documents/schemas";
import { formatBytes } from "@/modules/documents/upload-check";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

// Documents: the page floor is `document.write` (nav gate); download needs `document.read`.
// Storage is the private `tenant-docs` bucket, reached only through short-lived signed URLs. Backend is real, no simulation.
export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ type?: string; q?: string; page?: string; up?: string; oq?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  const canWrite = hasPermission(ctx, "document.write");
  const canRead = hasPermission(ctx, "document.read");
  if (!canWrite) throw new AppError("forbidden", "You do not have access to documents.");

  const type = (ENTITY_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type : undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const upType = sp.up === "staff" ? "staff" : "student";
  const oq = sp.oq?.trim() || "";

  const [listR, ownersR] = await Promise.allSettled([listDocuments(ctx, { entityType: type, q, page }), documentOwnerOptions(ctx, upType, oq)]);
  for (const r of [listR, ownersR]) if (r.status === "rejected") console.error("documents page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const owners = ownersR.status === "fulfilled" ? ownersR.value : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Student, staff and application files. Stored privately; downloads use a link that expires after 60 seconds." compact />
      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <div>
          <Label htmlFor="doc-type">Belongs to</Label>
          <select id="doc-type" name="type" defaultValue={type ?? ""} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">Everything</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="doc-q">Search file name or kind</Label>
          <Input id="doc-q" name="q" defaultValue={q} maxLength={60} className="w-64" />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {(q || type) && (
          <Link href={`/${slug}/documents`} className="text-sm underline">
            Clear
          </Link>
        )}
      </form>
      {listR.status === "rejected" ? (
        <ErrorState title="Could not load documents" description="Refresh to try again." />
      ) : listR.value.rows.length === 0 ? (
        <EmptyState title={q || type ? "No matching documents" : "No documents yet"} description={q || type ? "Try another filter." : "Upload the first one below."} />
      ) : (
        <div className="space-y-3">
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Belongs to</TableHead>
                    <TableHead className="hidden sm:table-cell">Kind</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Size</TableHead>
                    <TableHead className="hidden md:table-cell">Added</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listR.value.rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium break-all">{d.fileName}</TableCell>
                      <TableCell>
                        {d.entityLabel} <Badge variant="outline">{humanize(d.entityType)}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{d.kind}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{formatBytes(d.sizeBytes)}</TableCell>
                      <TableCell className="hidden md:table-cell">{dateFmt.format(new Date(d.createdAt))}</TableCell>
                      <TableCell>
                        <DocumentRowActions institutionSlug={slug} documentId={d.id} fileName={d.fileName} canRead={canRead} canWrite={canWrite} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <ListPager basePath={`/${slug}/documents`} params={{ type, q }} page={listR.value.page} total={listR.value.total} pageSize={DOCUMENTS_PAGE_SIZE} noun="documents" />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Upload a document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            {type && <input type="hidden" name="type" value={type} />}
            {q && <input type="hidden" name="q" value={q} />}
            <div>
              <Label htmlFor="up-type">For a</Label>
              <select id="up-type" name="up" defaultValue={upType} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="student">Student</option>
                <option value="staff">Staff member</option>
              </select>
            </div>
            <div>
              <Label htmlFor="up-q">Find by name{upType === "student" ? " or admission no." : ""}</Label>
              <Input id="up-q" name="oq" defaultValue={oq} maxLength={60} className="w-64" />
            </div>
            <Button type="submit" variant="outline">
              Find
            </Button>
          </form>
          {ownersR.status === "rejected" ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load the list. Refresh to try again.
            </p>
          ) : (
            <UploadForm key={`${upType}:${oq}`} institutionSlug={slug} entityType={upType} owners={owners} />
          )}
          <p className="text-xs text-muted-foreground">Application and submission files are attached from their own screens.</p>
        </CardContent>
      </Card>
    </div>
  );
}
