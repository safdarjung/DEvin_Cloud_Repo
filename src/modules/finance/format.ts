// Finance-specific display helpers. Generic ones (inr, humanize) live in @/lib/format.
import type { BadgeVariant } from "@/lib/format";

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
