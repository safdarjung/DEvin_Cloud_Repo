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
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { listSectionOptions } from "@/modules/exams/queries";
import { listStudents } from "@/modules/people/queries";
import { RecordAchievementForm, VerifyAchievementButton, VoidAchievementButton } from "@/modules/achievements/components/AchievementForms";
import { PortfolioView } from "@/modules/achievements/components/PortfolioView";
import { ACHIEVEMENTS_PAGE_SIZE, achievementSummary, listAchievements, studentPortfolio } from "@/modules/achievements/queries";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LEVELS, AchievementListSchema } from "@/modules/achievements/schemas";

export const metadata: Metadata = { title: "Achievements" };

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = { section?: string; category?: string; level?: string; verified?: string; page?: string; q?: string; student?: string };

export default async function AchievementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<Search>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "achievements");
  requirePermission(ctx, "achievement.read");
  const canWrite = hasPermission(ctx, "achievement.write");
  const canVerify = hasPermission(ctx, "achievement.verify");
  const isManager = ["owner", "principal", "admin"].includes(ctx.membership.role);

  // Invalid filter values fall back to "no filter" rather than 500.
  const parsed = AchievementListSchema.safeParse({
    sectionId: sp.section || undefined,
    category: sp.category || undefined,
    level: sp.level || undefined,
    verified: sp.verified || undefined,
    page: sp.page ? Number(sp.page) : undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const portfolioId = sp.student && UUID.test(sp.student) ? sp.student : null;

  const [listR, summaryR, sectionsR, studentsR, portfolioR] = await Promise.allSettled([
    listAchievements(ctx, filters),
    achievementSummary(ctx),
    listSectionOptions(ctx),
    canWrite ? listStudents(ctx, sp.q, 1, { status: "active" }) : Promise.resolve(null),
    portfolioId ? studentPortfolio(ctx, portfolioId) : Promise.resolve(null),
  ]);
  for (const r of [listR, summaryR, sectionsR, studentsR, portfolioR]) if (r.status === "rejected") console.error("achievements page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const students =
    studentsR.status === "fulfilled" && studentsR.value
      ? studentsR.value.students.map((s) => ({ id: s.id, label: `${[s.firstName, s.lastName].filter(Boolean).join(" ")} (${s.admissionNo}${s.sectionName ? `, ${s.gradeName ?? ""}-${s.sectionName}` : ""})` }))
      : [];
  const base = `/${slug}/achievements`;
  const keep = { section: sp.section, category: sp.category, level: sp.level, verified: sp.verified };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Achievements"
        description="Student portfolio of awards and recognition. Entries are append-only; a mistake is voided with a reason. Only a manager can mark an entry verified."
      />

      {portfolioId && (
        <Card>
          <CardContent className="pt-4">
            {portfolioR.status === "rejected" ? (
              <ErrorState title="Could not load the portfolio" description="Refresh to try again." />
            ) : portfolioR.value ? (
              <>
                <PortfolioView portfolio={portfolioR.value} schoolName={ctx.institution.name} />
                <Button asChild variant="ghost" className="mt-3 print:hidden">
                  <Link href={base}>Close portfolio</Link>
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {canWrite && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Record achievement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="get" className="flex items-end gap-2">
              {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
              <div className="flex-1">
                <Label htmlFor="ac-q">Find student</Label>
                <Input id="ac-q" name="q" defaultValue={sp.q} placeholder="Name or admission no" />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <RecordAchievementForm institutionSlug={slug} students={students} />
          </CardContent>
        </Card>
      )}

      {summaryR.status === "fulfilled" && summaryR.value.total > 0 && (
        <section aria-labelledby="ac-summary" className="space-y-2 print:hidden">
          <h2 id="ac-summary" className="text-base font-semibold">
            At a glance
          </h2>
          <div className="flex flex-wrap gap-2">
            {summaryR.value.byCategory.map((c) => (
              <Badge key={c.category} variant="outline">
                {humanize(c.category)}: {c.count}
              </Badge>
            ))}
            {summaryR.value.byLevel.map((l) => (
              <Badge key={l.level} variant="secondary">
                {humanize(l.level)}: {l.count}
              </Badge>
            ))}
          </div>
        </section>
      )}

      <form method="get" className="grid gap-3 sm:grid-cols-5 sm:items-end print:hidden">
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
          <select id="f-category" name="category" defaultValue={sp.category ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            {ACHIEVEMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="f-level">Level</Label>
          <select id="f-level" name="level" defaultValue={sp.level ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            {ACHIEVEMENT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {humanize(l)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="f-verified">Verified</Label>
          <select id="f-verified" name="verified" defaultValue={sp.verified ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            <option value="yes">Verified</option>
            <option value="no">Not yet verified</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <Button asChild variant="ghost">
            <Link href={base}>Clear</Link>
          </Button>
        </div>
      </form>

      <section aria-labelledby="ac-list" className="space-y-3 print:hidden">
        <h2 id="ac-list" className="text-base font-semibold">
          Entries
        </h2>
        {listR.status === "rejected" ? (
          <ErrorState title="Could not load achievements" description="Refresh to try again." />
        ) : listR.value.rows.length === 0 ? (
          <EmptyState title="No achievements" description="Nothing matches these filters yet." />
        ) : (
          <>
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listR.value.rows.map((r) => (
                      <TableRow key={r.id} className={r.voidedAt ? "opacity-60" : undefined}>
                        <TableCell className="tabular-nums">{new Date(`${r.eventDate}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC" })}</TableCell>
                        <TableCell className="font-medium">
                          <Link className="underline-offset-2 hover:underline" href={{ pathname: base, query: { ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v)), student: r.studentId } }}>
                            {r.studentName}
                          </Link>
                        </TableCell>
                        <TableCell className={r.voidedAt ? "line-through" : undefined}>{r.title}</TableCell>
                        <TableCell>{humanize(r.category)}</TableCell>
                        <TableCell>{humanize(r.level)}</TableCell>
                        <TableCell>{r.position}</TableCell>
                        <TableCell>
                          {r.voidedAt ? (
                            <Badge variant="outline" title={r.voidReason ?? undefined}>
                              Voided: {r.voidReason}
                            </Badge>
                          ) : (
                            <Badge variant={r.verified ? "success" : "outline"}>{r.verified ? "Verified" : "Not yet verified"}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!r.voidedAt && (
                            <span className="inline-flex items-start gap-2">
                              {canVerify && !r.verified && <VerifyAchievementButton institutionSlug={slug} achievementId={r.id} />}
                              {canWrite && (isManager || (r.recordedByMe && !r.verified)) && <VoidAchievementButton institutionSlug={slug} achievementId={r.id} />}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <ListPager basePath={base} params={keep} page={listR.value.page} total={listR.value.total} pageSize={ACHIEVEMENTS_PAGE_SIZE} noun="achievements" />
          </>
        )}
      </section>
    </div>
  );
}
