import "server-only";
// F-UI-12 (live-fabric studio lane) — studio.read queries. RLS (0107)
// already narrows visibility to owner/principal/admin; the institution_id
// filter below is defense in depth, same shape as every other queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import { StudioProposalSchema, StudioRequestContextSchema, type StudioProposalInput } from "./studio.schemas";

type StudioRequestRow = Database["public"]["Tables"]["studio_requests"]["Row"];

export type StudioRequestStatus = "submitted" | "proposed" | "approved" | "rejected" | "in_progress" | "delivered";

export interface StudioRequestRecord {
  id: string;
  institutionId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  problem: string;
  desiredOutcome: string;
  context: { userRoles?: string[]; existingSystems?: string[]; integrations?: string[]; constraints?: string };
  terms: { budgetRange?: string; timeline?: string; successCriteria?: string };
  status: StudioRequestStatus;
  proposal: StudioProposalInput | null;
  notes: string[];
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

function toRecord(row: StudioRequestRow): StudioRequestRecord {
  const contextParsed = StudioRequestContextSchema.safeParse(row.context ?? {});
  const proposalParsed = row.proposal ? StudioProposalSchema.safeParse(row.proposal) : null;
  return {
    id: row.id,
    institutionId: row.institution_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    problem: row.problem,
    desiredOutcome: row.desired_outcome,
    context: contextParsed.success ? contextParsed.data : {},
    terms: (row.terms ?? {}) as StudioRequestRecord["terms"],
    status: row.status as StudioRequestStatus,
    proposal: proposalParsed?.success ? proposalParsed.data : null,
    notes: row.notes ?? [],
    createdBy: row.created_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

/** Every studio request for the caller's institution, newest first. */
export async function listStudioRequests(ctx: TenantContext): Promise<StudioRequestRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("studio_requests")
    .select("*")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toRecord);
}

/** A single studio request by id, or `null` if it doesn't exist or isn't visible to the caller. */
export async function getStudioRequest(ctx: TenantContext, requestId: string): Promise<StudioRequestRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("studio_requests")
    .select("*")
    .eq("institution_id", ctx.institution.id)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data ? toRecord(data) : null;
}
