import type { BadgeVariant } from "@/lib/format";

export function assignmentStatusVariant(status: string): BadgeVariant {
  return status === "published" ? "success" : status === "draft" ? "warning" : "outline";
}
