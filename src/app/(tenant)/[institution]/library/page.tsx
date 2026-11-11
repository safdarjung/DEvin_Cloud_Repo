import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { inr } from "@/lib/format";
import { AddBookForm, AddCopyForm, IssueLoanForm, LoanRowActions, ReturnByNumberForm } from "@/modules/library/components/library-forms";
import { libraryCatalog, libraryOverdue } from "@/modules/library/queries";
import { listStudents } from "@/modules/people/queries";

const SECTIONS = [
  { id: "catalogue", label: "Catalogue" },
  { id: "loans", label: "Loans" },
];

// Library: every control needs `library.manage` (the page floor); the module's backend is real, no simulation.
export default async function LibraryPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ section?: string; q?: string; bq?: string }> }) {
  const { institution: slug } = await params;
  const { section, q, bq } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "library");
  if (!hasPermission(ctx, "library.manage")) throw new AppError("forbidden", "You do not have access to the library.");
  const active = section === "loans" ? "loans" : "catalogue";
  return (
    <div className="space-y-4">
      <PageHeader title="Library" description="Books, copies and loans." compact />
      <SectionSwitcher basePath={`/${slug}/library`} sections={SECTIONS} activeId={active} />
      {active === "catalogue" ? <CatalogueTab ctx={ctx} slug={slug} q={q?.trim() || undefined} /> : <LoansTab ctx={ctx} slug={slug} bq={bq?.trim() || undefined} />}
    </div>
  );
}

async function CatalogueTab({ ctx, slug, q }: { ctx: TenantContext; slug: string; q?: string }) {
  const rows = await libraryCatalog(ctx, { q, limit: 100 }).catch((e) => {
    console.error("library catalogue failed:", e instanceof Error ? e.message : e);
    return null;
  });
  return (
    <div className="space-y-6">
      <form method="get" className="flex items-end gap-2" role="search">
        <input type="hidden" name="section" value="catalogue" />
        <div>
          <Label htmlFor="cat-q">Search title, author or ISBN</Label>
          <Input id="cat-q" name="q" defaultValue={q} maxLength={60} className="w-64" />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {q && (
          <Link href={`/${slug}/library?section=catalogue`} className="text-sm underline">
            Clear
          </Link>
        )}
      </form>
      {rows === null ? (
        <ErrorState title="Could not load the catalogue" description="Refresh to try again." />
      ) : rows.length === 0 ? (
        <EmptyState title={q ? "No matching books" : "No books yet"} description={q ? "Try another search." : "Add the first book below."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden sm:table-cell">Author</TableHead>
                  <TableHead className="hidden md:table-cell">ISBN</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>
                    <span className="sr-only">Add copy</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.title}</TableCell>
                    <TableCell className="hidden sm:table-cell">{b.author}</TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">{b.isbn ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant={b.available > 0 ? "success" : "outline"}>
                        {b.available} / {b.copies}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <AddCopyForm institutionSlug={slug} bookId={b.id} title={b.title} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Add a book</CardTitle>
        </CardHeader>
        <CardContent>
          <AddBookForm institutionSlug={slug} />
        </CardContent>
      </Card>
    </div>
  );
}

async function LoansTab({ ctx, slug, bq }: { ctx: TenantContext; slug: string; bq?: string }) {
  const [overdueR, studentsR] = await Promise.allSettled([libraryOverdue(ctx, { limit: 200 }), bq ? listStudents(ctx, bq, 1) : Promise.resolve(null)]);
  for (const r of [overdueR, studentsR]) if (r.status === "rejected") console.error("library loans fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const students = studentsR.status === "fulfilled" && studentsR.value ? studentsR.value.students.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName ?? ""} (${s.admissionNo})`.replace("  ", " ") })) : [];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Issue a book</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex items-end gap-2" role="search">
            <input type="hidden" name="section" value="loans" />
            <div>
              <Label htmlFor="borrower-q">Find student (name or admission no.)</Label>
              <Input id="borrower-q" name="bq" defaultValue={bq} maxLength={60} className="w-64" />
            </div>
            <Button type="submit" variant="outline">
              Find
            </Button>
          </form>
          {bq && students.length === 0 && studentsR.status === "fulfilled" && <p className="text-sm text-muted-foreground">No student matches that search.</p>}
          <IssueLoanForm institutionSlug={slug} students={students} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Return a book</CardTitle>
        </CardHeader>
        <CardContent>
          <ReturnByNumberForm institutionSlug={slug} />
        </CardContent>
      </Card>
      <section aria-labelledby="lib-overdue" className="space-y-3">
        <h2 id="lib-overdue" className="text-base font-semibold">
          Overdue
        </h2>
        {overdueR.status === "rejected" ? (
          <ErrorState title="Could not load overdue loans" description="Refresh to try again." />
        ) : overdueR.value.length === 0 ? (
          <EmptyState title="Nothing overdue" description="Every open loan is within its due date." />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Book</TableHead>
                    <TableHead>Borrower</TableHead>
                    <TableHead className="text-right">Days late</TableHead>
                    <TableHead className="text-right">Fine</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueR.value.map((l) => (
                    <TableRow key={l.loanId}>
                      <TableCell className="font-medium">
                        {l.title}
                        <span className="block text-xs font-normal text-muted-foreground">{l.accessionNo}</span>
                      </TableCell>
                      <TableCell>
                        {l.borrowerName}
                        <span className="block text-xs text-muted-foreground">{l.borrowerRef}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.daysOverdue}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(l.fineSoFar / 100)}</TableCell>
                      <TableCell>
                        <LoanRowActions institutionSlug={slug} accessionNo={l.accessionNo} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
