import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { formatDate, humanize } from "@/lib/format";
import { IssueCertificateForm } from "@/modules/certificates/components/IssueCertificateForm";
import { ID_CARD_MAX } from "@/modules/certificates/id-cards.queries";
import { listCertificates } from "@/modules/certificates/queries";
import { listSectionOptions } from "@/modules/exams/queries";

export const metadata: Metadata = { title: "Certificates" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 100;

// Certificates are append-only (issued rows are immutable): there are no edit or delete controls.
export default async function CertificatesPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ tab?: string; section?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "certificates");
  requirePermission(ctx, "certificate.manage");

  const [listR, sectionsR] = await Promise.allSettled([listCertificates(ctx, { limit: LIST_LIMIT }), listSectionOptions(ctx)]);
  for (const [l, r] of [["list", listR], ["sections", sectionsR]] as const) {
    if (r.status === "rejected") console.error(`certificates page ${l} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
  }
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const section = sp.section && UUID_RE.test(sp.section) && sections.some((s) => s.id === sp.section) ? sp.section : undefined;
  const printBase = `/${slug}/certificates/print`;

  return (
    <div className="space-y-6">
      <PageHeader title="Certificates and ID cards" description="Issue bonafide, character and transfer certificates, reprint them, and print class ID cards." />
      <Tabs defaultValue={sp.tab === "idcards" ? "idcards" : "issued"}>
        <TabsList>
          <TabsTrigger value="issued">Issued</TabsTrigger>
          <TabsTrigger value="idcards">ID cards</TabsTrigger>
        </TabsList>

        <TabsContent value="issued" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Issue a certificate</CardTitle>
              <CardDescription>Each certificate gets a serial number and cannot be edited or deleted afterwards.</CardDescription>
            </CardHeader>
            <CardContent>
              <IssueCertificateForm institutionSlug={slug} />
            </CardContent>
          </Card>
          <h2 className="text-base font-semibold">Issued certificates</h2>
          {listR.status === "rejected" ? (
            <ErrorState title="Could not load certificates" description="Refresh to try again." />
          ) : listR.value.length === 0 ? (
            <EmptyState title="No certificates issued yet" description="Issued certificates appear here with their serial numbers." />
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Serial</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead className="hidden sm:table-cell">Issued</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listR.value.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium tabular-nums">{c.serialNo}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{humanize(c.kind)}</Badge>
                        </TableCell>
                        <TableCell>
                          {c.studentName}
                          <span className="block text-xs text-muted-foreground">
                            {c.admissionNo}
                            {c.classLabel && ` · ${c.classLabel}`}
                          </span>
                        </TableCell>
                        <TableCell className="hidden tabular-nums sm:table-cell">{formatDate(c.issuedOn)}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="outline">
                            <a href={`${printBase}?cert=${c.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Open print view for ${c.serialNo}`}>
                              Print view
                            </a>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="idcards" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Class ID cards</CardTitle>
              <CardDescription>One printable card per active student, up to {ID_CARD_MAX} per class. Opens in a new tab; use the browser print dialog.</CardDescription>
            </CardHeader>
            <CardContent>
              {sectionsR.status === "rejected" ? (
                <ErrorState bare title="Could not load classes" description="Refresh to try again." />
              ) : sections.length === 0 ? (
                <EmptyState bare title="No class sections yet" description="Create sections in academics first." />
              ) : (
                <form method="get" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="tab" value="idcards" />
                  <div className="min-w-48">
                    <label htmlFor="idc-section" className="mb-1.5 block text-sm font-medium">
                      Class section
                    </label>
                    <select id="idc-section" name="section" defaultValue={section ?? ""} className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                      <option value="">Choose a section…</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" variant="outline">
                    Select
                  </Button>
                  {section && (
                    <Button asChild>
                      <a href={`${printBase}?section=${section}`} target="_blank" rel="noopener noreferrer">
                        Open printable cards
                      </a>
                    </Button>
                  )}
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
