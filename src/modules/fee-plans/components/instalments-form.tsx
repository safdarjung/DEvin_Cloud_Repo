"use client";

// Set the instalment plan of one invoice (2-12 parts, rising dates, parts sum to the invoice total).
// UX gate only: the action re-checks `finance.plan.manage`; the SQL definer re-checks the sum.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { setInstalments } from "@/modules/fee-plans/actions";
import { paiseToRupeesText, rupeesTextToPaise, splitPaise } from "@/modules/fee-plans/paise";

interface Part {
  dueOn: string;
  amount: string;
}

export function InstalmentsForm({ institutionSlug, invoiceId, totalPaise, initial }: { institutionSlug: string; invoiceId: string; totalPaise: number; initial: { dueOn: string; amountPaise: number }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>(
    initial.length >= 2 ? initial.map((p) => ({ dueOn: p.dueOn, amount: paiseToRupeesText(p.amountPaise) })) : splitPaise(totalPaise, 2).map((p) => ({ dueOn: "", amount: paiseToRupeesText(p) })),
  );
  const sum = parts.reduce((n, p) => n + (rupeesTextToPaise(p.amount) ?? 0), 0);

  const resize = (n: number) => {
    const even = splitPaise(totalPaise, n).map(paiseToRupeesText);
    setParts(Array.from({ length: n }, (_, i) => ({ dueOn: parts[i]?.dueOn ?? "", amount: even[i] })));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const paise = parts.map((p) => rupeesTextToPaise(p.amount));
    if (paise.some((p) => p === null) || parts.some((p) => !p.dueOn)) return setError("Every instalment needs a due date and a rupee amount.");
    if (sum !== totalPaise) return setError(`Instalments add up to ₹${paiseToRupeesText(sum)}; the invoice total is ₹${paiseToRupeesText(totalPaise)}.`);
    start(async () => {
      const res = await setInstalments(institutionSlug, { invoiceId, parts: parts.map((p) => ({ dueOn: p.dueOn, amount: Number(paiseToRupeesText(rupeesTextToPaise(p.amount) ?? 0)) })) });
      if (res.ok) {
        setError(null);
        toast.success("Instalment plan saved");
        router.refresh();
      } else {
        setError(describeActionError(res.error));
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className="space-y-3">
      <div>
        <Label htmlFor="inst-count">Number of instalments</Label>
        <select id="inst-count" value={parts.length} onChange={(e) => resize(Number(e.target.value))} className="block h-10 w-24 rounded-md border border-input bg-background px-3 text-sm">
          {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <ol className="space-y-2">
        {parts.map((p, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`inst-due-${i}`}>Instalment {i + 1} due date</Label>
              <Input id={`inst-due-${i}`} type="date" value={p.dueOn} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))} />
            </div>
            <div>
              <Label htmlFor={`inst-amt-${i}`}>Instalment {i + 1} amount (₹)</Label>
              <Input id={`inst-amt-${i}`} inputMode="decimal" value={p.amount} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            </div>
          </li>
        ))}
      </ol>
      <p role="status" className="text-xs text-muted-foreground tabular-nums">
        Total ₹{paiseToRupeesText(sum)} of ₹{paiseToRupeesText(totalPaise)}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save instalment plan"}
      </Button>
    </form>
  );
}
