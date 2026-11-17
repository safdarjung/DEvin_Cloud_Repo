"use client";

// T-032 — 06 §W9 record-payment dialog (AC1-3). `idempotencyKey` is
// generated once per dialog open (packet security rule: "a double submit is
// harmless") — regenerated in `handleOpenChange`, not on every render, so a
// user who double-clicks "Record" while the first submit is still pending
// sends the same key both times and the SQL function's idempotent fast path
// absorbs the duplicate instead of creating a second payment.
import { Label } from "@/components/ui/label";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LimitedBadge } from "@/components/honesty";
import type { ActionResult } from "@/lib/actions/result";
import { inr } from "@/lib/format";
import { recordPayment, type RecordPaymentResult } from "@/modules/finance/actions";
import { paymentModeLabel } from "@/modules/finance/format";

function nowForInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  // datetime-local wants local time with no timezone suffix.
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

interface RecordPaymentDialogProps {
  institutionSlug: string;
  invoiceId: string;
  outstanding: number;
  paymentModes: string[];
  onRecorded?: () => void;
}

export function RecordPaymentDialog({
  institutionSlug,
  invoiceId,
  outstanding,
  paymentModes,
  onRecorded,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [mode, setMode] = useState(paymentModes[0] ?? "cash");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(nowForInput());
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // After a success the page still shows the old invoice until navigation lands; keep the same key so a re-open cannot record twice.
    if (next && !state?.ok) {
      setAmount(outstanding.toFixed(2));
      setMode(paymentModes[0] ?? "cash");
      setReference("");
      setReceivedAt(nowForInput());
      setIdempotencyKey(crypto.randomUUID());
    }
  }

  const [state, formAction, pending] = useActionState<ActionResult<RecordPaymentResult> | null, FormData>(
    async () => {
      const result = await recordPayment(institutionSlug, {
        invoiceId,
        amount: Number(amount),
        mode,
        reference: reference.trim() || undefined,
        receivedAt: new Date(receivedAt),
        idempotencyKey,
      });
      if (result.ok) {
        onRecorded?.();
        toast.success(`Payment recorded. Receipt ${result.data.receiptNo}.`);
        // Dialog stays open (submit locked) until the receipt page replaces this one.
        router.push(`/${institutionSlug}/finance/receipts/${result.data.receiptId}`);
      }
      return result;
    },
    null,
  );

  if (outstanding <= 0 || paymentModes.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <LimitedBadge /> Payments are recorded manually (cash/UPI/bank reference).
            </span>
            <span>Outstanding: {inr(outstanding)}. Contact admin to reverse a recorded payment.</span>
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div>
            <Label className="mb-1 block" htmlFor="paymentAmount">
              Amount
            </Label>
            <Input
              id="paymentAmount"
              type="number"
              min="0.01"
              step="0.01"
              max={outstanding}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="mb-1 block" htmlFor="paymentMode">
              Mode
            </Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="paymentMode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentModes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {paymentModeLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block" htmlFor="paymentReference">
              Reference (cheque/UTR number, optional)
            </Label>
            <Input id="paymentReference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1 block" htmlFor="paymentReceivedAt">
              Received at
            </Label>
            <Input
              id="paymentReceivedAt"
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              required
            />
          </div>

          {state && !state.ok && (
            <p role="alert" className="text-destructive text-sm">
              {state.error.message}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || state?.ok || !amount || Number(amount) <= 0}>
              {pending ? "Recording…" : state?.ok ? "Recorded, opening receipt…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
