// Pure grouping for the App Orb: the server's chips (already limited to what the
// person's role, permissions and modules allow) become one group per section, each
// with ready prompts and that section's AI tools. Nothing here reads permissions.
import type { Role } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/catalog";
import { CAPABILITIES } from "@/modules/ai/capabilities/catalog";
import { starterPromptsFor } from "@/modules/ai/page-starters";
import type { OrbChip } from "./orb-chips";

export type OrbGroupId =
  | "attendance" | "exams" | "teaching" | "study" | "finance" | "admissions" | "timetable" | "people"
  | "insights" | "calendar" | "clubs" | "operations" | "website" | "more";

/** A drafting tool: a link to the page that runs it, or a prompt that starts the draft in chat. */
export interface OrbTool {
  key: string;
  label: string;
  href?: string;
  prompt?: string;
}

export interface OrbGroup {
  id: OrbGroupId;
  label: string;
  /** Accent for the dot, the orb pulse and the group's ring (never the only cue: the name is always shown). */
  hue: string;
  prompts: string[];
  tools: OrbTool[];
  count: number;
}

interface Def {
  label: string;
  hue: string;
  /** Institution-relative pages whose starter prompts top a group up. */
  pages: readonly string[];
}

// Insertion order is display order.
const DEFS: Record<OrbGroupId, Def> = {
  attendance: { label: "Attendance", hue: "#0EA5E9", pages: ["/attendance", "/portal/attendance"] },
  exams: { label: "Exams", hue: "#8B5CF6", pages: ["/exams", "/portal/results"] },
  teaching: { label: "Teaching", hue: "#14B8A6", pages: ["/assignments", "/lesson-plans", "/question-bank", "/portal/assignments"] },
  study: { label: "Study", hue: "#F59E0B", pages: ["/portal/study", "/portal/practice", "/portal/subjects"] },
  finance: { label: "Finance", hue: "#10B981", pages: ["/finance", "/portal/fees"] },
  admissions: { label: "Admissions", hue: "#EC4899", pages: ["/admissions"] },
  timetable: { label: "Timetable", hue: "#6366F1", pages: ["/timetable"] },
  people: { label: "People", hue: "#F97316", pages: ["/students"] },
  insights: { label: "Insights", hue: "#A855F7", pages: ["/fabric/insights", "/fabric"] },
  calendar: { label: "Calendar & notices", hue: "#06B6D4", pages: ["/notifications", "/portal/updates", "/portal/messages"] },
  clubs: { label: "Clubs & activities", hue: "#EF4444", pages: [] },
  operations: { label: "School operations", hue: "#64748B", pages: ["/fabric/operations"] },
  website: { label: "Website", hue: "#3B82F6", pages: ["/website"] },
  more: { label: "More", hue: "#71717A", pages: [] },
};
export const RECENT_HUE = "#71717A";

const MODULE_GROUP: Partial<Record<ModuleKey, OrbGroupId>> = {
  attendance: "attendance", exams: "exams",
  mastery: "teaching", lesson_plans: "teaching", question_bank: "teaching", assignments: "teaching", diary: "teaching",
  ai_teacher: "teaching", practice: "study", ai_student: "study",
  fees: "finance", finance_plus: "finance", expenses: "finance", scholarships: "finance", payroll: "finance",
  admissions: "admissions", timetable: "timetable", people: "people", insights: "insights", ai_briefings: "insights",
  calendar: "calendar", announcements: "calendar", messaging: "calendar", ptm: "calendar", student_leave: "calendar",
  clubs: "clubs", achievements: "clubs", behaviour: "clubs", website: "website",
  hostel: "operations", canteen: "operations", inventory: "operations", helpdesk: "operations", forms: "operations",
  alumni: "operations", school_labs: "operations", resources: "operations", compliance: "operations", duties: "operations",
  safety: "operations", library: "operations", visitors: "operations", workflows: "operations", substitution: "operations",
};

// Capabilities whose module is a generic bucket (ai_teacher, core) but whose task belongs to a section.
const KEY_GROUP: Partial<Record<string, OrbGroupId>> = {
  translate: "calendar", translate_notices: "calendar", parent_message_draft: "calendar",
  enquiry_reply: "admissions", find_student: "people", attendance_pattern: "attendance",
  exam_results: "exams", draft_remark: "exams", report_remark: "exams",
  lab_scenario: "insights", lab_explain: "insights",
};

export function groupIdFor(key: OrbChip["key"]): OrbGroupId {
  const cap = CAPABILITIES[key as keyof typeof CAPABILITIES];
  if (!cap) return "more";
  if (cap.roles.length === 1 && cap.roles[0] === "student") return "study";
  return KEY_GROUP[key] ?? MODULE_GROUP[cap.module] ?? "more";
}

const MIN_PROMPTS = 4;
const MAX_PROMPTS = 6;

/** Page starters are a section's vetted extra prompts, unless the page has no rule (then they are the generic defaults). */
function extraPrompts(pages: readonly string[], role: Role): string[] {
  const generic = starterPromptsFor("/", role).join("|");
  return pages.flatMap((p) => {
    const found = starterPromptsFor(p, role);
    return found.join("|") === generic ? [] : found;
  });
}

/** `chatOn` false: only linked tools (nothing can be sent), so no extra prompts are added. */
export function buildOrbGroups(chips: readonly OrbChip[], role: Role, chatOn = true): OrbGroup[] {
  const bucket = new Map<OrbGroupId, { prompts: string[]; tools: OrbTool[] }>();
  for (const chip of chips) {
    const id = groupIdFor(chip.key);
    const b = bucket.get(id) ?? { prompts: [], tools: [] };
    if (chip.kind === "ask" && chip.prompt) b.prompts.push(chip.prompt);
    else b.tools.push({ key: chip.key, label: chip.label, href: chip.href, prompt: chip.prompt });
    bucket.set(id, b);
  }
  return (Object.keys(DEFS) as OrbGroupId[]).flatMap((id) => {
    const b = bucket.get(id);
    if (!b) return [];
    const prompts = [...new Set(b.prompts)];
    for (const extra of chatOn ? extraPrompts(DEFS[id].pages, role) : []) {
      if (prompts.length >= MIN_PROMPTS) break;
      if (!prompts.includes(extra)) prompts.push(extra);
    }
    const shown = prompts.slice(0, MAX_PROMPTS);
    return [{ id, label: DEFS[id].label, hue: DEFS[id].hue, prompts: shown, tools: b.tools, count: shown.length + b.tools.length }];
  });
}

export interface PromptHit {
  text: string;
  groupId: OrbGroupId | "recent";
  groupLabel: string;
}

const norm = (s: string) => s.toLowerCase();

/** Prompts matching every word of the query, best first: prompt starts with it, then a word prefix, then the group name, then anywhere. */
export function searchPrompts(
  groups: readonly { id: PromptHit["groupId"]; label: string; prompts: readonly string[] }[],
  query: string,
  limit = 8,
): PromptHit[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const scored: Array<PromptHit & { score: number; order: number }> = [];
  for (const g of groups) {
    for (const text of g.prompts) {
      if (seen.has(text)) continue;
      const t = norm(text);
      const label = norm(g.label);
      if (!words.every((w) => t.includes(w) || label.includes(w))) continue;
      seen.add(text);
      const first = words[0];
      const score = t.startsWith(words.join(" ")) ? 0 : t.split(/\W+/).some((x) => x.startsWith(first)) ? 1 : label.includes(first) ? 2 : 3;
      scored.push({ text, groupId: g.id, groupLabel: g.label, score, order: scored.length });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map(({ text, groupId, groupLabel }) => ({ text, groupId, groupLabel }));
}

const RECENT_MAX = 5;
/** Newest first, no repeats, capped. */
export function pushRecent(list: readonly string[], text: string): string[] {
  const t = text.trim();
  return t ? [t, ...list.filter((x) => x !== t)].slice(0, RECENT_MAX) : [...list];
}
