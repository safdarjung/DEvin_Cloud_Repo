"use server";

// health.profile.save / health.visit.add / health.vaccination.add (migration 0114).
// Plain CRUD under RLS. UPDATE is column-scoped, so no upsert: insert, or update by id.
// Audit and errors never carry clinical text — ids only.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  HealthProfileSaveSchema,
  HealthVisitAddSchema,
  VaccinationAddSchema,
  type HealthProfileSaveInput,
  type VaccinationAddInput,
} from "@/modules/health/schemas";

const RLS_VIOLATION = "42501";
const NO_STUDENT = "Student not found in this school.";

function pgCode(error: unknown): string | undefined {
  return error && typeof error === "object" ? (error as { code?: string }).code : undefined;
}

function throwMapped(error: unknown): never {
  // Insert with-check fails (42501) when the student is not in this school.
  if (pgCode(error) === RLS_VIOLATION) throw new AppError("forbidden", NO_STUDENT);
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const saveHealthProfile = defineAction({
  name: "health.profile.save",
  module: "health",
  schema: HealthProfileSaveSchema,
  permission: "health.write",
  handler: async ({ studentId, bloodGroup, allergies, conditions, emergencyNote }: HealthProfileSaveInput, ctx) => {
    const supabase = await createClient();
    const fields = {
      blood_group: bloodGroup ?? null,
      allergies: allergies || null,
      conditions: conditions || null,
      emergency_note: emergencyNote || null,
    };
    const { data: existing, error: readError } = await supabase
      .from("health_profiles")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .maybeSingle();
    if (readError) throwMapped(readError);

    let id: string;
    if (existing) {
      const { error } = await supabase.from("health_profiles").update(fields).eq("id", existing.id).eq("institution_id", ctx.institution.id);
      if (error) throwMapped(error);
      id = existing.id;
    } else {
      const { data, error } = await supabase
        .from("health_profiles")
        .insert({ institution_id: ctx.institution.id, student_id: studentId, ...fields })
        .select("id")
        .single();
      if (error) throwMapped(error);
      id = data.id;
    }
    await audit(ctx, { action: "health.profile.save", entityType: "health_profiles", entityId: id });
    return { id };
  },
});

export const addHealthVisit = defineAction({
  name: "health.visit.add",
  module: "health",
  schema: HealthVisitAddSchema,
  permission: "health.write",
  handler: async ({ studentId, complaint, treatment, outcome, visitedAt }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("health_visits")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        complaint,
        treatment: treatment || null,
        outcome,
        ...(visitedAt ? { visited_at: visitedAt } : {}),
        recorded_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "health.visit.add", entityType: "health_visits", entityId: data.id });
    return { id: data.id as string };
  },
});

export const addVaccination = defineAction({
  name: "health.vaccination.add",
  module: "health",
  schema: VaccinationAddSchema,
  permission: "health.write",
  handler: async ({ studentId, vaccine, dose, administeredOn, notes }: VaccinationAddInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("vaccinations")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        vaccine,
        dose: dose ?? null,
        administered_on: administeredOn,
        notes: notes || null,
        recorded_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "health.vaccination.add", entityType: "vaccinations", entityId: data.id });
    return { id: data.id as string };
  },
});
