import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { ItemForm, MovementForm } from "@/modules/inventory/components/InventoryForms";
import { inventoryMovements, inventoryStock } from "@/modules/inventory/queries";

export const metadata: Metadata = { title: "Inventory" };

const TABS = [
  { key: "stock", label: "Stock" },
  { key: "items", label: "Items" },
  { key: "movements", label: "Movements" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ tab?: string; low?: string; item?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "inventory");
  requirePermission(ctx, "inventory.read");
  const canManage = hasPermission(ctx, "inventory.manage");

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "stock";
  const onlyLow = sp.low === "1";

  const stockR = await Promise.allSettled([inventoryStock(ctx)]).then(([r]) => r);
  if (stockR.status === "rejected") console.error("inventory stock fetch failed:", stockR.reason instanceof Error ? stockR.reason.message : stockR.reason);
  const items = stockR.status === "fulfilled" ? stockR.value : [];
  const itemId = items.find((i) => i.itemId === sp.item)?.itemId ?? items[0]?.itemId;
  const histR = tab === "movements" && itemId ? await Promise.allSettled([inventoryMovements(ctx, itemId)]).then(([r]) => r) : null;
  if (histR?.status === "rejected") console.error("inventory movements fetch failed:", histR.reason instanceof Error ? histR.reason.message : histR.reason);

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" description="Consumables and supplies: what is in stock, what is running low, and every movement." compact />
      <nav aria-label="Inventory sections" className="flex gap-1 border-b">
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

      {stockR.status === "rejected" && <ErrorState title="Could not load inventory" description="Refresh to try again." />}

      {stockR.status === "fulfilled" && tab === "stock" && (
        <section aria-label="Stock" className="space-y-4">
          <div className="flex gap-2 text-sm">
            <Link href="?tab=stock" className={onlyLow ? "text-muted-foreground underline" : "font-medium"}>
              All items
            </Link>
            <Link href="?tab=stock&low=1" className={onlyLow ? "font-medium" : "text-muted-foreground underline"}>
              Low stock only
            </Link>
          </div>
          {(onlyLow ? items.filter((i) => i.isActive && i.isLowStock) : items).length === 0 ? (
            <EmptyState title={onlyLow ? "Nothing is low" : "No items yet"} description={onlyLow ? "Every active item is above its reorder level." : "Add the first item on the Items tab."} />
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder at</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(onlyLow ? items.filter((i) => i.isActive && i.isLowStock) : items).map((i) => (
                      <TableRow key={i.itemId} className={i.isActive && i.isLowStock ? "bg-destructive/5" : undefined}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {i.onHand} {i.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{i.reorderLevel}</TableCell>
                        <TableCell>
                          {!i.isActive ? <Badge variant="outline">Inactive</Badge> : i.isLowStock ? <Badge variant="destructive">Low stock</Badge> : <Badge variant="success">OK</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {stockR.status === "fulfilled" && tab === "items" && (
        <section aria-label="Items" className="space-y-4">
          {items.length === 0 ? (
            <EmptyState title="No items yet" description="Add the first item below." />
          ) : (
            <Card>
              <CardContent className="space-y-4 pt-6">
                {items.map((i) => (
                  <ItemForm key={i.itemId} institutionSlug={slug} item={i} />
                ))}
              </CardContent>
            </Card>
          )}
          {canManage && (
            <Card>
              <CardHeader>
                <CardTitle>New item</CardTitle>
              </CardHeader>
              <CardContent>
                <ItemForm institutionSlug={slug} />
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {stockR.status === "fulfilled" && tab === "movements" && (
        <section aria-label="Movements" className="space-y-4">
          {items.length === 0 ? (
            <EmptyState title="No items yet" description="Add an item before recording movements." />
          ) : (
            <>
              {canManage && (
                <Card>
                  <CardHeader>
                    <CardTitle>Record movement</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <MovementForm key={itemId} institutionSlug={slug} items={items} itemId={itemId} />
                  </CardContent>
                </Card>
              )}
              <nav aria-label="History for item" className="flex flex-wrap gap-2 text-sm">
                {items.map((i) => (
                  <Link key={i.itemId} href={`?tab=movements&item=${i.itemId}`} className={i.itemId === itemId ? "font-medium underline" : "text-muted-foreground underline"}>
                    {i.name}
                  </Link>
                ))}
              </nav>
              {histR?.status === "rejected" ? (
                <ErrorState title="Could not load history" description="Refresh to try again." />
              ) : !histR || histR.value.length === 0 ? (
                <EmptyState title="No movements yet" description="Record stock in to start the history." />
              ) : (
                <Card>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead>Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {histR.value.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell>{dateTimeFmt.format(new Date(m.createdAt))}</TableCell>
                            <TableCell>{humanize(m.kind)}</TableCell>
                            <TableCell className="text-right tabular-nums">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</TableCell>
                            <TableCell>{m.note ?? ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
