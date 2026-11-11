import type { Metadata } from "next";
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
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { AppError } from "@/lib/actions/result";
import { humanize } from "@/lib/format";
import { listSectionOptions } from "@/modules/exams/queries";
import { listStudents } from "@/modules/people/queries";
import { LogIncidentForm, VoidIncidentButton } from "@/modules/behaviour/components/BehaviourForms";
import { BEHAVIOUR_PAGE_SIZE, listIncidents, studentPointTotals } from "@/modules/behaviour/queries";
import { IncidentListSchema } from "@/modules/behaviour/schemas";

export const metadata: Metadata = { title: "Behaviour" };

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const SEVERITY_VARIANT = { low: "outline", medium: "warning", high: "destructive" } as const;

type Search = { section?: string; category?: string; from?: string; to?: string; page?: string; q?: string };

export default async function BehaviourPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<Search>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "behaviour");
  if (!hasPermission(ctx, "behaviour.write")) throw new AppError("forbidden", "You do not have access to behaviour records.");

  // Invalid filter values fall back to "no filter" rather than 500.
  const parsed = IncidentListSchema.safeParse({
    sectionId: sp.section || undefined,
    category: sp.category || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    page: sp.page ? Number(sp.page) : undefined,
  });
  const filters = parsed.success ? parsed.data : {};

  const [listR, totalsR, sectionsR, studentsR] = await Promise.allSettled([
    listIncidents(ctx, filters),
    studentPointTotals(ctx, filters),
    listSectionOptions(ctx),
    listStudents(ctx, sp.q, 1, { status: "active" }),
  ]);
  for (const r of [listR, totalsR, sectionsR, studentsR]) if (r.status === "rejected") console.error("behaviour page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const students = studentsR.status === "fulfilled" ? studentsR.value.students.map((s) => ({ id: s.id, label: `${[s.firstName, s.lastName].filter(Boolean).join(" ")} (${s.admissionNo}${s.sectionName ? `, ${s.gradeName ?? ""}-${s.sectionName}` : ""})` })) : [];
  const isAdmin = ["owner", "principal", "admin"].includes(ctx.membership.role);

  return (
    <div className="space-y-6">
      <PageHeader title="Behaviour" description="Log merit and demerit incidents. Records are append-only; a mistake is voided with a reason, never deleted." />

      <Card>
        <CardHeader>
          <CardTitle>Log incident</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex items-end gap-2">
            {/* Narrows the student picker below; keeps the list filters. */}
            {Object.entries({ section: sp.section, category: sp.category, from: sp.from, to: sp.to }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
            <div className="flex-1">
              <Label htmlFor="bh-q">Find student</Label>
              <Input id="bh-q" name="q" defaultValue={sp.q} placeholder="Name or admission no" />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          <LogIncidentForm institutionSlug={slug} students={students} />
        </CardContent>
      </Card>

      <form method="get" className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <div>
          <Label htmlFor="f-section">Section</Label>
          <select id="f-section" name="section" defaultValue={sp.section ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="f-category">Category</Label>
          <Input id="f-category" name="category" defaultValue={sp.category} maxLength={40} />
        </div>
        <div>
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={sp.from} />
        </div>
        <div>
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={sp.to} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <Button asChild variant="ghost">
            <Link href={`/${slug}/behaviour`}>Clear</Link>
          </Button>
        </div>
      </form>

      <section aria-labelledby="bh-totals" className="space-y-3">
        <h2 id="bh-totals" className="text-base font-semibold">
          Points by student
        </h2>
        {totalsR.status === "rejected" ? (
          <ErrorState title="Could not load totals" description="Refresh to try again." />
        ) : totalsR.value.length === 0 ? (
          <EmptyState title="No points recorded" description="Totals appear once incidents match the filters." />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Merit</TableHead>
                    <TableHead className="text-right">Demerit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totalsR.value.slice(0, 50).map((t) => (
                    <TableRow key={t.studentId}>
                      <TableCell className="font-medium">{t.studentName}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.merit}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.demerit}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{t.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="bh-list" className="space-y-3">
        <h2 id="bh-list" className="text-base font-semibold">
          Incidents
        </h2>
        {listR.status === "rejected" ? (
          <ErrorState title="Could not load incidents" description="Refresh to try again." />
        ) : listR.value.rows.length === 0 ? (
          <EmptyState title="No incidents" description="Nothing matches these filters yet." />
        ) : (
          <>
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="hidden md:table-cell">Note</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listR.value.rows.map((r) => (
                      <TableRow key={r.id} className={r.voidedAt ? "opacity-60" : undefined}>
                        <TableCell className="tabular-nums">{r.occurredOn}</TableCell>
                        <TableCell className="font-medium">{r.studentName}</TableCell>
                        <TableCell>{r.category}</TableCell>
                        <TableCell>
                          <Badge variant={SEVERITY_VARIANT[r.severity as keyof typeof SEVERITY_VARIANT] ?? "outline"}>{humanize(r.severity)}</Badge>
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${r.voidedAt ? "line-through" : ""}`}>{r.points > 0 ? `+${r.points}` : r.points}</TableCell>
                        <TableCell className="hidden max-w-xs truncate md:table-cell">{r.note}</TableCell>
                        <TableCell className="text-right">
                          {r.voidedAt ? (
                            <Badge variant="outline" title={r.voidReason ?? undefined}>
                              Voided: {r.voidReason}
                            </Badge>
                          ) : isAdmin || r.reportedByMe ? (
                            <VoidIncidentButton institutionSlug={slug} incidentId={r.id} />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <ListPager basePath={`/${slug}/behaviour`} params={{ section: sp.section, category: sp.category, from: sp.from, to: sp.to }} page={listR.value.page} total={listR.value.total} pageSize={BEHAVIOUR_PAGE_SIZE} noun="incidents" />
          </>
        )}
      </section>
    </div>
  );
}
