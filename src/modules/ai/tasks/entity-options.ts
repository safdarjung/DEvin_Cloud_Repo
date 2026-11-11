import "server-only";
// Orb task bridge — the ai.taskEntityOptions handler (design §4 EntityPicker).
// The field must be an entity field of a task that is on for the caller, and
// the options come from that entity's picker source under the caller's RLS.
import type { TenantContext } from "@/lib/auth/types";
import { searchEntities } from "./entities";
import { patternOf } from "./resolve-refs";
import { classifiedTask } from "./classified";
import { taskState } from "./state";
import type { EntityOption } from "./types";

export interface EntityOptionsInput {
  action: string;
  path: string;
  entity: string;
  search?: string;
  scope?: Record<string, string>;
}

export async function taskEntityOptions(ctx: TenantContext, input: EntityOptionsInput): Promise<EntityOption[]> {
  const task = classifiedTask(input.action);
  if (!task || !taskState(ctx, input.action).enabled) return [];
  const pattern = patternOf(input.path);
  // "/classSectionIds/2" is an item of the array field "/classSectionIds".
  const entity = task.entities[pattern] ?? task.entities[pattern.replace(/\/\*$/, "")];
  if (!entity || entity === "context" || entity !== input.entity) return [];
  return searchEntities(ctx, entity, input.search, input.scope ?? {});
}
