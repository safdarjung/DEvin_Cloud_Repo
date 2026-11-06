// F-UI-11 marketplace — the catalogue is the real module catalog, owned by
// core (src/modules/core/queries.ts#listModules). No marketplace-only table:
// read through the owner's query, don't duplicate the module list here.
import type { TenantContext } from "@/lib/auth/types";
import { listModules, type ModuleCategoryGroup, type ModuleListItem } from "@/modules/core/queries";

export type { ModuleCategoryGroup, ModuleListItem };

export function marketplaceCatalog(ctx: TenantContext): ModuleCategoryGroup[] {
  return listModules(ctx);
}
