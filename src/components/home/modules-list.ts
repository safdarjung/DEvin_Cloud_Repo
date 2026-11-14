// Every module as the landing pages list it. Shared by the loom page (Home.tsx) and the FabricOS
// home (fabricos/configure-section.tsx) so both carry the same honesty labels.
import { MODULES } from "@/lib/modules/catalog";
import type { ModulePatch } from "./sections/Modules";
import type { HonestyLabel } from "./story";

/** Modules whose channel or output is not fully live; the same words the product shows (rule 7). */
const MODULE_HONESTY: Readonly<Record<string, HonestyLabel>> = {
  online_payments: "test mode",
  email: "simulated",
  sms: "simulated",
  whatsapp: "simulated",
  ai_briefings: "limited",
  insights: "limited",
  forecasts: "limited",
};

export const HOME_MODULES: readonly ModulePatch[] = Object.entries(MODULES).map(([key, m]) => ({
  key,
  label: m.label,
  category: m.category,
  description: m.description,
  core: "core" in m && m.core === true,
  honesty: MODULE_HONESTY[key],
}));
