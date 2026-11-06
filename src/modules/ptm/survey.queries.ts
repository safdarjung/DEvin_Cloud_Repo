import "server-only";
// X08-T8 — survey.list / survey.results / survey.mine (X08-tasks.md Task 8
// rulings). Reads over migration 0099 part B's surveys/survey_audiences
// tables (RLS: owner/principal/admin only, T3) and the app.survey_results /
// app.my_open_surveys definers (also T3). Style mirrors
// src/modules/timetable/queries.ts: plain query functions, RLS does the
// real narrowing.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { AppError, mapSqlError } from "@/lib/actions/result";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface SurveyAudienceRow {
  type: "school" | "role" | "grade" | "section";
  role?: string;
  gradeId?: string;
  classSectionId?: string;
}

export interface SurveyRow {
  id: string;
  title: string;
  status: "draft" | "open" | "closed";
  isAnonymous: boolean;
  closesAt: string;
  questionCount: number;
  audiences: SurveyAudienceRow[];
}

function toAudience(row: {
  audience_type: string;
  role: string | null;
  grade_id: string | null;
  class_section_id: string | null;
}): SurveyAudienceRow {
  const type = row.audience_type as SurveyAudienceRow["type"];
  if (row.role) return { type, role: row.role };
  if (row.grade_id) return { type, gradeId: row.grade_id };
  if (row.class_section_id) return { type, classSectionId: row.class_section_id };
  return { type };
}

/** `survey.manage` — every survey in this institution, newest first, with its audiences. RLS (surveys_select/survey_audiences_select, owner/principal/admin only) already narrows rows; the institution_id filter is defense in depth. */
export async function surveyList(ctx: TenantContext, status?: "draft" | "open" | "closed"): Promise<SurveyRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("surveys")
    .select("id, title, status, is_anonymous, closes_at, questions, survey_audiences(audience_type, role, grade_id, class_section_id)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as SurveyRow["status"],
    isAnonymous: row.is_anonymous,
    closesAt: row.closes_at,
    questionCount: Array.isArray(row.questions) ? row.questions.length : 0,
    audiences: (row.survey_audiences ?? []).map(toAudience),
  }));
}

export interface SurveyResultOption {
  label: string;
  count: number;
}

export interface SurveyResultQuestion {
  index: number;
  type: "single" | "multi" | "text";
  prompt: string;
  options?: SurveyResultOption[];
  texts?: string[];
}

export interface SurveyResultResponse {
  respondentName: string;
  answers: unknown;
}

export interface SurveyResults {
  surveyId: string;
  isAnonymous: boolean;
  responseCount: number;
  suppressed: boolean;
  questions: SurveyResultQuestion[];
  responses?: SurveyResultResponse[];
}

/** `survey.manage` — `app.survey_results` RPC: `forbidden` unless owner/principal/admin of the survey's institution (enforced in the definer itself); anonymous surveys with fewer than 3 responses come back `suppressed` with no question breakdown (rulings). */
export async function surveyResults(surveyId: string): Promise<SurveyResults> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_results", { p_survey_id: surveyId });
  if (error) throwMapped(error);
  return data as unknown as SurveyResults;
}

export interface MySurveyRow {
  id: string;
  title: string;
  description: string | null;
  isAnonymous: boolean;
  closesAt: string;
  questions: unknown;
  responded: boolean;
}

/** `survey.respond` — `app.my_open_surveys` RPC: open surveys the caller is a recipient of (role/grade/section audience match, DPDP: never a student), with whether they've already responded. */
export async function surveyMine(ctx: TenantContext): Promise<MySurveyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_open_surveys", { p_institution_id: ctx.institution.id });
  if (error) throwMapped(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    isAnonymous: row.is_anonymous,
    closesAt: row.closes_at,
    questions: row.questions,
    responded: row.responded,
  }));
}
