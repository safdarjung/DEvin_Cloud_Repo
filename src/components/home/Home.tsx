import { MODULES } from "@/lib/modules/catalog";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { display } from "./fonts";
import { LoomFilm } from "./LoomFilm";
import { Motion } from "./Motion";
import { Ai } from "./sections/Ai";
import { Closing } from "./sections/Closing";
import { Modules, type ModulePatch } from "./sections/Modules";
import { People } from "./sections/People";
import type { Skill, SkillGroup } from "./sections/SkillOrb";
import { Stats } from "./sections/Stats";
import { Stories } from "./sections/Stories";
import { Threads } from "./sections/Threads";
import { Trust } from "./sections/Trust";
import type { HonestyLabel } from "./story";
import "./tokens.css";
import "./home.css";
import "./home-sections.css";
import "./home-scene.css";
import "./home-extras.css";
import "./home-motion.css";

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

const modules: readonly ModulePatch[] = Object.entries(MODULES).map(([key, m]) => ({
  key,
  label: m.label,
  category: m.category,
  description: m.description,
  core: "core" in m && m.core === true,
  honesty: MODULE_HONESTY[key],
}));

/** Who a capability is for, from its role ceiling. Anything the office staff can reach counts as "office". */
function skillGroup(roles: readonly string[]): SkillGroup {
  if (roles.every((r) => r === "student")) return "student";
  if (roles.every((r) => r === "guardian")) return "parent";
  if (roles.includes("teacher") && !roles.some((r) => r === "admin" || r === "accountant" || r === "admissions")) return "teacher";
  return "office";
}

const skills: readonly Skill[] = CAPABILITY_KEYS.map((key) => {
  const c = CAPABILITIES[key];
  return { label: c.label, description: c.description, group: skillGroup(c.roles), drafts: c.kind === "task" || (c.drafts?.length ?? 0) > 0 };
});

/** The landing page: an opening scroll film, then the product explained by count, use case, person, AI rule, module, first step and guarantee. */
export function Home() {
  return (
    <div className={`loom lh ${display.variable}`}>
      <Motion />
      <LoomFilm />
      <Stats moduleLabels={modules.map((m) => m.label)} core={modules.filter((m) => m.core).length} />
      <Stories />
      <People />
      <Ai skills={skills} />
      <Modules modules={modules} />
      <Threads modules={modules} />
      <Trust />
      <Closing />
    </div>
  );
}
