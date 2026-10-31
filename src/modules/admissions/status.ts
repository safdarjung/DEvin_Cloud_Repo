import type { BadgeVariant } from "@/lib/format";

// applications.status check: 20261028000007_admissions.sql
export function applicationStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "accepted":
    case "enrolled":
      return "success";
    case "submitted":
    case "under_review":
    case "interaction_scheduled":
    case "offered":
      return "info";
    case "withdrawn":
      return "warning";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

// enquiries.status check (default stages, 20261028000007_admissions.sql);
// settings.admissions.stages may add custom stages, which fall to outline.
export function enquiryStatusVariant(stage: string): BadgeVariant {
  switch (stage) {
    case "converted":
      return "success";
    case "new":
    case "contacted":
    case "visit_scheduled":
    case "application_sent":
      return "info";
    default:
      return "outline";
  }
}
