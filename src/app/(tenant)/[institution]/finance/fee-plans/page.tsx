import Link from "next/link";
import { ListPager } from "@/components/list-pager";
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
import { humanize, inr } from "@/lib/format";
import { InstalmentsForm } from "@/modules/fee-plans/components/instalments-form";
import { LateFeeForm } from "@/modules/fee-plans/components/late-fee-form";
import { LedgerExport } from "@/modules/fee-plans/components/ledger-export";
import { getInstalments, listLateFeeRules } from "@/modules/fee-plans/queries";
import { listInvoicesPage, moneyToPaise } from "@/modules/finance/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = [
  { id: "late-fees", label: "Late fees" },
  { id: "instalments", label: "Instalments" },
  { id: "export", label: "Ledger export" },
];

// Fee plans. Page floor `finance.plan.manage`; the late-fee list and ledger export also need `finance.structure.manage` (their queries' gate).
// The backend is real (RLS tables + SQL definers); no simulation.
export default async function FeePlansPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ section?: string; q?: string; inv?: string; page?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "fee_plans");
  if (!hasPermission(ctx, "finance.plan.manage")) throw new AppError("forbidden", "You do not have access to fee plans.");
  const canStructure = hasPermission(ctx, "finance.structure.manage");
  const sections = SECTIONS.filter((s) => canStructure || s.id === "instalments");
  const active = sections.find((s) => s.id === sp.section)?.id ?? sections[0].id;
  return (
    <div className="space-y-4">
      <PageHeader title="Fee plans" description="Late-fee rules, instalment plans and ledger export." compact />
      <SectionSwitcher basePath={`/${slug}/finance/fee-plans`} sections={sections} activeId={active} />
      {active === "late-fees" && <LateFeesTab ctx={ctx} slug={slug} />}
      {active === "instalments" && <InstalmentsTab ctx={ctx} slug={slug} q={sp.q?.trim() || undefined} inv={sp.inv && UUID.test(sp.inv) ? sp.inv : undefined} page={Math.max(1, Number(sp.page) || 1)} />}
      {active === "export" && (
        <Card>
          <CardHeader>
            <CardTitle>Export ledger vouchers</CardTitle>
          </CardHeader>
          <CardContent>
            <LedgerExport institutionSlug={slug} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function LateFeesTab({ ctx, slug }: { ctx: TenantContext; slug: string }) {
  const rows = await listLateFeeRules(ctx).catch((e) => {
    console.error("late fee rules failed:", e instanceof Error ? e.message : e);
    return null;
  });
  if (rows === null) return <ErrorState title="Could not load late-fee rules" description="Refresh to try again." />;
  if (rows.length === 0) return <EmptyState title="No fee structures this year" description="Create a fee structure for the current academic year first." />;
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <Card key={r.feeStructureId}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {r.feeStructureName}
              {r.gradeName && <span className="text-sm font-normal text-muted-foreground">{r.gradeName}</span>}
              {r.rule ? <Badge variant={r.rule.isActive ? "success" : "outline"}>{r.rule.isActive ? `Active · ${r.rule.kind === "flat" ? `${inr(r.rule.amount)} once` : `${inr(r.rule.amount)}/day`}` : "Inactive"}</Badge> : <Badge variant="outline">No rule</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LateFeeForm institutionSlug={slug} feeStructureId={r.feeStructureId} label={r.feeStructureName} rule={r.rule} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function InstalmentsTab({ ctx, slug, q, inv, page }: { ctx: TenantContext; slug: string; q?: string; inv?: string; page: number }) {
  const [listR, planR] = await Promise.allSettled([listInvoicesPage(ctx, { q, page }), inv ? getInstalments(ctx, { invoiceId: inv }) : Promise.resolve(null)]);
  for (const r of [listR, planR]) if (r.status === "rejected") console.error("instalments fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const plan = planR.status === "fulfilled" ? planR.value : null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pick an invoice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form method="get" className="flex items-end gap-2" role="search">
            <input type="hidden" name="section" value="instalments" />
            <div>
              <Label htmlFor="inv-q">Invoice no, student name or admission no.</Label>
              <Input id="inv-q" name="q" defaultValue={q} maxLength={60} className="w-72" />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {listR.status === "rejected" ? (
            <ErrorState title="Could not load invoices" description="Refresh to try again." bare />
          ) : listR.value.rows.length === 0 ? (
            <EmptyState title="No invoices found" description={q ? "Try another search." : "Invoices appear once fees are generated."} bare />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listR.value.rows.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.invoiceNo}</TableCell>
                      <TableCell>{i.studentName}</TableCell>
                      <TableCell>{humanize(i.status)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(i.total)}</TableCell>
                      <TableCell>
                        <Link href={`/${slug}/finance/fee-plans?section=instalments&inv=${i.id}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page}`} className="text-sm underline">
                          Plan
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPager basePath={`/${slug}/finance/fee-plans`} params={{ section: "instalments", q }} page={page} total={listR.value.total} pageSize={listR.value.pageSize} noun="invoices" />
            </>
          )}
        </CardContent>
      </Card>
      {inv && planR.status === "rejected" && <ErrorState title="Could not load this invoice's plan" description="Refresh to try again." />}
      {inv && planR.status === "fulfilled" && (plan === null ? (
        <EmptyState title="Invoice not found" description="It may belong to another school." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Invoice {plan.invoiceNo} · {inr(plan.total)} <span className="text-sm font-normal text-muted-foreground">({inr(plan.paidTotal)} paid)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {plan.parts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.parts.map((p) => (
                    <TableRow key={p.seq}>
                      <TableCell>{p.seq}</TableCell>
                      <TableCell>{p.dueOn}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(p.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(p.paidAmount)}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "paid" ? "success" : p.status === "overdue" ? "destructive" : "outline"}>{humanize(p.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {plan.lateFees.length > 0 && (
              <p className="text-sm text-muted-foreground tabular-nums">Late fees charged: {plan.lateFees.map((c) => `${c.chargeDate} ${inr(c.amount)}`).join(" · ")}</p>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">{plan.parts.length > 0 ? "Replace the instalment plan" : "Split into instalments"}</h3>
              <InstalmentsForm
                key={plan.invoiceId + plan.parts.length}
                institutionSlug={slug}
                invoiceId={plan.invoiceId}
                totalPaise={moneyToPaise(plan.total)}
                initial={plan.parts.map((p) => ({ dueOn: p.dueOn, amountPaise: moneyToPaise(p.amount) }))}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
