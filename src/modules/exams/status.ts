import type { BadgeVariant } from "@/lib/format";

/** Exam status (check constraint in 20261028000009_exams.sql): draft, marks_entry, verification, published. */
export function examStatusVariant(status: string): BadgeVariant {
  if (status === "published") return "success";
  if (status === "verification") return "warning";
  if (status === "marks_entry") return "info";
  return "outline";
}

/** Recheck status (same migration): submitted, under_review, approved, rejected, applied. */
export function recheckStatusVariant(status: string): BadgeVariant {
  if (status === "approved" || status === "applied") return "success";
  if (status === "rejected") return "destructive";
  if (status === "under_review") return "info";
  if (status === "submitted") return "warning";
  return "outline";
}
