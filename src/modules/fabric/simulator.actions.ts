"use server";

// live-fabric lane "simulator" (F-UI-08): writes for the saved scenarios
// table (20261028000106). Style mirrors src/modules/people/leave.actions.ts
// (throwMapped helper, direct supabase.from().insert/update()). Approve/
// reject is gated twice (defense in depth, BRIEF-COMMON lesson 1): here by
// role, and in the DB by app.guard_simulation_scenario_write — either layer
// alone already blocks an admin from deciding a scenario.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  CreateScenarioSchema,
  DecideScenarioSchema,
  DeleteScenarioSchema,
  UpdateScenarioSchema,
} from "@/modules/fabric/simulator.schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const createScenario = defineAction({
  name: "fabric.simulator.create",
  module: "core",
  schema: CreateScenarioSchema,
  permission: "scenario.manage",
  handler: async ({ name, rationale, assumptions, status }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("simulation_scenarios")
      // created_by is re-derived server-side by app.guard_simulation_scenario_write
      // for any non-trusted caller — passed here only to satisfy the generated
      // Insert type's required column.
      .insert({ institution_id: ctx.institution.id, name, rationale, assumptions, status, created_by: ctx.user.id })
      .select("id")
      .single();
    if (error) throwMapped(error);
    return { id: data!.id as string };
  },
});

export const updateScenario = defineAction({
  name: "fabric.simulator.update",
  module: "core",
  schema: UpdateScenarioSchema,
  permission: "scenario.manage",
  handler: async ({ id, ...patch }, ctx) => {
    if (Object.keys(patch).length === 0) {
      throw new AppError("validation_failed", "No fields to update.");
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("simulation_scenarios")
      .update(patch)
      .eq("id", id)
      .eq("institution_id", ctx.institution.id);
    if (error) throwMapped(error);
    return { id };
  },
});

/** Propose/approve/reject share this table's `status` transition, so "propose" is updateScenario({ status: "proposed" }); this action is the approval-gate step (owner/principal only). */
export const decideScenario = defineAction({
  name: "fabric.simulator.decide",
  module: "core",
  schema: DecideScenarioSchema,
  permission: "scenario.manage",
  handler: async ({ id, decision }, ctx) => {
    if (ctx.membership.role !== "owner" && ctx.membership.role !== "principal") {
      throw new AppError("forbidden", "Only the owner or principal can approve or reject a scenario.");
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("simulation_scenarios")
      .update({ status: decision })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id);
    if (error) throwMapped(error);
    return { id, status: decision };
  },
});

export const deleteScenario = defineAction({
  name: "fabric.simulator.delete",
  module: "core",
  schema: DeleteScenarioSchema,
  permission: "scenario.manage",
  handler: async ({ id }, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("simulation_scenarios")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id);
    if (error) throwMapped(error);
    return { id };
  },
});
