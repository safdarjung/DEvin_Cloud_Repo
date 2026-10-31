// Display helpers for finance UI. All query amounts are rupees (numeric), never paise.
import type { ComponentProps } from "react";
import type { Badge } from "@/components/ui/badge";

const inrFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
export const inr = (rupees: number): string => inrFormat.format(rupees);

type Variant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

// invoices.status check: issued | part_paid | paid | cancelled
export function invoiceStatusVariant(status: string): Variant {
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

export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
