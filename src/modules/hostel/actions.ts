"use server";

// Hostel actions (migration 0116). Allocate/vacate go through the definer RPCs
// (capacity + one-active-allocation + audit live in SQL), as do roll calls
// (save_hostel_roll_call, 0133). Rooms are plain RLS writes (owner/principal/admin) audited here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  HostelAllocateSchema,
  HostelRollCallSaveSchema,
  HostelRoomCreateSchema,
  HostelRoomUpdateSchema,
  HostelVacateSchema,
} from "@/modules/hostel/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function asJsonRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new AppError("internal", "Unexpected response shape.");
  return data as Record<string, unknown>;
}

export const createRoom = defineAction({
  name: "hostel.room.create",
  module: "hostel",
  schema: HostelRoomCreateSchema,
  permission: "hostel.manage",
  handler: async ({ block, roomNo, capacity }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("hostel_rooms")
      .insert({ institution_id: ctx.institution.id, block, room_no: roomNo, capacity })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "hostel.room.create", entityType: "hostel_rooms", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateRoom = defineAction({
  name: "hostel.room.update",
  module: "hostel",
  schema: HostelRoomUpdateSchema,
  permission: "hostel.manage",
  handler: async ({ id, block, roomNo, capacity, isActive }, ctx) => {
    const supabase = await createClient();
    // Capacity-below-occupancy and deactivating an occupied room are refused by guard_hostel_rooms.
    const { data, error } = await supabase
      .from("hostel_rooms")
      .update({ block, room_no: roomNo, capacity, is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Room not found.");
    await audit(ctx, { action: "hostel.room.update", entityType: "hostel_rooms", entityId: id });
    return { id };
  },
});

export const allocateRoom = defineAction({
  name: "hostel.allocate",
  module: "hostel",
  schema: HostelAllocateSchema,
  permission: "hostel.manage",
  handler: async ({ roomId, studentId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("allocate_hostel_room", { p_room_id: roomId, p_student_id: studentId });
    if (error) throwMapped(error);
    return { allocationId: asJsonRecord(data).allocation_id as string };
  },
});

export const vacateAllocation = defineAction({
  name: "hostel.vacate",
  module: "hostel",
  schema: HostelVacateSchema,
  permission: "hostel.manage",
  handler: async ({ allocationId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("vacate_hostel_allocation", { p_allocation_id: allocationId });
    if (error) throwMapped(error);
    return { allocationId, vacatedOn: asJsonRecord(data).vacated_on as string };
  },
});

// One roll call per (date, session): the first save creates it, later saves edit its entries.
// save_hostel_roll_call (0133) checks allocations, upserts and audits in one transaction.
export const saveRollCall = defineAction({
  name: "hostel.rollCall.save",
  module: "hostel",
  schema: HostelRollCallSaveSchema,
  permission: "hostel.manage",
  handler: async ({ takenOn, session, entries }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_hostel_roll_call", {
      p_institution_id: ctx.institution.id,
      p_taken_on: takenOn,
      p_session: session,
      p_entries: entries.map((e) => ({ student_id: e.studentId, status: e.status, note: e.note ?? null })),
    });
    if (error) throwMapped(error);
    return { rollCallId: data as string, absent: entries.filter((e) => e.status === "absent").length };
  },
});
