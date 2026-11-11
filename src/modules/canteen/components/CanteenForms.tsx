"use client";

// Canteen counter + menu controls. Hiding them is UX only: every action
// re-checks canteen.manage and its Zod schema server-side, and money moves
// only through the canteen_topup / canteen_purchase definers.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { createCanteenItem, purchaseCanteen, topupCanteen, updateCanteenItem } from "@/modules/canteen/actions";
import { paise } from "@/modules/canteen/components/CanteenHistory";
import type { CanteenItem } from "@/modules/canteen/queries";
import {
  CANTEEN_QUANTITY_MAX,
  CanteenItemCreateSchema,
  CanteenItemUpdateSchema,
  CanteenPurchaseSchema,
  CanteenTopupSchema,
} from "@/modules/canteen/schemas";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

/** "12.50" -> 1250. Non-numbers become NaN, which the Zod int check rejects. */
function rupeesToPaise(value: string): number {
  return value.trim() === "" ? Number.NaN : Math.round(Number(value) * 100);
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Check the details and try again.";
}

function useActionRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run<T>(call: () => Promise<ActionResult<T>>, onOk: (data: T) => void) {
    start(async () => {
      const res = await call();
      if (res.ok) {
        onOk(res.data);
        router.refresh();
      } else {
        toast.error(describeActionError(res.error));
      }
    });
  }
  return { pending, run };
}

export function SellForm({ institutionSlug, studentId, items }: { institutionSlug: string; studentId: string; items: CanteenItem[] }) {
  const { pending, run } = useActionRunner();
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const picked = items.find((i) => i.id === itemId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CanteenPurchaseSchema.safeParse({ studentId, itemId, quantity: Number(quantity) });
    if (!parsed.success) {
      toast.error(firstIssue(parsed.error));
      return;
    }
    run(
      () => purchaseCanteen(institutionSlug, parsed.data),
      (d) => {
        toast.success(`Sold. New balance ${paise(d.balancePaise)}`);
        setQuantity("1");
      },
    );
  }

  if (items.length === 0) return <p className="text-sm text-muted-foreground">No items on sale. Add one to the menu below.</p>;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end" aria-busy={pending}>
      <div>
        <Label htmlFor="canteen-sell-item">Item</Label>
        <select id="canteen-sell-item" className={SELECT_CLASS} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {paise(i.pricePaise)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="canteen-sell-qty">Qty</Label>
        <Input id="canteen-sell-qty" type="number" inputMode="numeric" min={1} max={CANTEEN_QUANTITY_MAX} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Selling…" : picked ? `Sell · ${paise(picked.pricePaise * (Number(quantity) || 0))}` : "Sell"}
      </Button>
    </form>
  );
}

export function TopupForm({ institutionSlug, studentId }: { institutionSlug: string; studentId: string }) {
  const { pending, run } = useActionRunner();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CanteenTopupSchema.safeParse({ studentId, amountPaise: rupeesToPaise(amount), note: note.trim() || undefined });
    if (!parsed.success) {
      toast.error("Enter an amount between ₹1 and ₹10,000.");
      return;
    }
    run(
      () => topupCanteen(institutionSlug, parsed.data),
      (d) => {
        toast.success(`Top-up recorded. New balance ${paise(d.balancePaise)}`);
        setAmount("");
        setNote("");
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end" aria-busy={pending}>
      <div>
        <Label htmlFor="canteen-topup-amount">Amount (₹)</Label>
        <Input id="canteen-topup-amount" type="number" inputMode="decimal" min={1} max={10000} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="canteen-topup-note">Note (optional)</Label>
        <Input id="canteen-topup-note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cash received at counter" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Recording…" : "Record top-up"}
      </Button>
    </form>
  );
}

export function NewItemForm({ institutionSlug }: { institutionSlug: string }) {
  const { pending, run } = useActionRunner();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CanteenItemCreateSchema.safeParse({ name, pricePaise: rupeesToPaise(price) });
    if (!parsed.success) {
      toast.error("Enter a name and a price between ₹0.01 and ₹1,000.");
      return;
    }
    run(
      () => createCanteenItem(institutionSlug, parsed.data),
      () => {
        toast.success("Item added to the menu");
        setName("");
        setPrice("");
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" aria-busy={pending}>
      <div>
        <Label htmlFor="canteen-item-name">Item name</Label>
        <Input id="canteen-item-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="canteen-item-price">Price (₹)</Label>
        <Input id="canteen-item-price" type="number" inputMode="decimal" min={0.01} max={1000} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add item"}
      </Button>
    </form>
  );
}

export function ItemControls({ institutionSlug, item }: { institutionSlug: string; item: CanteenItem }) {
  const { pending, run } = useActionRunner();
  const [price, setPrice] = useState((item.pricePaise / 100).toFixed(2));
  const pricePaise = rupeesToPaise(price);

  function savePrice(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CanteenItemUpdateSchema.safeParse({ id: item.id, pricePaise });
    if (!parsed.success) {
      toast.error("Price must be between ₹0.01 and ₹1,000.");
      return;
    }
    run(() => updateCanteenItem(institutionSlug, parsed.data), () => toast.success(`${item.name}: price saved`));
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form onSubmit={savePrice} className="flex items-center gap-2">
        <Label htmlFor={`canteen-price-${item.id}`} className="sr-only">
          Price for {item.name} (₹)
        </Label>
        <Input id={`canteen-price-${item.id}`} className="w-24" type="number" inputMode="decimal" min={0.01} max={1000} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={pending || pricePaise === item.pricePaise}>
          Save
        </Button>
      </form>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(
            () => updateCanteenItem(institutionSlug, { id: item.id, isActive: !item.isActive }),
            () => toast.success(item.isActive ? `${item.name} taken off sale` : `${item.name} back on sale`),
          )
        }
      >
        {item.isActive ? "Take off sale" : "Put on sale"}
      </Button>
    </div>
  );
}
