import "server-only";
// Forms reads. Managers read forms/form_sections/form_responses under RLS (owner/principal/admin);
// respondents read only through public.my_open_forms (published forms they may answer).
// institution_id filters are defense in depth.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { FormField } from "./schemas";

const LIST_CAP = 200;
const RESPONSES_CAP = 2000;

export interface FormRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "closed";
  fields: FormField[];
  classSectionIds: string[];
  responseCount: number;
  publishedAt: string | null;
}

/** `form.manage` — every form, newest first, with audience sections and a response count. */
export async function formList(ctx: TenantContext): Promise<FormRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forms")
    .select("id, title, description, status, fields, published_at, form_sections(class_section_id), form_responses(count)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(LIST_CAP);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status as FormRow["status"],
    fields: r.fields as unknown as FormField[],
    classSectionIds: (r.form_sections ?? []).map((s) => s.class_section_id),
    responseCount: (r.form_responses as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
    publishedAt: r.published_at,
  }));
}

export interface FormFieldResult {
  index: number;
  type: FormField["type"];
  label: string;
  answered: number;
  /** choice: count per option, in option order. */
  options?: { label: string; count: number }[];
  /** consent: children whose guardian/student said yes vs. audience children still without a yes. */
  consentGiven?: number;
  consentPending?: number;
}

export interface FormResults {
  formId: string;
  responseCount: number;
  /** Active students enrolled in the audience sections. */
  audienceStudents: number;
  fields: FormFieldResult[];
}

/** `form.manage` — name-free aggregates. Consent pending = audience students with no "yes" response yet (student-level, so a guardian and a student answering for the same child count once). */
export async function formResults(ctx: TenantContext, formId: string): Promise<FormResults> {
  const supabase = await createClient();
  const { data: form, error } = await supabase
    .from("forms")
    .select("id, fields, form_sections(class_section_id)")
    .eq("id", formId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!form) throw new AppError("not_found", "Form not found.");

  const [{ data: responses, error: rError }, { data: enrolments, error: eError }] = await Promise.all([
    supabase.from("form_responses").select("student_id, answers").eq("form_id", formId).eq("institution_id", ctx.institution.id).limit(RESPONSES_CAP),
    supabase
      .from("enrolments")
      .select("student_id")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .in("class_section_id", (form.form_sections ?? []).map((s) => s.class_section_id))
      .limit(RESPONSES_CAP),
  ]);
  if (rError) throw rError;
  if (eError) throw eError;

  const audience = new Set((enrolments ?? []).map((e) => e.student_id));
  const fields = form.fields as unknown as FormField[];
  const rows = responses ?? [];

  return {
    formId,
    responseCount: rows.length,
    audienceStudents: audience.size,
    fields: fields.map((f, index) => {
      const answers = rows.map((r) => ({ studentId: r.student_id, a: (r.answers as unknown[])[index] }));
      const answered = answers.filter((x) => x.a !== null && x.a !== undefined).length;
      const base = { index, type: f.type, label: f.label, answered };
      if (f.type === "choice") {
        return { ...base, options: f.options.map((label, i) => ({ label, count: answers.filter((x) => x.a === i).length })) };
      }
      if (f.type === "consent") {
        const given = new Set(answers.filter((x) => x.a === true && x.studentId).map((x) => x.studentId as string));
        const teacherGiven = answers.filter((x) => x.a === true && !x.studentId).length;
        return { ...base, consentGiven: given.size + teacherGiven, consentPending: [...audience].filter((s) => !given.has(s)).length };
      }
      return base;
    }),
  };
}

/**
 * `form.manage` — one flat row per response (respondent and child names are visible to managers;
 * responses are not anonymous). Flat so `?format=csv` on the query route exports it directly.
 * Columns "1. <label>" … keep duplicate labels apart.
 */
export async function formResponses(ctx: TenantContext, formId: string): Promise<Record<string, string>[]> {
  const supabase = await createClient();
  const { data: form, error } = await supabase.from("forms").select("id, fields").eq("id", formId).eq("institution_id", ctx.institution.id).maybeSingle();
  if (error) throw error;
  if (!form) throw new AppError("not_found", "Form not found.");
  const fields = form.fields as unknown as FormField[];

  const { data, error: rError } = await supabase
    .from("form_responses")
    .select("respondent_user_id, student_id, answers, created_at")
    .eq("form_id", formId)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: true })
    .limit(RESPONSES_CAP);
  if (rError) throw rError;
  const rows = data ?? [];

  const userIds = [...new Set(rows.map((r) => r.respondent_user_id))];
  const studentIds = [...new Set(rows.flatMap((r) => (r.student_id ? [r.student_id] : [])))];
  const [users, students] = await Promise.all([
    userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : { data: [], error: null },
    studentIds.length ? supabase.from("students").select("id, first_name, last_name").in("id", studentIds).eq("institution_id", ctx.institution.id) : { data: [], error: null },
  ]);
  if (users.error) throw users.error;
  if (students.error) throw students.error;
  const userName = new Map((users.data ?? []).map((u) => [u.id, u.full_name as string]));
  const studentName = new Map((students.data ?? []).map((s) => [s.id, [s.first_name, s.last_name].filter(Boolean).join(" ")]));

  return rows.map((r) => {
    const out: Record<string, string> = {
      respondent: userName.get(r.respondent_user_id) ?? "Unknown",
      student: r.student_id ? (studentName.get(r.student_id) ?? "Unknown") : "",
      submittedAt: r.created_at,
    };
    fields.forEach((f, i) => {
      const a = (r.answers as unknown[])[i];
      out[`${i + 1}. ${f.label}`] =
        a === null || a === undefined ? "" : f.type === "choice" ? (f.options[a as number] ?? "") : f.type === "consent" ? (a ? "Yes" : "No") : String(a);
    });
    return out;
  });
}

export interface MyFormRow {
  id: string;
  title: string;
  description: string | null;
  fields: FormField[];
  publishedAt: string;
  /** null = the respondent themself (student or teacher); set = the child a guardian answers for. */
  studentId: string | null;
  studentName: string | null;
  responded: boolean;
}

/** `form.respond` — public.my_open_forms: published forms the caller may answer, one row per (form, child). */
export async function formMine(ctx: TenantContext): Promise<MyFormRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_open_forms", { p_institution_id: ctx.institution.id });
  if (error) {
    const mapped = mapSqlError(error);
    if (mapped.ok) throw new AppError("internal", "Unexpected error.");
    throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    fields: r.fields as unknown as FormField[],
    publishedAt: r.published_at,
    studentId: r.student_id,
    studentName: r.student_name,
    responded: r.responded,
  }));
}
