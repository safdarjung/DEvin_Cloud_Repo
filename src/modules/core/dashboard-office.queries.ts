import "server-only";
// M16-T8 — dashboard.finance + dashboard.admissions (06 rulings "Role
// dashboards"). Composers over existing owner reads; no new SQL. A field is
// null when its permission/module is missing (the sub-read never runs).
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { currentTermCollections } from "./dashboard.queries";
import { listDefaulters, type DefaulterRow, type TermCollectionSummary } from "@/modules/finance/queries";
import {
  getAdmissionsFunnelCounts,
  listEnquiriesByStage,
  type AdmissionsFunnelCounts,
  type EnquiryRow,
} from "@/modules/admissions/queries";

export interface FinanceDashboard {
  collections: TermCollectionSummary | null;
  overdue: DefaulterRow[] | null;
}

export interface AdmissionsDashboard {
  funnel: AdmissionsFunnelCounts | null;
  recentEnquiries: EnquiryRow[] | null;
}

const OVERDUE_LIMIT = 10;
const RECENT_ENQUIRY_LIMIT = 5;

export async function financeDashboard(ctx: TenantContext): Promise<FinanceDashboard> {
  if (!ctx.permissions.has("finance.read")) return { collections: null, overdue: null };

  const collections = await currentTermCollections(ctx);
  if (!collections) return { collections, overdue: null };

  const today = todayInInstitutionTimezone(ctx);
  const defaulters = await listDefaulters(ctx, { termId: collections.termId });
  const overdue = defaulters
    .filter((d) => d.dueOn !== null && d.dueOn < today)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, OVERDUE_LIMIT);

  return { collections, overdue };
}

export async function admissionsDashboard(ctx: TenantContext): Promise<AdmissionsDashboard> {
  if (!ctx.permissions.has("admissions.enquiry.read") || !isModuleEnabled(ctx, "admissions")) {
    return { funnel: null, recentEnquiries: null };
  }

  const [funnel, byStage] = await Promise.all([getAdmissionsFunnelCounts(ctx), listEnquiriesByStage(ctx)]);
  const recentEnquiries = Object.values(byStage)
    .flat()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECENT_ENQUIRY_LIMIT);

  return { funnel, recentEnquiries };
}
