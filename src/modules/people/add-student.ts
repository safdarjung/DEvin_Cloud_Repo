// Where "Add student" goes: no direct create form exists, so reuse the admission flow, else the spreadsheet import.
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";

export function addStudentHref(ctx: TenantContext, slug: string): { href: string; label: string } | null {
  if (isModuleEnabled(ctx, "admissions") && hasPermission(ctx, "admissions.enquiry.read")) return { href: `/${slug}/admissions`, label: "Add student (admission)" };
  if (hasPermission(ctx, "data.import")) return { href: `/${slug}/setup`, label: "Add students (import)" };
  return null;
}
