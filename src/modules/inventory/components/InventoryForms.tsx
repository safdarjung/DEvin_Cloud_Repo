"use client";

// Inventory controls. Hiding them is UX only: actions re-check inventory.manage and the Zod schema.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createInventoryItem, recordInventoryMovement, updateInventoryItem } from "@/modules/inventory/actions";
import type { InventoryStockRow } from "@/modules/inventory/queries";
import { MOVEMENT_KINDS } from "@/modules/inventory/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return { pending, run };
}

export function ItemForm({ institutionSlug, item }: { institutionSlug: string; item?: InventoryStockRow }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ name: item?.name ?? "", unit: item?.unit ?? "", reorderLevel: String(item?.reorderLevel ?? 0), isActive: item?.isActive ?? true });
  const id = item?.itemId ?? "new";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = { name: f.name, unit: f.unit, reorderLevel: Number(f.reorderLevel) };
    run(
      () => (item ? updateInventoryItem(institutionSlug, { id: item.itemId, ...base, isActive: f.isActive }) : createInventoryItem(institutionSlug, base)),
      item ? "Item updated" : "Item added",
      () => !item && setF({ ...f, name: "" }),
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor={`n-${id}`}>Name</Label>
        <Input id={`n-${id}`} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-48" />
      </div>
      <div>
        <Label htmlFor={`u-${id}`}>Unit</Label>
        <Input id={`u-${id}`} value={f.unit} maxLength={20} placeholder="box, pcs" onChange={(e) => setF({ ...f, unit: e.target.value })} className="w-24" />
      </div>
      <div>
        <Label htmlFor={`r-${id}`}>Reorder level</Label>
        <Input id={`r-${id}`} type="number" min={0} value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} className="w-28" />
      </div>
      {item && (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {item ? "Save" : "Add item"}
      </Button>
    </form>
  );
}

export function MovementForm({ institutionSlug, items, itemId }: { institutionSlug: string; items: InventoryStockRow[]; itemId?: string }) {
  const { pending, run } = useRun();
  const [f, setF] = useState<{ itemId: string; kind: (typeof MOVEMENT_KINDS)[number]; quantity: string; note: string }>({
    itemId: itemId ?? items[0]?.itemId ?? "",
    kind: "in",
    quantity: "",
    note: "",
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => recordInventoryMovement(institutionSlug, { itemId: f.itemId, kind: f.kind, quantity: Number(f.quantity), note: f.note || undefined }),
      "Movement recorded",
      () => setF({ ...f, quantity: "", note: "" }),
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor="mv-item">Item</Label>
        <select id="mv-item" className={SELECT_CLASS} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          {items.map((i) => (
            <option key={i.itemId} value={i.itemId}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="mv-kind">Type</Label>
        <select id="mv-kind" className={SELECT_CLASS} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === "in" ? "Stock in" : k === "issue" ? "Issue" : k === "return" ? "Return" : "Adjust (+/-)"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="mv-qty">Quantity</Label>
        <Input id="mv-qty" type="number" step={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} className="w-24" />
      </div>
      <div>
        <Label htmlFor="mv-note">Note</Label>
        <Input id="mv-note" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} className="w-56" />
      </div>
      <Button type="submit" size="sm" disabled={pending || !f.itemId}>
        Record
      </Button>
    </form>
  );
}
