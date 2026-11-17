import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listSectionOptions } from "@/modules/exams/queries";
import { BulkActions, BulkCheckbox } from "@/modules/finance/components/BulkActions";
import { listGradeOptions, listTermOptions } from "@/modules/finance/queries";
import { humanize } from "@/lib/format";
import { addStudentHref } from "@/modules/people/add-student";
import { studentStatusVariant } from "@/modules/people/components/StudentProfileHeader";
import { listStudents } from "@/modules/people/queries";
import { StudentListFiltersSchema } from "@/modules/people/schemas";

export const metadata: Metadata = { title: "Students" };

const STATUSES = ["active", "alumni", "withdrawn"] as const;
const SELECT_CLASS = "h-10 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3 text-sm sm:h-9 sm:flex-none";

// Row entrance: CSS only, `from`-state held during the delay, skipped under reduced motion.
const ROW_ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-(--duration-slow)";
const rowDelay = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 25}ms` });

// T-028 — 07 §2.2 student.read is granted to teacher/student/guardian
// scoped ("s") by RLS, but this staff list page is staff-only: a
// student/guardian belongs in the portal (T-034), not here (packet rule,
// same page-level-guard shape as attendance's per-section check).
export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ q?: string; page?: string; gradeId?: string; sectionId?: string; status?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const sp = await searchParams;
  const { q, page } = sp;
  // Invalid/empty filter params are dropped, never passed to the query.
  const parsed = StudentListFiltersSchema.safeParse({
    gradeId: sp.gradeId || undefined,
    sectionId: sp.sectionId || undefined,
    status: sp.status || undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") notFound();

  const pageNum = Number(page) || 1;
  const canInvoice = hasPermission(ctx, "finance.invoice.generate") && isModuleEnabled(ctx, "fees");
  const [grades, sections, terms] = await Promise.all([
    listGradeOptions(ctx).catch(() => []),
    listSectionOptions(ctx).catch(() => []),
    canInvoice ? listTermOptions(ctx).catch(() => []) : Promise.resolve([]),
  ]);
  const selectable = canInvoice && terms.length > 0;
  const filterQs = new URLSearchParams(
    Object.entries({ q, ...filters }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  // Phase 2 review (MEDIUM): a search query can still fail (e.g. a DB
  // outage, or some future special character this page's escaping doesn't
  // anticipate) — show an empty state with the error message instead of
  // crashing the whole page.
  let students: Awaited<ReturnType<typeof listStudents>>["students"] = [];
  let total = 0;
  let pageSize = 50;
  let loadError: string | null = null;
  try {
    ({ students, total, pageSize } = await listStudents(ctx, q, pageNum, filters));
  } catch {
    loadError = "Could not load students. Try a simpler search.";
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const addStudent = addStudentHref(ctx, institutionSlug);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Students"
        description={`${total} enrolled and past students`}
        actions={
          addStudent && (
            <Button asChild>
              <Link href={addStudent.href}>{addStudent.label}</Link>
            </Button>
          )
        }
      />

      <Card>
        <form method="get" role="search" className="flex flex-col gap-2 border-b-2 border-border px-4 pb-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-xl">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q ?? ""} placeholder="Search by name or admission no (e.g. ADM/2026/00001)" aria-label="Search students" className="pl-9" />
          </div>
          <select name="gradeId" defaultValue={filters.gradeId ?? ""} aria-label="Filter by grade" className={SELECT_CLASS}>
            <option value="">All grades</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <select name="sectionId" defaultValue={filters.sectionId ?? ""} aria-label="Filter by section" className={SELECT_CLASS}>
            <option value="">All sections</option>
            {sections.filter((s) => !filters.gradeId || s.gradeId === filters.gradeId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={filters.status ?? ""} aria-label="Filter by status" className={SELECT_CLASS}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" className="w-full sm:w-auto">
            Search
          </Button>
        </form>

        <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
          {loadError ? (
            <ErrorState title="Could not load students" description={loadError} />
          ) : students.length === 0 ? (
            <EmptyState
              title="No students found"
              description={q || filterQs ? "Try a different search or filter." : "Students appear here once admitted."}
              action={
                !q && !filterQs && hasPermission(ctx, "data.import") ? (
                  <Link href={`/${institutionSlug}/setup`} className="text-sm font-medium underline underline-offset-2">
                    Import your student list from a spreadsheet
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <MaybeBulk enabled={selectable} institutionSlug={institutionSlug} terms={terms}>
            <Table>
              <TableHeader>
                <TableRow>
                  {selectable && <TableHead className="w-8"><span className="sr-only">Select</span></TableHead>}
                  <TableHead>Admission no</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Grade-Section</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s, i) => (
                  <TableRow key={s.id} className={ROW_ENTER} style={rowDelay(i)}>
                    {selectable && (
                      <TableCell>
                        <BulkCheckbox value={s.id} label={`Select ${s.firstName}`} />
                      </TableCell>
                    )}
                    <TableCell>
                      <Link className="underline" href={`/${institutionSlug}/students/${s.id}`}>
                        {s.admissionNo}
                      </Link>
                    </TableCell>
                    <TableCell>{[s.firstName, s.lastName].filter(Boolean).join(" ")}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.gradeName ? `${s.gradeName}-${s.sectionName}` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={studentStatusVariant(s.status)}>{humanize(s.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </MaybeBulk>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {pageNum} of {totalPages} ({total} students)
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/${institutionSlug}/students?${filterQs}${filterQs ? "&" : ""}page=${pageNum - 1}`}>Previous</Link>
              </Button>
            )}
            {pageNum < totalPages && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/${institutionSlug}/students?${filterQs}${filterQs ? "&" : ""}page=${pageNum + 1}`}>Next</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function MaybeBulk({
  enabled,
  institutionSlug,
  terms,
  children,
}: {
  enabled: boolean;
  institutionSlug: string;
  terms: { id: string; label: string }[];
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <BulkActions kind="invoice" institutionSlug={institutionSlug} terms={terms}>
      {children}
    </BulkActions>
  );
}
