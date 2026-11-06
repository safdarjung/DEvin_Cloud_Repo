"use server";

// X08-T5 — ptm.event.create / ptm.event.publish / ptm.slots.add /
// ptm.slot.remove / ptm.booking.create / ptm.booking.cancel (X08-tasks.md
// Task 5 rulings; migration 0099 part A, built in T2). Style mirrors
// src/modules/timetable/actions.ts (throwMapped/isRlsViolation helpers) and
// src/modules/people/leave.actions.ts (own-staffId-defaults-with-escalation
// pattern for addPtmSlots).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import {
  PtmBookSchema,
  PtmCancelSchema,
  PtmEventCreateSchema,
  PtmEventPublishSchema,
  PtmSlotRemoveSchema,
  PtmSlotsAddSchema,
  type PtmBookInput,
  type PtmCancelInput,
  type PtmEventCreateInput,
  type PtmEventPublishInput,
  type PtmSlotRemoveInput,
  type PtmSlotsAddInput,
} from "@/modules/ptm/schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

// Rulings §India specifics: times are school-local IST; shortcut: IST-only,
// upgrade when a non-IST tenant exists (same shortcut T4's schema took).
function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function timeStringToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export const createPtmEvent = defineAction({
  name: "ptm.event.create",
  module: "ptm",
  schema: PtmEventCreateSchema,
  permission: "ptm.manage",
  handler: async (
    { title, eventDate, dayStartsAt, dayEndsAt, slotMinutes, bookingClosesAt, classSectionIds }: PtmEventCreateInput,
    ctx,
  ) => {
    if (eventDate < todayIST()) {
      throw new AppError("validation_failed", "Event date cannot be in the past.", { eventDate: ["Must be today or later."] });
    }

    const supabase = await createClient();
    const { data: event, error: eventError } = await supabase
      .from("ptm_events")
      .insert({
        institution_id: ctx.institution.id,
        title,
        event_date: eventDate,
        day_starts_at: dayStartsAt,
        day_ends_at: dayEndsAt,
        slot_minutes: slotMinutes,
        booking_closes_at: bookingClosesAt,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (eventError) throwMapped(eventError);

    const { error: sectionsError } = await supabase.from("ptm_event_sections").insert(
      classSectionIds.map((classSectionId) => ({
        event_id: event.id,
        institution_id: ctx.institution.id,
        class_section_id: classSectionId,
      })),
    );
    if (sectionsError) {
      await supabase.from("ptm_events").delete().eq("id", event.id);
      if (isRlsViolation(sectionsError)) {
        throw new AppError("forbidden", "A section is outside this school.");
      }
      throwMapped(sectionsError);
    }

    await audit(ctx, { action: "ptm.event.create", entityType: "ptm_event", entityId: event.id as string, after: { sectionCount: classSectionIds.length } });

    return { id: event.id as string };
  },
});

export const publishPtmEvent = defineAction({
  name: "ptm.event.publish",
  module: "ptm",
  schema: PtmEventPublishSchema,
  permission: "ptm.manage",
  handler: async ({ eventId }: PtmEventPublishInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ptm_events")
      .update({ status: "published" })
      .eq("id", eventId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "PTM event not found.");

    await audit(ctx, { action: "ptm.event.publish", entityType: "ptm_event", entityId: data.id as string });

    return { id: data.id as string };
  },
});

export const addPtmSlots = defineAction({
  name: "ptm.slots.add",
  module: "ptm",
  schema: PtmSlotsAddSchema,
  permission: "ptm.slot.manage",
  handler: async ({ eventId, staffId, from, to }: PtmSlotsAddInput, ctx) => {
    const targetStaffId = staffId ?? ctx.membership.staffId;
    if (!targetStaffId) {
      throw new AppError("forbidden", "No staff record for this account.");
    }
    if (staffId && staffId !== ctx.membership.staffId && !hasPermission(ctx, "ptm.manage")) {
      throw new AppError("forbidden", "You do not have permission to perform this action.");
    }

    const supabase = await createClient();
    const { data: event, error: eventError } = await supabase
      .from("ptm_events")
      .select("day_starts_at, slot_minutes")
      .eq("id", eventId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (eventError) throwMapped(eventError);
    if (!event) throw new AppError("not_found", "PTM event not found.");

    const slotMinutes = event.slot_minutes as number;
    const dayStartMinutes = timeStringToMinutes(event.day_starts_at as string);
    const fromMinutes = timeStringToMinutes(from);
    const toMinutes = timeStringToMinutes(to);

    const seqs: number[] = [];
    for (let seq = 0; seq < 60; seq++) {
      const slotStart = dayStartMinutes + seq * slotMinutes;
      if (slotStart >= toMinutes) break;
      const slotEnd = slotStart + slotMinutes;
      if (slotStart >= fromMinutes && slotEnd <= toMinutes) seqs.push(seq);
    }
    if (seqs.length === 0) {
      throw new AppError("validation_failed", "No whole slot fits in this range.", { from: ["No whole slot fits in this range."] });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("ptm_slots")
      .upsert(
        seqs.map((seq) => ({
          institution_id: ctx.institution.id,
          event_id: eventId,
          staff_id: targetStaffId,
          seq,
          created_by: ctx.user.id,
        })),
        { onConflict: "event_id,staff_id,seq", ignoreDuplicates: true },
      )
      .select("id");
    if (insertError) {
      if (isRlsViolation(insertError)) throw new AppError("forbidden", "You do not have permission to perform this action.");
      throwMapped(insertError);
    }
    const added = inserted?.length ?? 0;

    await audit(ctx, { action: "ptm.slots.add", entityType: "ptm_event", entityId: eventId, after: { staffId: targetStaffId, added } });

    return { added };
  },
});

export const removePtmSlot = defineAction({
  name: "ptm.slot.remove",
  module: "ptm",
  schema: PtmSlotRemoveSchema,
  permission: "ptm.slot.manage",
  handler: async ({ slotId }: PtmSlotRemoveInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("ptm_slots").delete().eq("id", slotId).select("id").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Slot not found.");

    await audit(ctx, { action: "ptm.slot.remove", entityType: "ptm_slot", entityId: data.id as string });

    return { id: data.id as string };
  },
});

export const bookPtmSlot = defineAction({
  name: "ptm.booking.create",
  module: "ptm",
  schema: PtmBookSchema,
  permission: "ptm.book",
  handler: async ({ slotId, studentId }: PtmBookInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("book_ptm_slot", { p_slot_id: slotId, p_student_id: studentId });
    if (error) throwMapped(error);
    // Audited inside app.book_ptm_slot (SQL) — no action-level audit here.
    return { bookingId: data as string };
  },
});

export const cancelPtmBooking = defineAction({
  name: "ptm.booking.cancel",
  module: "ptm",
  schema: PtmCancelSchema,
  permission: "ptm.book",
  handler: async ({ bookingId }: PtmCancelInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_ptm_booking", { p_booking_id: bookingId });
    if (error) throwMapped(error);
    // Audited inside app.cancel_ptm_booking (SQL) — no action-level audit here.
    return { bookingId: data as string };
  },
});
