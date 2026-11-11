"use client";

// Compliance controls. Hiding them is UX only: actions re-check compliance.manage and the Zod schema.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LimitedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import { createComplianceItem, deleteComplianceItem, loadComplianceStarter, renewComplianceItem, updateComplianceItem } from "@/modules/compliance/actions";
import type { ComplianceEventRow, ComplianceItemRow } from "@/modules/compliance/queries";
import { COMPLIANCE_CATEGORIES, COMPLIANCE_STARTER } from "@/modules/compliance/templates";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun(onDone?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>, success: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        onDone?.();
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return { pending, run };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export function ItemDialog({ slug, owners, item }: { slug: string; owners: { id: string; label: string }[]; item?: ComplianceItemRow }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun(() => setOpen(false));
  const [f, setF] = useState({
    title: item?.title ?? "",
    category: item?.category ?? "affiliation",
    authority: item?.authority ?? "",
    referenceNo: item?.referenceNo ?? "",
    dueOn: "",
    months: item?.renewEveryMonths ? String(item.renewEveryMonths) : "",
    owner: item?.ownerStaffId ?? "",
    notes: item?.notes ?? "",
  });
  const id = item?.id ?? "new";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = {
      title: f.title,
      category: f.category as (typeof COMPLIANCE_CATEGORIES)[number],
      authority: orNull(f.authority),
      referenceNo: orNull(f.referenceNo),
      renewEveryMonths: f.months ? Number(f.months) : null,
      ownerStaffId: f.owner || null,
      notes: orNull(f.notes),
    };
    run(() => (item ? updateComplianceItem(slug, { id: item.id, ...base }) : createComplianceItem(slug, { ...base, dueOn: f.dueOn })), item ? "Item updated" : "Item added");
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={item ? "outline" : "default"}>
          {item ? "Edit" : "Add item"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "Add compliance item"}</DialogTitle>
          <DialogDescription>{item ? "The due date moves only when you renew the item." : "Set the first due date. After that it moves only by renewing."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
          <div>
            <Label htmlFor={`t-${id}`}>Title</Label>
            <Input id={`t-${id}`} required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`c-${id}`}>Category</Label>
              <select id={`c-${id}`} className={SELECT_CLASS} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {COMPLIANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </div>
            {!item && (
              <div>
                <Label htmlFor={`d-${id}`}>First due date</Label>
                <Input id={`d-${id}`} type="date" required value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} />
              </div>
            )}
            <div>
              <Label htmlFor={`a-${id}`}>Authority</Label>
              <Input id={`a-${id}`} maxLength={200} value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`r-${id}`}>Reference no</Label>
              <Input id={`r-${id}`} maxLength={100} value={f.referenceNo} onChange={(e) => setF({ ...f, referenceNo: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`m-${id}`}>Renew every (months)</Label>
              <Input id={`m-${id}`} type="number" min={1} max={120} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`o-${id}`}>Owner</Label>
              <select id={`o-${id}`} className={SELECT_CLASS} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
                <option value="">Nobody yet</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor={`n-${id}`}>Notes</Label>
            <Input id={`n-${id}`} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {item ? "Save" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenewDialog({
  slug,
  item,
  events,
  documents,
  canManage,
}: {
  slug: string;
  item: ComplianceItemRow;
  events: ComplianceEventRow[];
  documents: { id: string; label: string }[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun(() => setOpen(false));
  const [f, setF] = useState({ renewedOn: "", newDueOn: "", documentId: "", note: "" });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        renewComplianceItem(slug, {
          itemId: item.id,
          renewedOn: f.renewedOn || undefined,
          newDueOn: f.newDueOn || undefined,
          documentId: f.documentId || undefined,
          note: f.note.trim() || undefined,
        }),
      "Renewed",
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {canManage ? "Renew / history" : "History"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>Due {fmt(item.dueOn)}.</DialogDescription>
        </DialogHeader>
        {canManage && (
          <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`ro-${item.id}`}>Renewed on</Label>
                <Input id={`ro-${item.id}`} type="date" value={f.renewedOn} onChange={(e) => setF({ ...f, renewedOn: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">Blank means today.</p>
              </div>
              <div>
                <Label htmlFor={`nd-${item.id}`}>New due date</Label>
                <Input id={`nd-${item.id}`} type="date" required={!item.renewEveryMonths} value={f.newDueOn} onChange={(e) => setF({ ...f, newDueOn: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">{item.renewEveryMonths ? `Blank adds ${item.renewEveryMonths} months.` : "Required: no renewal period is set."}</p>
              </div>
            </div>
            <div>
              <Label htmlFor={`dc-${item.id}`}>
                Certificate document <LimitedBadge />
              </Label>
              <select id={`dc-${item.id}`} className={SELECT_CLASS} value={f.documentId} onChange={(e) => setF({ ...f, documentId: e.target.value })}>
                <option value="">None</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Attach an existing document. Direct upload here is not available yet.</p>
            </div>
            <div>
              <Label htmlFor={`nt-${item.id}`}>Note</Label>
              <Input id={`nt-${item.id}`} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Record renewal
              </Button>
            </DialogFooter>
          </form>
        )}
        <section aria-label="Renewal history">
          <h3 className="text-sm font-medium">History</h3>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No renewals recorded yet.</p>
          ) : (
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  Renewed {fmt(e.renewedOn)}, next due {fmt(e.newDueOn)}
                  {e.documentName ? `, document: ${e.documentName}` : ""}
                  {e.note ? ` (${e.note})` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteItemButton({ slug, id }: { slug: string; id: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Delete this item? This cannot be undone.")) run(() => deleteComplianceItem(slug, { id }), "Item deleted");
      }}
    >
      Delete
    </Button>
  );
}

/** Admin fills a due date per title; rows without a date are not added. Existing titles are skipped on the server. */
export function StarterDialog({ slug, existingTitles }: { slug: string; existingTitles: string[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun(() => setOpen(false));
  const have = new Set(existingTitles.map((t) => t.toLowerCase()));
  const rows = COMPLIANCE_STARTER.filter((t) => !have.has(t.title.toLowerCase()));
  const [dates, setDates] = useState<Record<string, string>>({});
  const chosen = rows.filter((r) => dates[r.title]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Load starter list
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Starter list</DialogTitle>
          <DialogDescription>Common items for a school. Enter the due date from your own certificate for each one you want to track. Items without a date are not added.</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every starter item is already on your list.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.title} className="flex items-center justify-between gap-3">
                <label htmlFor={`s-${r.title}`} className="text-sm">
                  {r.title} <span className="text-muted-foreground">({humanize(r.category)})</span>
                </label>
                <Input id={`s-${r.title}`} type="date" className="w-40" value={dates[r.title] ?? ""} onChange={(e) => setDates({ ...dates, [r.title]: e.target.value })} />
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button disabled={pending || chosen.length === 0} onClick={() => run(() => loadComplianceStarter(slug, { items: chosen.map((r) => ({ title: r.title, dueOn: dates[r.title]! })) }), "Starter items added")}>
            Add {chosen.length} item{chosen.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
