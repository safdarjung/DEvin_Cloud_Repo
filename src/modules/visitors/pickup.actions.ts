"use server";

// X07-T6 — visitors.pickup.add / visitors.pickup.remove (X07-tasks.md Task
// 6, rulings). Mapping style mirrors src/modules/transport/actions.ts
// (throwMapped / isUniqueViolation / isRlsViolation). created_by is left to
// the column default (`app.current_user_id()`, 0090) so the row satisfies
// the pickup_persons_insert RLS with-check without this file re-deriving it.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  PickupAddSchema,
  PickupRemoveSchema,
  type PickupAddInput,
  type PickupRemoveInput,
} from "@/modules/visitors/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";

function sqlErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const addPickupPerson = defineAction({
  name: "visitors.pickup.add",
  module: "visitors",
  schema: PickupAddSchema,
  permission: "pickup.manage",
  handler: async ({ studentId, fullName, relation, phone }: PickupAddInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("pickup_persons")
      .insert({ institution_id: ctx.institution.id, student_id: studentId, full_name: fullName, relation, phone })
      .select("id")
      .single();
    if (error) {
      const code = sqlErrorCode(error);
      if (code === POSTGRES_UNIQUE_VIOLATION) {
        throw new AppError("conflict", "This phone number is already on the pickup list for this student.", {
          phone: ["Phone already on this student's pickup list."],
        });
      }
      if (code === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "Student not found in this school.");
      }
      // ErrorCode mapping (X07 rulings): 23503 -> not_found. Pre-empted
      // today by the RLS with-check exists() clause above (42501 fires
      // first), but mapped for robustness per gate-pass.actions.ts.
      if (code === POSTGRES_FOREIGN_KEY_VIOLATION) {
        throw new AppError("not_found", "Student not found.");
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "visitors.pickup.add", entityType: "pickup_person", entityId: data.id as string, after: { studentId } });

    return { id: data.id as string };
  },
});

export const removePickupPerson = defineAction({
  name: "visitors.pickup.remove",
  module: "visitors",
  schema: PickupRemoveSchema,
  permission: "pickup.manage",
  handler: async ({ id }: PickupRemoveInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("pickup_persons")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Pickup person not found.");

    await audit(ctx, { action: "visitors.pickup.remove", entityType: "pickup_person", entityId: data.id as string });

    return { id: data.id as string };
  },
});
