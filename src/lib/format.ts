// Shared display helpers. Amounts are rupees (numeric), never paise.
import type { ComponentProps } from "react";
import type { Badge } from "@/components/ui/badge";

const inrFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
export const inr = (rupees: number): string => inrFormat.format(rupees);

const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Integer paise -> rupee text ("₹2,96,35,350", "₹1,234.50", "-₹5"); the one formatter for money a model sees. */
export function formatINR(paise: number): string {
  const abs = Math.abs(Math.round(paise));
  // Integer split, not paise / 100: no float drift on crore-sized totals.
  const remainder = abs % 100;
  const text = inrWhole.format((abs - remainder) / 100) + (remainder ? `.${String(remainder).padStart(2, "0")}` : "");
  return paise < 0 && abs > 0 ? `-${text}` : text;
}

export type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
