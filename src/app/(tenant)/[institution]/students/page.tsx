import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { studentStatusVariant } from "@/modules/people/components/StudentProfileHeader";
import { listStudents } from "@/modules/people/queries";

// T-028 — 07 §2.2 student.read is granted to teacher/student/guardian
// scoped ("s") by RLS, but this staff list page is staff-only: a
// student/guardian belongs in the portal (T-034), not here (packet rule,
// same page-level-guard shape as attendance's per-section check).
export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { q, page } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") notFound();

  const pageNum = Number(page) || 1;

  // Phase 2 review (MEDIUM): a search query can still fail (e.g. a DB
  // outage, or some future special character this page's escaping doesn't
  // anticipate) — show an empty state with the error message instead of
  // crashing the whole page.
  let students: Awaited<ReturnType<typeof listStudents>>["students"] = [];
  let total = 0;
  let pageSize = 50;
  let loadError: string | null = null;
  try {
    ({ students, total, pageSize } = await listStudents(ctx, q, pageNum));
  } catch {
    loadError = "Could not load students. Try a simpler search.";
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader title="Students" description={`${total} enrolled and past students`} />

      <form method="get" className="flex gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search by name or admission no (e.g. ADM/2026/00001)" className="max-w-sm" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {loadError && <ErrorState title="Could not load students" description={loadError} />}

      {!loadError && students.length === 0 ? (
        <EmptyState title="No students found" description={q ? "Try a different name or admission number." : "Students appear here once admitted."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Admission no</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Grade-Section</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link className="underline" href={`/${institutionSlug}/students/${s.id}`}>
                        {s.admissionNo}
                      </Link>
                    </TableCell>
                    <TableCell>{[s.firstName, s.lastName].filter(Boolean).join(" ")}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.gradeName ? `${s.gradeName}-${s.sectionName}` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={studentStatusVariant(s.status)}>{s.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {pageNum} of {totalPages} ({total} students)
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/${institutionSlug}/students?q=${encodeURIComponent(q ?? "")}&page=${pageNum - 1}`}>Previous</Link>
              </Button>
            )}
            {pageNum < totalPages && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/${institutionSlug}/students?q=${encodeURIComponent(q ?? "")}&page=${pageNum + 1}`}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
