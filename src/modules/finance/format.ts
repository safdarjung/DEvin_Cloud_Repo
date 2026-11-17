// Finance-specific display helpers. Generic ones (inr, humanize) live in @/lib/format.
import { humanize, type BadgeVariant } from "@/lib/format";

// invoices.status check: issued | part_paid | paid | cancelled
export function invoiceStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "paid":
      return "success";
    case "part_paid":
      return "warning";
    case "issued":
      return "info";
    default:
      return "outline";
  }
}

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  neft: "Bank transfer (NEFT)",
  rtgs: "Bank transfer (RTGS)",
  imps: "Bank transfer (IMPS)",
  bank_transfer: "Bank transfer",
  card: "Card",
  online: "Online",
};

/** Display label for a payment mode code ("upi" -> "UPI"); unknown codes are humanized. */
export function paymentModeLabel(mode: string): string {
  return PAYMENT_MODE_LABELS[mode.toLowerCase()] ?? humanize(mode);
}
