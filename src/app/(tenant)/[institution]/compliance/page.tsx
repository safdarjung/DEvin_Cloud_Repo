import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { DeleteItemButton, ItemDialog, RenewDialog, StarterDialog } from "@/modules/compliance/components/ComplianceForms";
import { complianceEvents, complianceItems, complianceOwnerOptions, complianceSummary } from "@/modules/compliance/queries";
import { COMPLIANCE_STATUSES } from "@/modules/compliance/schemas";
import type { ComplianceStatus } from "@/modules/compliance/status";
import { COMPLIANCE_CATEGORIES } from "@/modules/compliance/templates";
import { listDocuments } from "@/modules/documents/queries";

const STATUS_LABEL: Record<ComplianceStatus, string> = { overdue: "Overdue", due_soon: "Due within 30 days", ok: "On track" };
const STATUS_TONE = { overdue: "destructive", due_soon: "warning", ok: "success" } as const;
const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.error(`compliance ${label} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export default async function CompliancePage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ category?: string; status?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "compliance");
  requirePermission(ctx, "compliance.read");
  const canManage = hasPermission(ctx, "compliance.manage");

  const category = COMPLIANCE_CATEGORIES.find((c) => c === sp.category);
  const status = COMPLIANCE_STATUSES.find((s) => s === sp.status);

  const [items, all, summary, events, owners, docs] = await Promise.all([
    safe("items", complianceItems(ctx, { category, status })),
    safe("all items", complianceItems(ctx)),
    safe("summary", complianceSummary(ctx)),
    safe("events", complianceEvents(ctx)),
    canManage ? safe("owners", complianceOwnerOptions(ctx)) : Promise.resolve([]),
    canManage ? safe("documents", listDocuments(ctx, {})) : Promise.resolve(null),
  ]);

  const count = (s: ComplianceStatus) => (summary ?? []).filter((r) => r.status === s).reduce((n, r) => n + r.count, 0);
  const documents = (docs?.rows ?? []).map((d) => ({ id: d.id, label: `${d.fileName} (${d.entityLabel})` }));
  const ownerOptions = owners ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance"
        description="Affiliation, safety and statutory renewals, with due dates and history."
        compact
        actions={
          canManage ? (
            <>
              <StarterDialog slug={slug} existingTitles={(all ?? []).map((i) => i.title)} />
              <ItemDialog slug={slug} owners={ownerOptions} />
            </>
          ) : undefined
        }
      />

      {summary === null ? (
        <ErrorState title="Could not load the summary" description="Refresh to try again." />
      ) : (
        <section aria-label="Summary" className="grid gap-3 sm:grid-cols-3">
          {COMPLIANCE_STATUSES.map((s) => (
            <Card key={s}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{STATUS_LABEL[s]}</p>
                <p className="text-2xl font-semibold tabular-nums">{count(s)} {count(s) === 1 ? "item" : "items"}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter items">
        <div>
          <label htmlFor="f-cat" className="block text-xs text-muted-foreground">Category</label>
          <select id="f-cat" name="category" defaultValue={category ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            {COMPLIANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{humanize(c)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-st" className="block text-xs text-muted-foreground">Status</label>
          <select id="f-st" name="status" defaultValue={status ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            {COMPLIANCE_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">Filter</Button>
        {(category || status) && <Link href={`/${slug}/compliance`} className="text-sm underline">Clear</Link>}
      </form>

      {items === null ? (
        <ErrorState title="Could not load items" description="Refresh to try again." />
      ) : items.length === 0 ? (
        <EmptyState
          title={category || status ? "No items match" : "No items yet"}
          description={category || status ? "Change or clear the filters." : canManage ? "Add an item, or load the starter list." : "Nothing is being tracked yet."}
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">
                      {i.title}
                      {(i.authority || i.referenceNo) && (
                        <span className="block text-xs font-normal text-muted-foreground">{[i.authority, i.referenceNo].filter(Boolean).join(" · ")}</span>
                      )}
                    </TableCell>
                    <TableCell>{humanize(i.category)}</TableCell>
                    <TableCell>{dateFmt.format(new Date(`${i.dueOn}T00:00:00Z`))}</TableCell>
                    <TableCell><Badge variant={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge></TableCell>
                    <TableCell>{i.ownerName ?? ""}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <RenewDialog slug={slug} item={i} events={(events ?? []).filter((e) => e.itemId === i.id)} documents={documents} canManage={canManage} />
                        {canManage && <ItemDialog slug={slug} owners={ownerOptions} item={i} />}
                        {canManage && <DeleteItemButton slug={slug} id={i.id} />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
