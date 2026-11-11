import type { Metadata } from "next";
import Link from "next/link";
import { LimitedBadge } from "@/components/honesty";
import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize, inr } from "@/lib/format";
import { uuid } from "@/lib/schemas/common";
import { getStudentProfile, listStudents } from "@/modules/people/queries";
import { DecideAwardButton, EditRuleButton, NewRuleForm, RequestAwardForm, RuleActiveButton } from "@/modules/scholarships/components/ConcessionForms";
import { concessionValue } from "@/modules/scholarships/components/value";
import { concessionAwards, concessionRules, concessionSummary, type ConcessionValueRow } from "@/modules/scholarships/queries";
import { AWARD_STATUSES, SCHOLARSHIPS_LIMITED_NOTE } from "@/modules/scholarships/schemas";

export const metadata: Metadata = { title: "Concessions" };

const TABS = [
  { key: "awards", label: "Awards" },
  { key: "rules", label: "Rules" },
  { key: "summary", label: "Summary" },
] as const;
type Tab = (typeof TABS)[number]["key"];
type Status = (typeof AWARD_STATUSES)[number];

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const STATUS_VARIANT = { pending: "warning", approved: "success", rejected: "outline" } as const;

function logRejected(results: PromiseSettledResult<unknown>[]): void {
  for (const r of results) if (r.status === "rejected") console.error("concessions page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
}

// Concessions: rules (reusable percent or fixed amount), per-student awards
// (requested by concession.manage, decided once by an owner/principal who
// did not request it) and a name-free summary. URL holds the state: ?tab=,
// ?status=, ?page=, ?q= student search, ?student= the student to request for.
export default async function ConcessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ tab?: string; status?: string; page?: string; q?: string; student?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "scholarships");
  requirePermission(ctx, "concession.read");
  const canManage = hasPermission(ctx, "concession.manage");
  const canApprove = hasPermission(ctx, "concession.approve");

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "awards";

  return (
    <div className="space-y-6">
      <PageHeader title="Concessions" description="Scholarship and fee-concession rules, per-student awards with a two-person decision, and what has been approved." compact />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <LimitedBadge /> {SCHOLARSHIPS_LIMITED_NOTE} To reduce a student&apos;s fees, add the approved concession when you assign their fee structure in Finance.
      </p>
      <nav aria-label="Concession sections" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px min-h-10 border-b-2 px-3 py-2 text-sm ${t.key === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "awards" && <AwardsTab slug={slug} sp={sp} ctx={ctx} canManage={canManage} canApprove={canApprove} />}
      {tab === "rules" && <RulesTab slug={slug} ctx={ctx} canManage={canManage} />}
      {tab === "summary" && <SummaryTab ctx={ctx} />}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof getTenantContext>>;

async function AwardsTab({
  slug,
  sp,
  ctx,
  canManage,
  canApprove,
}: {
  slug: string;
  sp: { status?: string; page?: string; q?: string; student?: string };
  ctx: Ctx;
  canManage: boolean;
  canApprove: boolean;
}) {
  const status = AWARD_STATUSES.includes(sp.status as Status) ? (sp.status as Status) : undefined;
  const page = Math.min(1000, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const query = sp.q?.trim().slice(0, 80) || undefined;
  const studentId = canManage && uuid.safeParse(sp.student).success ? sp.student : undefined;

  const [awardsR, rulesR, searchR, profileR] = await Promise.allSettled([
    concessionAwards(ctx, { status, page }),
    canManage ? concessionRules(ctx) : Promise.resolve([]),
    canManage && query ? listStudents(ctx, query, 1, { status: "active" }) : Promise.resolve(null),
    studentId ? getStudentProfile(ctx, studentId) : Promise.resolve(null),
  ]);
  logRejected([awardsR, rulesR, searchR, profileR]);
  const rules = rulesR.status === "fulfilled" ? rulesR.value : [];
  const profile = profileR.status === "fulfilled" ? profileR.value : null;
  const studentHref = (id: string) => `?${new URLSearchParams({ tab: "awards", ...(query ? { q: query } : {}), student: id })}`;
  const statusHref = (s?: Status) => `?${new URLSearchParams({ tab: "awards", ...(s ? { status: s } : {}) })}`;

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Request a concession</CardTitle>
            <CardDescription>The request waits for an owner or principal. Whoever requests it cannot approve it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form method="get" className="flex gap-2" role="search">
              <input type="hidden" name="tab" value="awards" />
              <label htmlFor="concession-q" className="sr-only">
                Find a student
              </label>
              <Input id="concession-q" name="q" defaultValue={query} maxLength={80} placeholder="Student name or admission no" />
              <Button type="submit" variant="outline">
                Find
              </Button>
            </form>
            {searchR.status === "rejected" ? (
              <ErrorState title="Could not search students" description="Refresh to try again." />
            ) : searchR.value && searchR.value.students.length === 0 ? (
              <EmptyState bare title="No active student matches" description="Try the admission number or first name." />
            ) : searchR.value ? (
              <ul className="flex flex-wrap gap-2" aria-label="Matching students">
                {searchR.value.students.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={studentHref(s.id)}
                      aria-current={s.id === studentId ? "true" : undefined}
                      className={`inline-flex min-h-10 items-center rounded-md border px-3 text-sm ${s.id === studentId ? "border-primary font-medium" : "hover:bg-muted"}`}
                    >
                      {[s.firstName, s.lastName].filter(Boolean).join(" ")} · {s.admissionNo}
                      {s.gradeName ? ` · ${s.gradeName}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {studentId && !profile && profileR.status === "fulfilled" && <EmptyState bare title="Student not found" description="Search again and pick a student from the list." />}
            {profile &&
              (rules.length === 0 ? (
                <EmptyState bare title="No active rules" description="Create a concession rule on the Rules tab first." />
              ) : (
                <RequestAwardForm
                  institutionSlug={slug}
                  studentId={profile.id}
                  studentName={[profile.firstName, profile.lastName].filter(Boolean).join(" ")}
                  rules={rules.map((r) => ({ id: r.id, name: r.name, percent: r.percent, amountPaise: r.amountPaise }))}
                />
              ))}
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="concession-awards" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="concession-awards" className="text-base font-semibold">
            Awards
          </h2>
          <nav aria-label="Filter by status" className="flex flex-wrap gap-3 text-sm">
            {[undefined, ...AWARD_STATUSES].map((s) => (
              <Link key={s ?? "all"} href={statusHref(s)} aria-current={s === status ? "page" : undefined} className={s === status ? "font-medium" : "text-muted-foreground underline"}>
                {s ? humanize(s) : "All"}
              </Link>
            ))}
          </nav>
        </div>
        {awardsR.status === "rejected" ? (
          <ErrorState title="Could not load concessions" description="Refresh to try again." />
        ) : awardsR.value.awards.length === 0 ? (
          <EmptyState title={status ? `No ${status} concessions` : "No concessions yet"} description={canManage ? "Find a student above to request the first one." : "Requests appear here once finance staff raise them."} />
        ) : (
          <Card>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="hidden lg:table-cell">Reason</TableHead>
                    <TableHead className="hidden md:table-cell">Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {awardsR.value.awards.map((w) => {
                    const mine = w.requestedBy === ctx.user.id;
                    const value = concessionValue(w.percent, w.amountPaise);
                    return (
                      <TableRow key={w.id}>
                        <TableCell>
                          <span className="font-medium">{w.studentName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {w.admissionNo}
                            {w.gradeName ? ` · ${w.gradeName}` : ""}
                          </span>
                        </TableCell>
                        <TableCell>{w.ruleName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{value}</TableCell>
                        <TableCell className="hidden max-w-xs whitespace-normal text-sm lg:table-cell">{w.reason}</TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {mine ? "You" : (w.requestedByName ?? "Finance staff")}
                          <span className="block text-xs text-muted-foreground">{dateFmt.format(new Date(w.requestedAt))}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[w.status]}>{humanize(w.status)}</Badge>
                          {w.decidedAt && (
                            <span className="block text-xs text-muted-foreground">
                              {w.decidedByName ? `${w.decidedByName}, ` : ""}
                              {dateFmt.format(new Date(w.decidedAt))}
                            </span>
                          )}
                          {w.decisionNote && <span className="block max-w-xs whitespace-normal text-xs text-muted-foreground">{w.decisionNote}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {w.status === "pending" &&
                            (mine ? (
                              <span className="text-xs text-muted-foreground">Awaiting another approver</span>
                            ) : canApprove ? (
                              <DecideAwardButton institutionSlug={slug} awardId={w.id} studentName={w.studentName} value={value} />
                            ) : null)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <ListPager
                basePath=""
                params={{ tab: "awards", status }}
                page={awardsR.value.page}
                total={awardsR.value.total}
                pageSize={awardsR.value.pageSize}
                noun="awards"
              />
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

async function RulesTab({ slug, ctx, canManage }: { slug: string; ctx: Ctx; canManage: boolean }) {
  const [rulesR] = await Promise.allSettled([concessionRules(ctx, { includeInactive: true })]);
  logRejected([rulesR]);

  return (
    <div className="space-y-6">
      {rulesR.status === "rejected" ? (
        <ErrorState title="Could not load rules" description="Refresh to try again." />
      ) : rulesR.value.length === 0 ? (
        <EmptyState title="No concession rules yet" description={canManage ? "Create the first rule below, for example a sibling or merit concession." : "Finance staff create the rules."} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="hidden md:table-cell">Who qualifies</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rulesR.value.map((r) => (
                  <TableRow key={r.id} className={r.isActive ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{concessionValue(r.percent, r.amountPaise)}</TableCell>
                    <TableCell className="hidden max-w-sm whitespace-normal text-sm md:table-cell">{r.criteria ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={r.isActive ? "success" : "outline"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="space-x-1 text-right">
                        <EditRuleButton institutionSlug={slug} rule={r} />
                        <RuleActiveButton institutionSlug={slug} id={r.id} isActive={r.isActive} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>New rule</CardTitle>
            <CardDescription>A rule is a percent of the fee or a fixed amount, never both.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewRuleForm institutionSlug={slug} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ValueTable({ caption, first, rows }: { caption: string; first: string; rows: ConcessionValueRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{caption}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState bare title="Nothing approved yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{first}</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Fixed amounts</TableHead>
                <TableHead className="text-right">Percent awards</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.approvedCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(r.amountPaise / 100)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.percentCount ? `${r.percentCount} (avg ${r.averagePercent}%)` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function SummaryTab({ ctx }: { ctx: Ctx }) {
  const [summaryR] = await Promise.allSettled([concessionSummary(ctx)]);
  logRejected([summaryR]);
  if (summaryR.status === "rejected") return <ErrorState title="Could not load the summary" description="Refresh to try again." />;
  const s = summaryR.value;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Pending", s.pendingCount],
          ["Approved", s.approvedCount],
          ["Rejected", s.rejectedCount],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">Percent awards have no rupee value until they are applied to a fee, so they are counted, not summed.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <ValueTable caption="Approved by rule" first="Rule" rows={s.byRule} />
        <ValueTable caption="Approved by grade" first="Grade" rows={s.byGrade} />
      </div>
    </div>
  );
}
