// Builds the App Orb's features on the server: the capability chips (already limited
// to what the person's role, permissions and modules allow) and the enabled tasks
// (listEnabledTasks) become mode → section → feature. Ask holds ready questions,
// Create the drafting tools and AI-tool pages, and each task sits in its own mode
// (Do / Create / Teach / Learn / Manage). Nothing here reads permissions.
import type { Role } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/catalog";
import { CAPABILITIES } from "@/modules/ai/capabilities/catalog";
import { starterPromptsFor } from "@/modules/ai/page-starters";
import type { TaskMode } from "@/modules/ai/tasks/types";
import type { OrbChip } from "./orb-chips";
import { SECTIONS, type OrbFeature, type OrbGroupId } from "./orb-modes";

export type { OrbGroupId } from "./orb-modes";

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

/** The fields of listEnabledTasks' rows the orb needs. */
export interface OrbTaskInput {
  action: string;
  label: string;
  mode: TaskMode;
  groupId: OrbGroupId;
}

/**
 * Ask: each section's chat prompts (all of them), topped up to four from vetted page starters.
 * Create: drafting tools (a page link, or a prompt that starts the draft in chat).
 * Tasks: one feature each in the task's own mode and section.
 * `chatOn` false: nothing can be sent, so only page links and tasks remain.
 */
export function buildOrbFeatures(chips: readonly OrbChip[], tasks: readonly OrbTaskInput[], role: Role, chatOn = true): OrbFeature[] {
  const prompts = new Map<OrbGroupId, string[]>();
  const tools: OrbFeature[] = [];
  for (const chip of chips) {
    const groupId = groupIdFor(chip.key);
    const list = prompts.get(groupId) ?? [];
    prompts.set(groupId, list);
    if (chip.kind === "ask" && chip.prompt) list.push(chip.prompt);
    else if (chip.href) tools.push({ key: chip.key, label: chip.label, mode: "create", groupId, kind: "open", href: chip.href });
    else if (chip.prompt) tools.push({ key: chip.key, label: chip.label, mode: "create", groupId, kind: "ask", prompt: chip.prompt });
  }
  const asks = (Object.keys(SECTIONS) as OrbGroupId[]).flatMap((id) => {
    const list = prompts.get(id);
    if (!list) return [];
    // Every capability keeps its prompt; only the page-starter top-up is capped.
    const shown = [...new Set(list)];
    for (const extra of chatOn ? extraPrompts(SECTIONS[id].pages, role) : []) {
      if (shown.length >= MIN_PROMPTS || shown.length >= MAX_PROMPTS) break;
      if (!shown.includes(extra)) shown.push(extra);
    }
    return shown.map((text): OrbFeature => ({ key: `ask:${id}:${text}`, label: text, mode: "ask", groupId: id, kind: "ask", prompt: text }));
  });
  const taskFeatures = tasks.map((t): OrbFeature => ({ key: `task:${t.action}`, label: t.label, mode: t.mode, groupId: t.groupId, kind: "task", task: t.action }));
  return [...asks, ...tools, ...taskFeatures];
}
