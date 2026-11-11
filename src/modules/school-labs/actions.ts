"use server";

// School labs actions (migration 0126). Booking/cancel go through the definer RPCs (conflict, own-booking and
// date rules live in SQL); labs, equipment, experiments and incidents are RLS writes audited here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  BookingCancelSchema,
  BookingCreateSchema,
  EquipmentCreateSchema,
  EquipmentUpdateSchema,
  ExperimentCompleteSchema,
  ExperimentLogSchema,
  IncidentRecordSchema,
  LabCreateSchema,
  LabUpdateSchema,
} from "@/modules/school-labs/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function asJsonRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new AppError("internal", "Unexpected response shape.");
  return data as Record<string, unknown>;
}

export const createLab = defineAction({
  name: "schoolLabs.lab.create",
  module: "school_labs",
  schema: LabCreateSchema,
  permission: "lab.manage",
  handler: async ({ name, kind, capacity }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("school_labs").insert({ institution_id: ctx.institution.id, name, kind, capacity }).select("id").single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "schoolLabs.lab.create", entityType: "school_labs", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateLab = defineAction({
  name: "schoolLabs.lab.update",
  module: "school_labs",
  schema: LabUpdateSchema,
  permission: "lab.manage",
  handler: async ({ id, name, kind, capacity, isActive }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("school_labs").update({ name, kind, capacity, is_active: isActive }).eq("id", id).eq("institution_id", ctx.institution.id).select("id").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Lab not found.");
    await audit(ctx, { action: "schoolLabs.lab.update", entityType: "school_labs", entityId: id });
    return { id };
  },
});

export const createEquipment = defineAction({
  name: "schoolLabs.equipment.create",
  module: "school_labs",
  schema: EquipmentCreateSchema,
  permission: "lab.manage",
  handler: async ({ labId, name, kind, quantity, unit, hazardClass, expiryOn, condition }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("school_lab_equipment")
      .insert({ institution_id: ctx.institution.id, lab_id: labId, name, kind, quantity, unit, hazard_class: hazardClass, expiry_on: expiryOn, condition })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "schoolLabs.equipment.create", entityType: "school_lab_equipment", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateEquipment = defineAction({
  name: "schoolLabs.equipment.update",
  module: "school_labs",
  schema: EquipmentUpdateSchema,
  permission: "lab.manage",
  handler: async ({ id, labId, name, kind, quantity, unit, hazardClass, expiryOn, condition }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("school_lab_equipment")
      .update({ lab_id: labId, name, kind, quantity, unit, hazard_class: hazardClass, expiry_on: expiryOn, condition })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Equipment not found.");
    await audit(ctx, { action: "schoolLabs.equipment.update", entityType: "school_lab_equipment", entityId: id });
    return { id };
  },
});

// Conflicts (lab or teacher already booked) come back as code:conflict with the reason text.
export const bookLab = defineAction({
  name: "schoolLabs.booking.book",
  module: "school_labs",
  schema: BookingCreateSchema,
  permission: "lab.book",
  handler: async ({ labId, classSectionId, subjectId, date, periodId, purpose, staffId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("book_school_lab", {
      p_lab_id: labId,
      p_class_section_id: classSectionId,
      p_subject_id: subjectId,
      p_date: date,
      p_period_id: periodId,
      p_purpose: purpose,
      p_staff_id: staffId,
    });
    if (error) throwMapped(error);
    return { bookingId: asJsonRecord(data).booking_id as string };
  },
});

export const cancelBooking = defineAction({
  name: "schoolLabs.booking.cancel",
  module: "school_labs",
  schema: BookingCancelSchema,
  permission: "lab.book",
  handler: async ({ bookingId }) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_school_lab_booking", { p_booking_id: bookingId });
    if (error) throwMapped(error);
    return { bookingId };
  },
});

// Teachers: RLS only lets them log on their own still-booked bookings.
export const logExperiment = defineAction({
  name: "schoolLabs.experiment.log",
  module: "school_labs",
  schema: ExperimentLogSchema,
  permission: "lab.book",
  handler: async ({ bookingId, title, notes }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("school_lab_experiments")
      .insert({ institution_id: ctx.institution.id, booking_id: bookingId, title, notes })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "schoolLabs.experiment.log", entityType: "school_lab_experiments", entityId: data.id });
    return { id: data.id as string };
  },
});

export const completeExperiment = defineAction({
  name: "schoolLabs.experiment.complete",
  module: "school_labs",
  schema: ExperimentCompleteSchema,
  permission: "lab.book",
  handler: async ({ id, completed }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("school_lab_experiments").update({ completed }).eq("id", id).eq("institution_id", ctx.institution.id).select("id").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Experiment not found.");
    await audit(ctx, { action: "schoolLabs.experiment.complete", entityType: "school_lab_experiments", entityId: id });
    return { id };
  },
});

// Append-only. A teacher's incident must name their own booking of that lab (RLS); a manager's booking is optional.
export const recordIncident = defineAction({
  name: "schoolLabs.incident.record",
  module: "school_labs",
  schema: IncidentRecordSchema,
  permission: "lab.book",
  handler: async ({ labId, bookingId, kind, severity, description, costPaise }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("school_lab_incidents")
      .insert({ institution_id: ctx.institution.id, lab_id: labId, booking_id: bookingId ?? null, kind, severity, description, cost_paise: costPaise ?? null })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "schoolLabs.incident.record", entityType: "school_lab_incidents", entityId: data.id });
    return { id: data.id as string };
  },
});
