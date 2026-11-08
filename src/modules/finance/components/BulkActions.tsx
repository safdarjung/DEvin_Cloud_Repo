"use client";

// Bulk actions over a server-rendered table. The table renders
// `<BulkCheckbox value={id} />` per selectable row; this form reads the
// checked ids on submit and calls the matching server action. Each action
// re-checks permission, tenant and every id server-side (defineAction + RPC),
// so the selection here is only a convenience.
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import { bulkGenerateStudentInvoices } from "@/modules/finance/actions";
import { sendInvoiceReminders } from "@/modules/finance/reminders.actions";
import type { PickerOption } from "@/modules/finance/queries";
import { cn } from "cn";

const FIELD = "ids";

export function BulkCheckbox({ value, label }: { value: string; label: string }) {
  return (
    <input
      type="checkbox"
      name={FIELD}
      value={value}
      aria-label={label}
      className="size-4 cursor-pointer rounded border-input accent-primary"
    />
  );
}

type Kind = { kind: "remind" } | { kind: "invoice"; terms: PickerOption[] };

export function BulkActions({
  institutionSlug,
  children,
  className,
  ...props
}: Kind & { institutionSlug: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [termId, setTermId] = useState(props.kind === "invoice" ? (props.terms[0]?.id ?? "") : "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const boxes = () => Array.from(formRef.current?.querySelectorAll<HTMLInputElement>(`input[name="${FIELD}"]`) ?? []);
  const recount = () => setCount(boxes().filter((b) => b.checked).length);
  const toggleAll = () => {
    const all = boxes();
    const next = all.some((b) => !b.checked);
    for (const b of all) b.checked = next;
    recount();
  };

  function run() {
    const ids = boxes().filter((b) => b.checked).map((b) => b.value);
    if (ids.length === 0) return;
    setMessage(null);
    startTransition(async () => {
      let result: ActionResult<{ text: string }>;
      if (props.kind === "remind") {
        const r = await sendInvoiceReminders(institutionSlug, { invoiceIds: ids });
        result = r.ok ? { ok: true, data: { text: `Reminders queued for ${r.data.invoiceCount} invoice${r.data.invoiceCount === 1 ? "" : "s"}. Paid invoices are skipped.` } } : r;
      } else {
        const r = await bulkGenerateStudentInvoices(institutionSlug, { termId, studentIds: ids });
        result = r.ok
          ? { ok: true, data: { text: `${r.data.generated.length} invoice${r.data.generated.length === 1 ? "" : "s"} generated${r.data.failed.length ? `, ${r.data.failed.length} failed (${r.data.failed[0]!.message})` : ""}.` } }
          : r;
      }
      setMessage(result.ok ? { ok: true, text: result.data.text } : { ok: false, text: result.error.message });
      if (result.ok) {
        for (const b of boxes()) b.checked = false;
        setCount(0);
        router.refresh();
      }
    });
  }

  return (
    <form ref={formRef} onChange={recount} onSubmit={(e) => (e.preventDefault(), run())} className={cn("space-y-3", className)}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm transition-colors duration-(--duration-fast)",
          count > 0 && "border-primary/40 bg-primary/5",
        )}
      >
        <Button type="button" size="sm" variant="ghost" onClick={toggleAll}>
          Select all
        </Button>
        <span className="tabular-nums text-muted-foreground" aria-live="polite">
          {count} selected
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {props.kind === "invoice" && (
            <select
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              aria-label="Term for new invoices"
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            >
              {props.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" size="sm" disabled={count === 0 || pending || (props.kind === "invoice" && !termId)}>
            {pending ? "Working…" : props.kind === "remind" ? "Send reminders" : "Generate invoices"}
          </Button>
        </div>
      </div>
      {message && (
        <p role="status" className={cn("text-sm", message.ok ? "text-muted-foreground" : "text-destructive")}>
          {message.text}
        </p>
      )}
      {children}
    </form>
  );
}
