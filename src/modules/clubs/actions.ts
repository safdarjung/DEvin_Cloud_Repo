"use server";

// Features-18 #6 — clubs & houses writes. Membership, sign-ups and house points
// have no client write grant: they go through the 0115 definers (which audit
// themselves). Clubs/events/houses are RLS-guarded inserts and column-scoped
// updates (no upsert).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { Database } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import {
  AwardPointsSchema,
  ClubCreateSchema,
  ClubEventCancelSchema,
  ClubEventCreateSchema,
  ClubMembershipSchema,
  ClubUpdateSchema,
  EventSignupSchema,
  HouseAssignSchema,
  HouseCreateSchema,
  HouseUnassignSchema,
} from "@/modules/clubs/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function pgCode(error: unknown): string | undefined {
  return error && typeof error === "object" ? (error as { code?: string }).code : undefined;
}

// 42501 = RLS with-check failure: a patron staff id from another school.
function throwWrite(error: unknown, what: string): never {
  if (pgCode(error) === "42501") throw new AppError("forbidden", `${what} refers to a record outside this school.`);
  if (pgCode(error) === "23505") throw new AppError("conflict", `${what} already exists.`);
  throwMapped(error);
}

export const createClub = defineAction({
  name: "clubs.create",
  module: "clubs",
  schema: ClubCreateSchema,
  permission: "club.manage",
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clubs")
      .insert({
        institution_id: ctx.institution.id,
        name: input.name,
        description: input.description || null,
        patron_staff_id: input.patronStaffId ?? null,
        capacity: input.capacity ?? null,
      })
      .select("id")
      .single();
    if (error) throwWrite(error, "Club");
    await audit(ctx, { action: "club.created", entityType: "clubs", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateClub = defineAction({
  name: "clubs.update",
  module: "clubs",
  schema: ClubUpdateSchema,
  permission: "club.manage",
  handler: async (input, ctx) => {
    const patch: Database["public"]["Tables"]["clubs"]["Update"] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description || null;
    if (input.patronStaffId !== undefined) patch.patron_staff_id = input.patronStaffId;
    if (input.capacity !== undefined) patch.capacity = input.capacity;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (Object.keys(patch).length === 0) throw new AppError("validation_failed", "Nothing to change.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clubs")
      .update(patch)
      .eq("id", input.id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwWrite(error, "Club");
    if (!data) throw new AppError("not_found", "Club not found.");
    await audit(ctx, { action: "club.updated", entityType: "clubs", entityId: data.id });
    return { id: data.id as string };
  },
});

export const createClubEvent = defineAction({
  name: "clubs.event.create",
  module: "clubs",
  schema: ClubEventCreateSchema,
  permission: "club.manage",
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("club_events")
      .insert({
        institution_id: ctx.institution.id,
        club_id: input.clubId,
        title: input.title,
        description: input.description || null,
        venue: input.venue ?? null,
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        signup_closes_at: input.signupClosesAt ?? null,
        capacity: input.capacity ?? null,
      })
      .select("id")
      .single();
    // 23503 = composite FK to clubs(id, institution_id) failed: unknown club.
    if (error) {
      if (pgCode(error) === "23503") throw new AppError("not_found", "Club not found.");
      throwWrite(error, "Event");
    }
    await audit(ctx, { action: "club.event.created", entityType: "club_events", entityId: data.id });
    return { id: data.id as string };
  },
});

export const cancelClubEvent = defineAction({
  name: "clubs.event.cancel",
  module: "clubs",
  schema: ClubEventCancelSchema,
  permission: "club.manage",
  handler: async ({ id }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("club_events")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Event not found.");
    await audit(ctx, { action: "club.event.cancelled", entityType: "club_events", entityId: data.id });
    return { id: data.id as string };
  },
});

export const createHouse = defineAction({
  name: "clubs.house.create",
  module: "clubs",
  schema: HouseCreateSchema,
  permission: "club.manage",
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("houses")
      .insert({ institution_id: ctx.institution.id, name: input.name, colour: input.colour ?? null })
      .select("id")
      .single();
    if (error) throwWrite(error, "House");
    await audit(ctx, { action: "house.created", entityType: "houses", entityId: data.id });
    return { id: data.id as string };
  },
});

// A student sits in at most one house (unique student_id): insert, or move by id if already placed.
export const assignHouse = defineAction({
  name: "clubs.house.assign",
  module: "clubs",
  schema: HouseAssignSchema,
  permission: "club.manage",
  handler: async ({ houseId, studentId }, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("house_members")
      .select("id")
      .eq("student_id", studentId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    const res = existing
      ? await supabase.from("house_members").update({ house_id: houseId }).eq("id", existing.id).select("id").single()
      : await supabase
          .from("house_members")
          .insert({ institution_id: ctx.institution.id, house_id: houseId, student_id: studentId })
          .select("id")
          .single();
    if (res.error) {
      if (pgCode(res.error) === "23503") throw new AppError("not_found", "House not found.");
      throwWrite(res.error, "House membership");
    }
    await audit(ctx, { action: "house.member.assigned", entityType: "house_members", entityId: res.data.id });
    return { id: res.data.id as string };
  },
});

export const unassignHouse = defineAction({
  name: "clubs.house.unassign",
  module: "clubs",
  schema: HouseUnassignSchema,
  permission: "club.manage",
  handler: async ({ studentId }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("house_members")
      .delete()
      .eq("student_id", studentId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Student is not in a house.");
    await audit(ctx, { action: "house.member.removed", entityType: "house_members", entityId: data.id });
    return { id: data.id as string };
  },
});

export const awardHousePoints = defineAction({
  name: "clubs.house.awardPoints",
  module: "clubs",
  schema: AwardPointsSchema,
  permission: "club.manage",
  handler: async ({ houseId, points, reason, studentId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("award_house_points", {
      p_house_id: houseId,
      p_points: points,
      p_reason: reason,
      p_student_id: studentId,
    });
    if (error) throwMapped(error);
    // Audited inside the definer.
    return { id: (data as { id: string }).id };
  },
});

export const joinClub = defineAction({
  name: "clubs.join",
  module: "clubs",
  schema: ClubMembershipSchema,
  permission: "club.join",
  handler: async ({ clubId, studentId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("join_club", { p_club_id: clubId, p_student_id: studentId });
    if (error) throwMapped(error);
    return { id: (data as { id: string }).id };
  },
});

export const leaveClub = defineAction({
  name: "clubs.leave",
  module: "clubs",
  schema: ClubMembershipSchema,
  permission: "club.join",
  handler: async ({ clubId, studentId }) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("leave_club", { p_club_id: clubId, p_student_id: studentId });
    if (error) throwMapped(error);
    return { clubId, studentId };
  },
});

export const signUpClubEvent = defineAction({
  name: "clubs.event.signUp",
  module: "clubs",
  schema: EventSignupSchema,
  permission: "club.join",
  handler: async ({ eventId, studentId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sign_up_club_event", { p_event_id: eventId, p_student_id: studentId });
    if (error) throwMapped(error);
    return { id: (data as { id: string }).id };
  },
});

export const cancelClubEventSignup = defineAction({
  name: "clubs.event.cancelSignup",
  module: "clubs",
  schema: EventSignupSchema,
  permission: "club.join",
  handler: async ({ eventId, studentId }) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_club_event_signup", { p_event_id: eventId, p_student_id: studentId });
    if (error) throwMapped(error);
    return { eventId, studentId };
  },
});
