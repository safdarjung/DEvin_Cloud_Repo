import type { Metadata } from "next";
import Link from "next/link";
import { LimitedBadge } from "@/components/honesty";
import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { inr } from "@/lib/format";
import { parsePage } from "@/lib/list-search";
import { BudgetChart } from "@/modules/expenses/components/BudgetChart";
import { BudgetForm, CategoryForm, RecordExpenseForm, VoidExpenseButton } from "@/modules/expenses/components/ExpenseForms";
import { expenseCategories, expensesBudgetVsActual, expensesList, expensesTotal } from "@/modules/expenses/queries";
import { EXPENSE_LIMITED_NOTE, ExpenseBudgetVsActualSchema, ExpenseListSchema } from "@/modules/expenses/schemas";

export const metadata: Metadata = { title: "Expenses" };

const TABS = [
  { key: "expenses", label: "Expenses" },
  { key: "categories", label: "Categories" },
  { key: "budget", label: "Budget" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
/** Display only: paise -> "₹1,234.50". Sums stay in integer paise. */
const money = (paise: number) => inr(paise / 100);

/** Chart rows in rupees (display only); a category with several budgets in view gets its period start in the label. */
function chartRows(rows: { categoryId: string; categoryName: string; periodStart: string; budgetPaise: number; actualPaise: number }[]) {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.categoryId, (seen.get(r.categoryId) ?? 0) + 1);
  return rows.map((r) => ({
    label: seen.get(r.categoryId)! > 1 ? `${r.categoryName} (${fmtDate(r.periodStart)})` : r.categoryName,
    budget: r.budgetPaise / 100,
    actual: r.actualPaise / 100,
  }));
}

function settle<T>(p: Promise<T>, what: string): Promise<PromiseSettledResult<T>> {
  return Promise.allSettled([p]).then(([r]) => {
    if (r.status === "rejected") console.error(`expenses ${what} fetch failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
    return r;
  });
}

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ tab?: string; category?: string; from?: string; to?: string; q?: string; page?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "expenses");
  requirePermission(ctx, "expense.read");
  const canManage = hasPermission(ctx, "expense.manage");
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "expenses";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const categoriesR = await settle(expenseCategories(ctx), "categories");
  const categories = categoriesR.status === "fulfilled" ? categoriesR.value : [];
  const active = categories.filter((c) => c.isActive);

  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description="Record school spending, keep categories tidy and track spend against budget." compact />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <LimitedBadge /> {EXPENSE_LIMITED_NOTE}
      </p>
      <nav aria-label="Expense sections" className="flex gap-1 border-b">
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

      {categoriesR.status === "rejected" ? (
        <ErrorState title="Could not load expenses" description="Refresh to try again." />
      ) : tab === "expenses" ? (
        <ExpensesTab ctx={ctx} slug={slug} sp={sp} canManage={canManage} categories={categories} active={active} today={today} />
      ) : tab === "categories" ? (
        <section aria-label="Categories" className="space-y-4">
          {categories.length === 0 ? (
            <EmptyState title="No categories yet" description={canManage ? "Add the first one below, for example Electricity, Fuel or Repairs." : undefined} />
          ) : (
            <Card>
              <CardContent className="space-y-4 pt-6">
                {categories.map((c) =>
                  canManage ? (
                    <CategoryForm key={c.id} institutionSlug={slug} category={c} />
                  ) : (
                    <p key={c.id} className="text-sm">
                      {c.name} {!c.isActive && <Badge variant="outline">Inactive</Badge>}
                    </p>
                  ),
                )}
              </CardContent>
            </Card>
          )}
          {canManage && (
            <Card>
              <CardContent className="pt-6">
                <CategoryForm institutionSlug={slug} />
              </CardContent>
            </Card>
          )}
        </section>
      ) : (
        <BudgetTab ctx={ctx} slug={slug} sp={sp} canManage={canManage} categories={categories} active={active} />
      )}
    </div>
  );
}

type TabProps = {
  ctx: TenantContext;
  slug: string;
  sp: { category?: string; from?: string; to?: string; q?: string; page?: string };
  canManage: boolean;
  categories: Awaited<ReturnType<typeof expenseCategories>>;
  active: Awaited<ReturnType<typeof expenseCategories>>;
};

async function ExpensesTab({ ctx, slug, sp, canManage, categories, active, today }: TabProps & { today: string }) {
  const parsed = ExpenseListSchema.safeParse({
    categoryId: sp.category || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    q: sp.q?.trim() || undefined,
    page: parsePage(sp.page),
  });
  const filters = parsed.success ? parsed.data : { page: 1 };
  const [listR, totalR] = await Promise.all([settle(expensesList(ctx, filters), "list"), settle(expensesTotal(ctx, filters), "total")]);

  return (
    <section aria-label="Expenses" className="space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Record an expense</CardTitle>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <EmptyState bare title="Add a category first" description="Every expense belongs to a category." action={<Link href="?tab=categories" className="text-sm underline">Go to categories</Link>} />
            ) : (
              <RecordExpenseForm institutionSlug={slug} categories={active} today={today} />
            )}
          </CardContent>
        </Card>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter expenses">
        <input type="hidden" name="tab" value="expenses" />
        <div>
          <Label htmlFor="f-cat">Category</Label>
          <select id="f-cat" name="category" defaultValue={sp.category ?? ""} className={SELECT_CLASS}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={sp.from} className="w-40" />
        </div>
        <div>
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={sp.to} className="w-40" />
        </div>
        <div>
          <Label htmlFor="f-q">Search</Label>
          <Input id="f-q" name="q" maxLength={100} placeholder="Note or payee" defaultValue={sp.q} className="w-48" />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        <Link href="?tab=expenses" className="min-h-10 py-2 text-sm text-muted-foreground underline">
          Clear
        </Link>
      </form>
      {!parsed.success && <p className="text-sm text-destructive">Those filters are not valid (check the dates), so all expenses are shown.</p>}

      {totalR.status === "fulfilled" && (
        <p className="text-sm">
          Net total for these filters: <span className="font-semibold tabular-nums">{money(totalR.value.totalPaise)}</span>{" "}
          <span className="text-muted-foreground">({totalR.value.rows} entries; voids count as negative reversing entries)</span>
        </p>
      )}

      {listR.status === "rejected" ? (
        <ErrorState title="Could not load expenses" description="Refresh to try again." />
      ) : listR.value.rows.length === 0 ? (
        <EmptyState title="No expenses found" description={sp.category || sp.from || sp.to || sp.q ? "Try other filters." : "Recorded expenses will appear here."} />
      ) : (
        <>
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="hidden md:table-cell">Payee</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && (
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listR.value.rows.map((r) => (
                    <TableRow key={r.id} className={r.isVoided || r.reversesExpenseId ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-nowrap">{fmtDate(r.spentOn)}</TableCell>
                      <TableCell>{r.categoryName}</TableCell>
                      <TableCell className="max-w-64 break-words">{r.reversesExpenseId ? `Void: ${r.description}` : r.description}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.payee ?? "—"}</TableCell>
                      <TableCell className={`text-right tabular-nums ${r.isVoided ? "line-through" : ""}`}>{money(r.amountPaise)}</TableCell>
                      <TableCell>
                        {r.reversesExpenseId ? <Badge variant="secondary">Reversal</Badge> : r.isVoided ? <Badge variant="outline">Voided</Badge> : <Badge variant="success">Recorded</Badge>}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {!r.reversesExpenseId && !r.isVoided && <VoidExpenseButton institutionSlug={slug} expenseId={r.id} label={`${r.description} ${money(r.amountPaise)}`} />}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <ListPager
            basePath={`/${slug}/finance/expenses`}
            params={{ tab: "expenses", category: sp.category, from: sp.from, to: sp.to, q: sp.q }}
            page={listR.value.page}
            total={listR.value.total}
            pageSize={listR.value.pageSize}
            noun="entries"
          />
        </>
      )}
    </section>
  );
}

async function BudgetTab({ ctx, slug, sp, canManage, active }: TabProps) {
  const parsed = ExpenseBudgetVsActualSchema.safeParse({ from: sp.from || undefined, to: sp.to || undefined });
  const bvaR = await settle(expensesBudgetVsActual(ctx, parsed.success ? parsed.data : {}), "budget");

  return (
    <section aria-label="Budget" className="space-y-4">
      {bvaR.status === "rejected" ? (
        <ErrorState title="Could not load budgets" description="Refresh to try again." />
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Budget period">
            <input type="hidden" name="tab" value="budget" />
            <div>
              <Label htmlFor="b-from">Budgets overlapping from</Label>
              <Input id="b-from" name="from" type="date" defaultValue={bvaR.value.from} className="w-40" />
            </div>
            <div>
              <Label htmlFor="b-to">to</Label>
              <Input id="b-to" name="to" type="date" defaultValue={bvaR.value.to} className="w-40" />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Show
            </Button>
          </form>
          {!parsed.success && <p className="text-sm text-destructive">That period is not valid, so the current financial year is shown.</p>}

          {bvaR.value.rows.length === 0 ? (
            <EmptyState title="No budgets in this period" description={canManage ? "Set a budget for a category below." : undefined} />
          ) : (
            <>
              <Card>
                <CardContent className="pt-6">
                  <BudgetChart rows={chartRows(bvaR.value.rows)} />
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Budget</TableHead>
                        <TableHead className="text-right">Spent</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bvaR.value.rows.map((r) => (
                        <TableRow key={r.budgetId}>
                          <TableCell className="font-medium">{r.categoryName}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{money(r.budgetPaise)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(r.actualPaise)}</TableCell>
                          <TableCell>
                            {r.overByPaise > 0 ? (
                              <Badge variant="destructive">Over by {money(r.overByPaise)}</Badge>
                            ) : (
                              <Badge variant="success">Within budget, {money(r.budgetPaise - r.actualPaise)} left</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Set a budget</CardTitle>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <EmptyState bare title="Add a category first" action={<Link href="?tab=categories" className="text-sm underline">Go to categories</Link>} />
            ) : (
              <BudgetForm
                institutionSlug={slug}
                categories={active}
                defaultStart={bvaR.status === "fulfilled" ? bvaR.value.from : ""}
                defaultEnd={bvaR.status === "fulfilled" ? bvaR.value.to : ""}
              />
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
