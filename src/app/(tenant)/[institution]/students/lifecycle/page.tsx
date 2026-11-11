import type { Metadata } from "next";
import Link from "next/link";
import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { SectionSwitcher } from "@/components/section-switcher";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { listAcademicYears } from "@/modules/finance/queries";
import { ExitForm } from "@/modules/lifecycle/components/exit-form";
import { GuardianForm } from "@/modules/lifecycle/components/guardian-form";
import { PromoteForm } from "@/modules/lifecycle/components/promote-form";
import { suggestTargets } from "@/modules/lifecycle/mapping";
import { lifecycleHistory, promotionPlan } from "@/modules/lifecycle/queries";
import { getStudentProfile, listStudents } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Promote & exit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v?: string) => (v && UUID.test(v) ? v : undefined);
const SECTIONS = [
  { id: "promote", label: "Promote" },
  { id: "exit", label: "Exit" },
  { id: "guardian", label: "Link guardian" },
  { id: "history", label: "History" },
];
type Sp = { section?: string; from?: string; to?: string; student?: string; q?: string; page?: string };

// Promote & exit. Page floor `student.write` (nav gate); promotion also needs `academics.manage`. The backend is real (SQL definers), no simulation.
export default async function LifecyclePage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<Sp> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "student_lifecycle");
  if (!hasPermission(ctx, "student.write")) throw new AppError("forbidden", "You do not have access to promote and exit.");
  const sections = SECTIONS.filter((s) => s.id !== "promote" || hasPermission(ctx, "academics.manage"));
  const active = sections.find((s) => s.id === sp.section)?.id ?? sections[0].id;
  return (
    <div className="space-y-4">
      <PageHeader title="Promote & exit" description="Year-end promotion, transfers and withdrawals, guardian links and each student's history." compact />
      <SectionSwitcher basePath={`/${slug}/students/lifecycle`} sections={sections} activeId={active} />
      {active === "promote" ? <PromoteTab ctx={ctx} slug={slug} from={uuid(sp.from)} to={uuid(sp.to)} /> : <StudentTab ctx={ctx} slug={slug} tab={active} sp={sp} />}
    </div>
  );
}

async function PromoteTab({ ctx, slug, from, to }: { ctx: TenantContext; slug: string; from?: string; to?: string }) {
  const years = await listAcademicYears(ctx).catch((e) => {
    console.error("lifecycle years failed:", e instanceof Error ? e.message : e);
    return null;
  });
  if (years === null) return <ErrorState title="Could not load academic years" description="Refresh to try again." />;
  if (years.length < 2) return <EmptyState title="Need two academic years" description="Create next year's academic year and its sections before promoting." />;
  const plan = from && to && from !== to ? await promotionPlan(ctx, from, to).catch((e) => {
    console.error("promotion plan failed:", e instanceof Error ? e.message : e);
    return null;
  }) : undefined;
  const select = (name: string, value?: string) => (
    <select id={`yr-${name}`} name={name} defaultValue={value ?? ""} className="block h-10 w-48 rounded-md border border-input bg-background px-3 text-sm">
      <option value="">Select…</option>
      {years.map((y) => (
        <option key={y.id} value={y.id}>
          {y.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="section" value="promote" />
        <div>
          <Label htmlFor="yr-from">Promote from</Label>
          {select("from", from)}
        </div>
        <div>
          <Label htmlFor="yr-to">Promote into</Label>
          {select("to", to)}
        </div>
        <Button type="submit" variant="outline">
          Preview
        </Button>
      </form>
      {plan === null && <ErrorState title="Could not build the promotion preview" description="Refresh to try again." />}
      {plan === undefined && <p className="text-sm text-muted-foreground">Pick two different years to preview the promotion.</p>}
      {plan && (plan.from.length === 0 ? (
        <EmptyState title="No sections in the from year" description="Nothing to promote." />
      ) : plan.to.length === 0 ? (
        <EmptyState title="No sections in the target year" description="Create the next year's sections first, or every student would graduate." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Preview and confirm</CardTitle>
          </CardHeader>
          <CardContent>
            <PromoteForm
              key={`${from}-${to}`}
              institutionSlug={slug}
              fromYearId={from as string}
              toYearId={to as string}
              plan={plan}
              suggested={suggestTargets(plan.from, plan.to)}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function StudentTab({ ctx, slug, tab, sp }: { ctx: TenantContext; slug: string; tab: string; sp: Sp }) {
  const studentId = uuid(sp.student);
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const base = `/${slug}/students/lifecycle`;
  const [listR, profileR, historyR] = await Promise.allSettled([
    q || !studentId ? listStudents(ctx, q, page, { status: "active" }) : Promise.resolve(null),
    studentId ? getStudentProfile(ctx, studentId) : Promise.resolve(null),
    studentId && tab === "history" ? lifecycleHistory(ctx, studentId) : Promise.resolve(null),
  ]);
  for (const r of [listR, profileR, historyR]) if (r.status === "rejected") console.error("lifecycle fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const profile = profileR.status === "fulfilled" ? profileR.value : null;
  const name = profile ? `${profile.firstName} ${profile.lastName ?? ""}`.trim() : "";
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{studentId ? "Student" : "Find a student"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="flex items-end gap-2" role="search">
            <input type="hidden" name="section" value={tab} />
            <div>
              <Label htmlFor="ls-q">Name or admission no.</Label>
              <Input id="ls-q" name="q" defaultValue={q} maxLength={60} className="w-64" />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {listR.status === "rejected" ? (
            <ErrorState title="Could not load students" description="Refresh to try again." bare />
          ) : listR.value && (listR.value.students.length === 0 ? (
            <EmptyState title="No active student matches" description="Try another search." bare />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Admission no.</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>
                      <span className="sr-only">Select</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listR.value.students.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.firstName} {s.lastName}
                      </TableCell>
                      <TableCell className="tabular-nums">{s.admissionNo}</TableCell>
                      <TableCell>{[s.gradeName, s.sectionName].filter(Boolean).join(" ") || "—"}</TableCell>
                      <TableCell>
                        <Link href={`${base}?section=${tab}&student=${s.id}`} className="text-sm underline">
                          Select
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPager basePath={base} params={{ section: tab, q }} page={page} total={listR.value.total} pageSize={listR.value.pageSize} noun="students" />
            </>
          ))}
        </CardContent>
      </Card>

      {studentId && profileR.status === "rejected" && <ErrorState title="Could not load the student" description="Refresh to try again." />}
      {studentId && profileR.status === "fulfilled" && (profile === null ? (
        <EmptyState title="Student not found" description="Pick a student from the search above." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {name} <span className="text-sm font-normal text-muted-foreground">{profile.admissionNo} · {humanize(profile.status)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {tab === "exit" &&
              (profile.status !== "active" ? (
                <p className="text-sm text-muted-foreground">This student is already {humanize(profile.status)}. See History for the transfer certificate.</p>
              ) : (
                <ExitForm institutionSlug={slug} studentId={profile.id} studentName={name} />
              ))}
            {tab === "guardian" && (
              <>
                {profile.guardians.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {profile.guardians.map((g) => (
                      <li key={g.id}>
                        {g.fullName} · {humanize(g.relationship)}
                        {g.isPrimary ? " (primary)" : ""} · {g.phone}
                      </li>
                    ))}
                  </ul>
                )}
                <GuardianForm institutionSlug={slug} studentId={profile.id} studentName={name} />
              </>
            )}
            {tab === "history" &&
              (historyR.status === "rejected" ? (
                <ErrorState title="Could not load history" description="Refresh to try again." bare />
              ) : historyR.value && (
                <>
                  <h3 className="text-sm font-semibold">Enrolments</h3>
                  {historyR.value.enrolments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No enrolments.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {historyR.value.enrolments.map((e) => (
                        <li key={e.id}>
                          {e.academicYear} · {e.grade}-{e.section}
                          {e.rollNo ? ` · roll ${e.rollNo}` : ""} · {humanize(e.status)} · {e.startedOn} to {e.endedOn ?? "now"}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h3 className="text-sm font-semibold">Lifecycle events</h3>
                  {historyR.value.events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No promotions, transfers or withdrawals yet.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {historyR.value.events.map((e) => (
                        <li key={e.id}>
                          {e.effectiveOn} · {humanize(e.kind)}
                          {e.reason ? ` · ${e.reason}` : ""}
                          {e.tcNo ? ` · TC ${e.tcNo}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
