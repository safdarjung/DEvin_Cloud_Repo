// Shared display helpers. Amounts are rupees (numeric), never paise.
import type { ComponentProps } from "react";
import type { Badge } from "@/components/ui/badge";

const inrFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
export const inr = (rupees: number): string => inrFormat.format(rupees);

export type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
