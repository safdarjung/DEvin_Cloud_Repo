"use client";

// Late-fee rule for one fee structure. UX gate only: the action re-checks `finance.plan.manage`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { upsertLateFeeRule } from "@/modules/fee-plans/actions";
import { paiseToRupeesText, rupeesTextToPaise } from "@/modules/fee-plans/paise";

interface Rule {
  kind: "flat" | "per_day";
  amount: number;
  graceDays: number;
  cap: number | null;
  isActive: boolean;
}

const asText = (rupees: number | null | undefined) => (rupees == null ? "" : paiseToRupeesText(Math.round(rupees * 100)));

export function LateFeeForm({ institutionSlug, feeStructureId, label, rule }: { institutionSlug: string; feeStructureId: string; label: string; rule: Rule | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [f, setF] = useState({ kind: rule?.kind ?? "flat", amount: asText(rule?.amount), graceDays: String(rule?.graceDays ?? 0), cap: asText(rule?.cap), isActive: rule?.isActive ?? true });
  const id = (n: string) => `lf-${feeStructureId}-${n}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = rupeesTextToPaise(f.amount);
    const cap = f.cap.trim() === "" ? null : rupeesTextToPaise(f.cap);
    if (amount === null || cap === undefined || (f.cap.trim() !== "" && cap === null)) {
      setErrors({ amount: amount === null ? ["Enter rupees, e.g. 50 or 50.50."] : [], cap: ["Enter rupees, e.g. 500."] });
      return;
    }
    start(async () => {
      const res = await upsertLateFeeRule(institutionSlug, {
        feeStructureId,
        kind: f.kind,
        amount: Number(paiseToRupeesText(amount)),
        graceDays: Number(f.graceDays) || 0,
        cap: f.kind === "per_day" && cap !== null ? Number(paiseToRupeesText(cap)) : null,
        isActive: f.isActive,
      });
      if (res.ok) {
        setErrors({});
        toast.success(`Late-fee rule saved for ${label}`);
        router.refresh();
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(describeActionError(res.error));
      }
    });
  }

  const err = (k: string) => errors[k]?.length ? <p role="alert" className="mt-1 text-xs text-destructive">{errors[k].join(" ")}</p> : null;
  return (
    <form onSubmit={submit} aria-busy={pending} className="grid gap-3 sm:grid-cols-5">
      <div>
        <Label htmlFor={id("kind")}>Type</Label>
        <select id={id("kind")} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Rule["kind"] })} className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="flat">Flat, once</option>
          <option value="per_day">Per day late</option>
        </select>
      </div>
      <div>
        <Label htmlFor={id("amount")}>{f.kind === "flat" ? "Fee (₹)" : "Fee per day (₹)"}</Label>
        <Input id={id("amount")} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-invalid={Boolean(errors.amount?.length)} />
        {err("amount")}
      </div>
      <div>
        <Label htmlFor={id("grace")}>Grace days</Label>
        <Input id={id("grace")} inputMode="numeric" value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: e.target.value })} aria-invalid={Boolean(errors.graceDays?.length)} />
        {err("graceDays")}
      </div>
      <div>
        <Label htmlFor={id("cap")}>Cap (₹){f.kind === "per_day" ? "" : " — per-day only"}</Label>
        <Input id={id("cap")} inputMode="decimal" value={f.cap} disabled={f.kind !== "per_day"} onChange={(e) => setF({ ...f, cap: e.target.value })} aria-invalid={Boolean(errors.cap?.length)} />
        {err("cap")}
      </div>
      <div className="flex items-end gap-3">
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : rule ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}
