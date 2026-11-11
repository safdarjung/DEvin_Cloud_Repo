"use client";

// Expense controls. Hiding them is UX only: actions re-check expense.manage and the Zod schema
// (amounts are sent as rupee text and parsed to paise on the server).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createExpenseCategory, recordExpense, setExpenseBudget, updateExpenseCategory, voidExpense } from "@/modules/expenses/actions";
import type { ExpenseCategory } from "@/modules/expenses/queries";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";
const AMOUNT_HINT = "Rupees, up to 2 decimals";

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

function CategorySelect({ id, categories, value, onChange }: { id: string; categories: ExpenseCategory[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function RecordExpenseForm({ institutionSlug, categories, today }: { institutionSlug: string; categories: ExpenseCategory[]; today: string }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ categoryId: categories[0]?.id ?? "", amount: "", spentOn: today, payee: "", note: "" });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => recordExpense(institutionSlug, { categoryId: f.categoryId, amount: f.amount, spentOn: f.spentOn, payee: f.payee.trim() || undefined, note: f.note }),
      "Expense recorded",
      () => setF({ ...f, amount: "", payee: "", note: "" }),
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor="ex-cat">Category</Label>
        <CategorySelect id="ex-cat" categories={categories} value={f.categoryId} onChange={(categoryId) => setF({ ...f, categoryId })} />
      </div>
      <div>
        <Label htmlFor="ex-amt">Amount (₹)</Label>
        <Input id="ex-amt" inputMode="decimal" required placeholder="1500.00" title={AMOUNT_HINT} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="w-32" />
      </div>
      <div>
        <Label htmlFor="ex-date">Date</Label>
        <Input id="ex-date" type="date" required value={f.spentOn} onChange={(e) => setF({ ...f, spentOn: e.target.value })} className="w-40" />
      </div>
      <div>
        <Label htmlFor="ex-payee">Payee (optional)</Label>
        <Input id="ex-payee" maxLength={120} value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} className="w-48" />
      </div>
      <div className="min-w-56 flex-1">
        <Label htmlFor="ex-note">Note</Label>
        <Input id="ex-note" required maxLength={200} placeholder="What was this for?" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <Button type="submit" size="sm" disabled={pending || !f.categoryId}>
        Record expense
      </Button>
    </form>
  );
}

export function VoidExpenseButton({ institutionSlug, expenseId, label }: { institutionSlug: string; expenseId: string; label: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Void ${label}`}>
        Void
      </Button>
    );
  }
  const fieldId = `void-${expenseId}`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => voidExpense(institutionSlug, { id: expenseId, reason }), "Expense voided. A reversing entry was added.", () => setOpen(false));
      }}
      className="flex flex-wrap items-end justify-end gap-2"
      aria-busy={pending}
    >
      <div className="text-left">
        <Label htmlFor={fieldId}>Reason (5–200 characters)</Label>
        <Input id={fieldId} autoFocus required minLength={5} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="w-56" />
      </div>
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Confirm void
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}

export function CategoryForm({ institutionSlug, category }: { institutionSlug: string; category?: ExpenseCategory }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ name: category?.name ?? "", isActive: category?.isActive ?? true });
  const id = category?.id ?? "new";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => (category ? updateExpenseCategory(institutionSlug, { id: category.id, name: f.name, isActive: f.isActive }) : createExpenseCategory(institutionSlug, { name: f.name })),
      category ? "Category saved" : "Category added",
      () => !category && setF({ ...f, name: "" }),
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor={`cat-${id}`}>{category ? "Name" : "New category"}</Label>
        <Input id={`cat-${id}`} required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-56" />
      </div>
      {category && (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {category ? "Save" : "Add category"}
      </Button>
    </form>
  );
}

export function BudgetForm({
  institutionSlug,
  categories,
  defaultStart,
  defaultEnd,
}: {
  institutionSlug: string;
  categories: ExpenseCategory[];
  defaultStart: string;
  defaultEnd: string;
}) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ categoryId: categories[0]?.id ?? "", periodStart: defaultStart, periodEnd: defaultEnd, amount: "" });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(() => setExpenseBudget(institutionSlug, f), "Budget saved", () => setF({ ...f, amount: "" }));
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor="bg-cat">Category</Label>
        <CategorySelect id="bg-cat" categories={categories} value={f.categoryId} onChange={(categoryId) => setF({ ...f, categoryId })} />
      </div>
      <div>
        <Label htmlFor="bg-start">From</Label>
        <Input id="bg-start" type="date" required value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} className="w-40" />
      </div>
      <div>
        <Label htmlFor="bg-end">To</Label>
        <Input id="bg-end" type="date" required value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} className="w-40" />
      </div>
      <div>
        <Label htmlFor="bg-amt">Budget (₹)</Label>
        <Input id="bg-amt" inputMode="decimal" required placeholder="50000" title={AMOUNT_HINT} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="w-32" />
      </div>
      <Button type="submit" size="sm" disabled={pending || !f.categoryId}>
        Set budget
      </Button>
      <p className="w-full text-xs text-muted-foreground">Setting a budget for a category and period that already has one replaces its amount.</p>
    </form>
  );
}
