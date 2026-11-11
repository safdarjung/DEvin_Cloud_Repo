import Link from "next/link";
import { redirect } from "next/navigation";
import { SimulatedBadge } from "@/components/honesty";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { CanteenHistory, paise } from "@/modules/canteen/components/CanteenHistory";
import { ItemControls, NewItemForm, SellForm, TopupForm } from "@/modules/canteen/components/CanteenForms";
import { canteenDaySales, canteenItems, canteenStatement, canteenToday } from "@/modules/canteen/queries";
import { CanteenDaySalesSchema } from "@/modules/canteen/schemas";
import { getStudentProfile, listStudents } from "@/modules/people/queries";

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

// Canteen counter. URL holds the state: ?q= student search, ?student= the
// selected student, ?date= the sales day. Balances come only from
// canteen_balance(); top-ups are simulated (no money is collected).
export default async function CanteenPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ q?: string; student?: string; date?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { q, student, date } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "canteen");
  requirePermission(ctx, "canteen.read");
  // Guardians/students hold canteen.read only for their own child; their view is the portal.
  if (!hasPermission(ctx, "canteen.manage")) redirect(`/${institutionSlug}/portal/canteen`);

  const day = CanteenDaySalesSchema.safeParse({ date }).success ? date : undefined;
  const studentId = uuid.safeParse(student).success ? student : undefined;
  const query = q?.trim().slice(0, 80) || undefined;

  const [salesR, itemsR, searchR, profileR, statementR] = await Promise.allSettled([
    canteenDaySales(ctx, { date: day }),
    canteenItems(ctx, { includeInactive: true }),
    query ? listStudents(ctx, query, 1, { status: "active" }) : Promise.resolve(null),
    studentId ? getStudentProfile(ctx, studentId) : Promise.resolve(null),
    studentId ? canteenStatement(ctx, studentId) : Promise.resolve(null),
  ]);
  for (const r of [salesR, itemsR, searchR, profileR, statementR]) {
    if (r.status === "rejected") console.error("canteen page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }
  const items = itemsR.status === "fulfilled" ? itemsR.value : [];
  const onSale = items.filter((i) => i.isActive);
  const studentHref = (id: string) => `/${institutionSlug}/canteen?${new URLSearchParams({ ...(query ? { q: query } : {}), student: id })}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Canteen" description="Sell at the counter, record top-ups, and keep the menu up to date." />

      <section aria-labelledby="canteen-counter" className="space-y-3">
        <h2 id="canteen-counter" className="text-base font-semibold">
          Counter
        </h2>
        <Card>
          <CardContent className="space-y-4">
            <form method="get" className="flex gap-2" role="search">
              <label htmlFor="canteen-q" className="sr-only">
                Find a student
              </label>
              <Input id="canteen-q" name="q" defaultValue={query} maxLength={80} placeholder="Student name or admission no" />
              <Button type="submit" variant="outline">
                Find
              </Button>
            </form>
            {searchR.status === "rejected" ? (
              <ErrorState title="Could not search students" description="Refresh to try again." />
            ) : searchR.value && searchR.value.students.length === 0 ? (
              <EmptyState bare title="No active student matches" description="Try the admission number or first name." />
            ) : searchR.value ? (
              <ul className="divide-y rounded-md border text-sm" aria-label="Matching students">
                {searchR.value.students.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={studentHref(s.id)}
                      aria-current={s.id === studentId ? "true" : undefined}
                      className="flex min-h-10 items-center justify-between gap-3 px-3 hover:bg-muted aria-[current=true]:bg-muted aria-[current=true]:font-medium"
                    >
                      <span>{[s.firstName, s.lastName].filter(Boolean).join(" ")}</span>
                      <span className="text-muted-foreground">
                        {s.admissionNo}
                        {s.gradeName ? ` · ${s.gradeName}${s.sectionName ? `-${s.sectionName}` : ""}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
                {searchR.value.total > searchR.value.students.length && (
                  <li className="px-3 py-2 text-muted-foreground">
                    Showing {searchR.value.students.length} of {searchR.value.total}. Narrow the search.
                  </li>
                )}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        {studentId &&
          (profileR.status === "rejected" || statementR.status === "rejected" ? (
            <ErrorState title="Could not load this student's canteen account" description="Refresh to try again." />
          ) : !profileR.value || !statementR.value ? (
            <EmptyState title="Student not found" description="Search again and pick a student from the list." />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{[profileR.value.firstName, profileR.value.lastName].filter(Boolean).join(" ")}</CardTitle>
                <CardDescription>
                  {profileR.value.admissionNo}
                  {profileR.value.status !== "active" && " · not active, sales and top-ups are blocked"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <p className="text-sm text-muted-foreground">Balance</p>
                  <p className={`text-3xl font-semibold tabular-nums ${statementR.value.balancePaise <= 0 ? "text-destructive" : ""}`}>
                    {paise(statementR.value.balancePaise)}
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Sell</h3>
                  <SellForm key={studentId} institutionSlug={institutionSlug} studentId={studentId} items={onSale} />
                </div>
                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    Top up <SimulatedBadge />
                  </h3>
                  <p className="text-xs text-muted-foreground">No payment is taken here. Record cash already received; the balance goes up by that amount.</p>
                  <TopupForm key={studentId} institutionSlug={institutionSlug} studentId={studentId} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Recent activity</h3>
                  <CanteenHistory transactions={statementR.value.transactions} />
                </div>
              </CardContent>
            </Card>
          ))}
      </section>

      <section aria-labelledby="canteen-sales" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="canteen-sales" className="text-base font-semibold">
            Day sales
          </h2>
          <form method="get" className="flex items-end gap-2">
            {query && <input type="hidden" name="q" value={query} />}
            {studentId && <input type="hidden" name="student" value={studentId} />}
            <label htmlFor="canteen-date" className="sr-only">
              Sales day
            </label>
            <Input id="canteen-date" name="date" type="date" defaultValue={day ?? canteenToday(ctx)} className="w-40" />
            <Button type="submit" variant="outline" size="sm">
              Show
            </Button>
          </form>
        </div>
        {salesR.status === "rejected" ? (
          <ErrorState title="Could not load sales" description="Refresh to try again." />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="tabular-nums">{paise(salesR.value.salesPaise)} sold</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                {dayFmt.format(new Date(`${salesR.value.date}T00:00:00Z`))} · {salesR.value.purchaseCount} sales · {paise(salesR.value.topupPaise)} topped up (
                {salesR.value.topupCount}) <SimulatedBadge />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {salesR.value.byItem.length === 0 ? (
                <EmptyState bare title="No sales on this day" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesR.value.byItem.map((i) => (
                      <TableRow key={i.itemId}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{paise(i.amountPaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="canteen-menu" className="space-y-3">
        <h2 id="canteen-menu" className="text-base font-semibold">
          Menu
        </h2>
        <Card>
          <CardContent className="space-y-4">
            {itemsR.status === "rejected" ? (
              <ErrorState title="Could not load the menu" description="Refresh to try again." />
            ) : items.length === 0 ? (
              <EmptyState bare title="No menu items yet" description="Add the first item below." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell>
                        <Badge variant={i.isActive ? "success" : "outline"}>{i.isActive ? "On sale" : "Off sale"}</Badge>
                      </TableCell>
                      <TableCell>
                        <ItemControls key={`${i.id}:${i.pricePaise}:${i.isActive}`} institutionSlug={institutionSlug} item={i} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <NewItemForm institutionSlug={institutionSlug} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
