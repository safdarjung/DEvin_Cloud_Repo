"use server";

// Features-18 #9 — scholarships.rule.save / scholarships.rule.setActive /
// scholarships.award.request / scholarships.award.decide (migration 0118).
// Money is integer paise. Awards are recorded only: nothing here writes
// invoices, concessions or the ledger (honesty: <LimitedBadge />). A request
// copies the rule's value, so later rule edits never change an award. The
// decision goes only through public.decide_concession_award, which re-checks
// owner/principal, approver ≠ requester and pending, and writes its own audit
// row — so decide does not call audit() again. AI may draft a request only;
// decisions are never draftable (§E, rule 6).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  ConcessionAwardDecideSchema,
  ConcessionAwardRequestSchema,
  ConcessionRuleSaveSchema,
  ConcessionRuleSetActiveSchema,
  type ConcessionAwardDecideInput,
  type ConcessionAwardRequestInput,
  type ConcessionRuleSaveInput,
  type ConcessionRuleSetActiveInput,
} from "@/modules/scholarships/schemas";

const POSTGRES_RLS_VIOLATION = "42501";
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";
const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function pgCode(error: unknown): string | undefined {
  return error && typeof error === "object" ? (error as { code?: string }).code : undefined;
}

/** Creates a rule, or edits one when `id` is given. Existing awards keep the value they copied. */
export const saveConcessionRule = defineAction({
  name: "scholarships.rule.save",
  module: "scholarships",
  schema: ConcessionRuleSaveSchema,
  permission: "concession.manage",
  handler: async ({ id, name, criteria, percent, amountPaise }: ConcessionRuleSaveInput, ctx) => {
    const supabase = await createClient();
    const values = { name, criteria: criteria ?? null, percent: percent ?? null, amount_paise: amountPaise ?? null };
    const write = id
      ? supabase.from("concession_rules").update(values).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("concession_rules").insert({ ...values, institution_id: ctx.institution.id });
    const { data, error } = await write.select("id").maybeSingle();
    if (error) {
      if (pgCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        throw new AppError("conflict", "A rule with this name already exists.", { name: ["A rule with this name already exists."] });
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Concession rule not found.");

    await audit(ctx, {
      action: id ? "concession.rule.update" : "concession.rule.create",
      entityType: "concession_rules",
      entityId: data.id,
      after: { percent: percent ?? null, amountPaise: amountPaise ?? null },
    });
    return { id: data.id as string };
  },
});

export const setConcessionRuleActive = defineAction({
  name: "scholarships.rule.setActive",
  module: "scholarships",
  schema: ConcessionRuleSetActiveSchema,
  permission: "concession.manage",
  handler: async ({ id, isActive }: ConcessionRuleSetActiveInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("concession_rules")
      .update({ is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Concession rule not found.");

    await audit(ctx, { action: "concession.rule.set_active", entityType: "concession_rules", entityId: data.id, after: { isActive } });
    return { id: data.id as string, isActive };
  },
});

/** Requests a pending award for the current academic year. The caller is the requester. */
export const requestConcessionAward = defineAction({
  name: "scholarships.award.request",
  module: "scholarships",
  schema: ConcessionAwardRequestSchema,
  permission: "concession.manage",
  handler: async ({ studentId, ruleId, reason }: ConcessionAwardRequestInput, ctx) => {
    const supabase = await createClient();
    const [ruleR, yearR] = await Promise.all([
      supabase.from("concession_rules").select("id, percent, amount_paise, is_active").eq("id", ruleId).eq("institution_id", ctx.institution.id).maybeSingle(),
      supabase
        .from("academic_years")
        .select("id")
        .eq("institution_id", ctx.institution.id)
        .eq("is_current", true)
        .order("starts_on", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (ruleR.error) throwMapped(ruleR.error);
    if (yearR.error) throwMapped(yearR.error);
    if (!ruleR.data) throw new AppError("not_found", "Concession rule not found.");
    if (!ruleR.data.is_active) throw new AppError("invalid_state", "This rule is inactive. Pick an active rule.");
    if (!yearR.data) throw new AppError("invalid_state", "Set a current academic year before requesting concessions.");

    const { data, error } = await supabase
      .from("concession_awards")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        academic_year_id: yearR.data.id,
        rule_id: ruleId,
        percent: ruleR.data.percent,
        amount_paise: ruleR.data.amount_paise,
        reason,
        requested_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) {
      // The insert policy binds student_id to this institution (42501); an unknown id fails its FK.
      const code = pgCode(error);
      if (code === POSTGRES_RLS_VIOLATION || code === POSTGRES_FOREIGN_KEY_VIOLATION) throw new AppError("not_found", "Student not found in this school.");
      throwMapped(error);
    }

    // Never audit the reason (free text, lesson 10).
    await audit(ctx, {
      action: "concession.award.request",
      entityType: "concession_award",
      entityId: data.id,
      after: { status: "pending", ruleId, percent: ruleR.data.percent, amountPaise: ruleR.data.amount_paise },
    });
    return { id: data.id as string };
  },
});

export const decideConcessionAward = defineAction({
  name: "scholarships.award.decide",
  module: "scholarships",
  schema: ConcessionAwardDecideSchema,
  permission: "concession.approve",
  handler: async ({ awardId, decision, note }: ConcessionAwardDecideInput, ctx) => {
    const supabase = await createClient();
    // The definer resolves the award's institution itself; this pre-check keeps
    // an award from another school the caller also belongs to out of this route.
    const { data: award, error: readError } = await supabase
      .from("concession_awards")
      .select("id, requested_by")
      .eq("id", awardId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!award) throw new AppError("not_found", "Concession award not found.");
    if (award.requested_by === ctx.user.id) throw new AppError("forbidden", "You requested this concession. Another approver must decide it.");

    const { error } = await supabase.rpc("decide_concession_award", { p_award_id: awardId, p_decision: decision, p_note: note });
    if (error) throwMapped(error);
    return { awardId, status: decision };
  },
});
