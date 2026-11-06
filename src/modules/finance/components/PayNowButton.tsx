"use client";

import { useRef, useTransition } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPaymentIntent } from "@/modules/finance/online-payments.actions";

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: () => void;
  modal: { ondismiss: () => void };
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

/**
 * Guardian pays one invoice's outstanding balance. The server action creates
 * the order; Razorpay checkout (test keys only) is loaded on this page only.
 * Payment is recorded by the Razorpay webhook, never by this client, so a
 * completed checkout says "submitted", not "paid". Without keys the server
 * returns a simulated intent and nothing is charged.
 */
export function PayNowButton({ institutionSlug, invoiceId, amount }: { institutionSlug: string; invoiceId: string; amount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // One key per button so a double-click or retry reuses the same intent.
  const idempotencyKey = useRef<string | null>(null);

  const run = () =>
    start(async () => {
      idempotencyKey.current ??= crypto.randomUUID();
      const result = await createPaymentIntent(institutionSlug, { invoiceId, amount, idempotencyKey: idempotencyKey.current });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const intent = result.data;
      if (intent.provider !== "razorpay" || !intent.keyId) {
        toast.info("Online payments are not live for this school yet. Nothing was charged.");
        return;
      }
      if (!window.Razorpay) {
        toast.error("Payment window failed to load. Check your connection and try again.");
        return;
      }
      new window.Razorpay({
        key: intent.keyId,
        order_id: intent.orderId,
        amount: intent.amountPaise,
        currency: intent.currency,
        name: "School fees",
        handler: () => {
          idempotencyKey.current = null;
          toast.success("Payment submitted. It shows as paid once the bank confirms.");
          router.refresh();
        },
        modal: { ondismiss: () => toast.info("Payment cancelled.") },
      }).open();
    });

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <Button type="button" size="sm" className="min-h-10" disabled={pending} onClick={run}>
        {pending ? "Starting…" : "Pay now"}
      </Button>
    </>
  );
}
