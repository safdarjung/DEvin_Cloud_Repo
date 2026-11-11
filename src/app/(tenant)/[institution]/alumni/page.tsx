import { PageHeader } from "@/components/page-header";
import { ListPager } from "@/components/list-pager";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { AppError } from "@/lib/actions/result";
import { EditAlumniForm, SyncAlumniButton } from "@/modules/alumni/components/AlumniForms";
import { alumniFacets, listAlumni } from "@/modules/alumni/queries";
import { AlumniListSchema } from "@/modules/alumni/schemas";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

type Search = { q?: string; batch?: string; city?: string; page?: string };

export default async function AlumniPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<Search>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "alumni");
  if (!hasPermission(ctx, "alumni.read")) throw new AppError("forbidden", "You do not have access to the alumni directory.");
  const canManage = hasPermission(ctx, "alumni.manage");

  // Invalid filter values fall back to "no filter" rather than 500.
  const parsed = AlumniListSchema.safeParse({
    q: sp.q || undefined,
    batchYear: sp.batch ? Number(sp.batch) : undefined,
    city: sp.city || undefined,
    page: sp.page ? Number(sp.page) : undefined,
  });
  const filters = parsed.success ? parsed.data : {};

  const [listR, facetsR] = await Promise.allSettled([listAlumni(ctx, filters), alumniFacets(ctx)]);
  for (const r of [listR, facetsR]) if (r.status === "rejected") console.error("alumni page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const facets = facetsR.status === "fulfilled" ? facetsR.value : { batches: [], cities: [] };
  const filtered = Boolean(filters.q || filters.batchYear || filters.city);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alumni"
        description="Directory of passed-out students and how to reach them."
        actions={canManage ? <SyncAlumniButton institutionSlug={slug} /> : undefined}
      />

      {facets.batches.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Alumni per batch year">
          {facets.batches.map((b) => (
            <li key={b.batchYear} className="rounded-md border bg-card px-3 py-1.5 text-sm">
              <span className="font-medium tabular-nums">{b.batchYear}</span> <span className="text-muted-foreground tabular-nums">{b.count}</span>
            </li>
          ))}
        </ul>
      )}

      <form method="get" className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <div>
          <Label htmlFor="al-q">Search</Label>
          <Input id="al-q" name="q" defaultValue={sp.q ?? ""} placeholder="Name or admission no" />
        </div>
        <div>
          <Label htmlFor="al-batch">Batch year</Label>
          <select id="al-batch" name="batch" className={SELECT_CLASS} defaultValue={sp.batch ?? ""}>
            <option value="">All</option>
            {facets.batches.map((b) => (
              <option key={b.batchYear} value={b.batchYear}>
                {b.batchYear}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="al-city">City</Label>
          <select id="al-city" name="city" className={SELECT_CLASS} defaultValue={sp.city ?? ""}>
            <option value="">All</option>
            {facets.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {listR.status === "rejected" ? (
        <ErrorState title="Could not load alumni" description="Try again in a moment." />
      ) : listR.value.rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No alumni match these filters" : "No alumni yet"}
          description={
            filtered
              ? "Clear a filter or change the search."
              : canManage
                ? "Alumni appear once students are graduated through the year-end promotion. Use Sync from graduated students to bring them in."
                : "Alumni appear once students are graduated at year end."
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{listR.value.total} alumni</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Occupation</TableHead>
                  <TableHead>Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listR.value.rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.admissionNo}</div>
                      {canManage && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Edit contact details</summary>
                          <div className="mt-2 max-w-xl">
                            <EditAlumniForm institutionSlug={slug} alumni={a} />
                          </div>
                        </details>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{a.batchYear}</TableCell>
                    <TableCell>{a.city ?? "—"}</TableCell>
                    <TableCell>{a.occupation ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <div>{a.contactEmail ?? "—"}</div>
                      <div className="text-muted-foreground">{a.contactPhone ?? ""}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ListPager
              basePath={`/${slug}/alumni`}
              params={{ q: sp.q, batch: sp.batch, city: sp.city }}
              page={listR.value.page}
              total={listR.value.total}
              pageSize={listR.value.pageSize}
              noun="alumni"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
