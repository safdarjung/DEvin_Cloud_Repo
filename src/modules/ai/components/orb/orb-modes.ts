// The App Orb's mode → section → feature model: pure and client-safe (no catalogs
// imported, so the floating launcher can use it on every page). orb-groups.ts builds
// the features on the server; nothing here reads permissions.
import type { OrbMode, TaskMode } from "@/modules/ai/tasks/types";

export type { OrbMode };

export type OrbGroupId =
  | "attendance" | "exams" | "teaching" | "study" | "finance" | "admissions" | "timetable" | "people"
  | "insights" | "calendar" | "clubs" | "operations" | "website" | "more";

interface Section {
  label: string;
  /** Accent for the dot, the orb pulse and the group's ring (never the only cue: the name is always shown). */
  hue: string;
  /** Institution-relative pages that belong to the section (starter prompts, "On this page"). */
  pages: readonly string[];
}

// Insertion order is display order.
export const SECTIONS: Record<OrbGroupId, Section> = {
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

export const MODES: readonly { id: OrbMode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Questions answered from your school's records." },
  { id: "do", label: "Do", hint: "Everyday jobs, done only after you approve a card." },
  { id: "create", label: "Create", hint: "Drafts you check, edit and save." },
  { id: "teach", label: "Teach", hint: "Class work: assignments, materials and study decks." },
  { id: "learn", label: "Learn", hint: "Your own study plans and practice." },
  { id: "manage", label: "Manage", hint: "School set-up and rules, approved card by card." },
];
const MODE_IDS: readonly OrbMode[] = MODES.map((m) => m.id);
export const isOrbMode = (v: unknown): v is OrbMode => typeof v === "string" && (MODE_IDS as readonly string[]).includes(v);
export const modeInfo = (m: OrbMode) => MODES[MODE_IDS.indexOf(m)];

/** ask: sends `prompt` (a question, or a draft request in Create) · task: opens an approval card for `task` · open: links to `href`. */
export type OrbFeatureKind = "ask" | "task" | "open";

export interface OrbFeature {
  key: string;
  label: string;
  mode: OrbMode;
  groupId: OrbGroupId | "recent";
  kind: OrbFeatureKind;
  /** kind "task": the registered action the card is for. */
  task?: string;
  prompt?: string;
  href?: string;
}

export interface OrbGroup {
  id: OrbGroupId | "recent";
  label: string;
  hue: string;
  features: readonly OrbFeature[];
}

export const sectionLabel = (id: OrbGroupId | "recent") => (id === "recent" ? "Recent" : SECTIONS[id].label);
const sectionHue = (id: OrbGroupId | "recent") => (id === "recent" ? RECENT_HUE : SECTIONS[id].hue);
const GROUP_ORDER: readonly (OrbGroupId | "recent")[] = ["recent", ...(Object.keys(SECTIONS) as OrbGroupId[])];

/** What a click does, said before the click. */
export function featureEffect(f: Pick<OrbFeature, "kind" | "mode">, hasDraft: boolean): string {
  if (f.kind === "open") return "Opens page";
  if (f.kind === "task") return hasDraft ? "Sends your message for this task" : "Opens a card to approve";
  return f.mode === "ask" ? "Asks now" : "Starts a draft";
}

/** The sections that have something in `mode`, in display order (Recent first). */
export function groupsFor(features: readonly OrbFeature[], mode: OrbMode): OrbGroup[] {
  const by = new Map<OrbGroupId | "recent", OrbFeature[]>();
  for (const f of features) if (f.mode === mode) by.set(f.groupId, [...(by.get(f.groupId) ?? []), f]);
  return GROUP_ORDER.flatMap((id) => {
    const list = by.get(id);
    return list ? [{ id, label: sectionLabel(id), hue: sectionHue(id), features: list }] : [];
  });
}

/** Modes with at least one feature, in tab order: an empty mode is not shown. */
export const modesOf = (features: readonly OrbFeature[]): OrbMode[] => MODE_IDS.filter((m) => features.some((f) => f.mode === m));

const norm = (s: string) => s.toLowerCase();

/** Features in every mode matching every word, best first: label starts with the query, then a word prefix, then section/mode name, then anywhere. */
export function searchFeatures(features: readonly OrbFeature[], query: string, limit = 8): OrbFeature[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const scored: Array<{ f: OrbFeature; score: number; order: number }> = [];
  for (const f of features) {
    const id = `${f.kind}:${f.task ?? f.href ?? f.prompt ?? f.label}`;
    if (seen.has(id)) continue;
    const text = norm(`${f.label} ${f.kind === "ask" && f.prompt !== f.label ? (f.prompt ?? "") : ""}`);
    const where = norm(`${sectionLabel(f.groupId)} ${modeInfo(f.mode).label}`);
    if (!words.every((w) => text.includes(w) || where.includes(w))) continue;
    seen.add(id);
    const first = words[0];
    const label = norm(f.label);
    const score = label.startsWith(words.join(" ")) ? 0 : text.split(/\W+/).some((x) => x.startsWith(first)) ? 1 : where.includes(first) ? 2 : 3;
    scored.push({ f, score, order: scored.length });
  }
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).slice(0, limit).map((s) => s.f);
}

const RECENT_MAX = 5;
/** Newest first, no repeats, capped. */
export function pushRecent(list: readonly string[], text: string): string[] {
  const t = text.trim();
  return t ? [t, ...list.filter((x) => x !== t)].slice(0, RECENT_MAX) : [...list];
}

/** Starting mode: the URL's, else the deep-linked task's, else the remembered one if it still has features, else the first. */
export function pickMode(available: readonly OrbMode[], want: { url?: OrbMode; task?: OrbMode; stored?: string | null }): OrbMode {
  const stored = isOrbMode(want.stored) && available.includes(want.stored) ? want.stored : undefined;
  return want.url ?? want.task ?? stored ?? available[0] ?? "ask";
}

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === "string" ? v : undefined);
const TASK_KEY = /^[a-zA-Z][a-zA-Z0-9_.]{1,80}$/;
const MAX_Q = 500;

/** `?mode=`, `?task=` and `?q=` are untrusted: a task counts only when it is in the caller's enabled list (the server re-checks on start). */
export function parseOrbQuery(
  params: { mode?: Param; task?: Param; q?: Param },
  enabled: readonly { action: string; mode: TaskMode }[],
): { mode?: OrbMode; task?: { action: string; mode: TaskMode }; q?: string } {
  const mode = one(params.mode);
  const action = one(params.task);
  const hit = action && TASK_KEY.test(action) ? enabled.find((t) => t.action === action) : undefined;
  const q = one(params.q)?.trim().slice(0, MAX_Q);
  return {
    ...(isOrbMode(mode) ? { mode } : {}),
    ...(hit ? { task: { action: hit.action, mode: hit.mode } } : {}),
    ...(q ? { q } : {}),
  };
}

/** The section a page belongs to ("/finance/invoices" → finance); the longest matching page wins. */
export function sectionForPath(path: string): OrbGroupId | null {
  let best: { id: OrbGroupId; len: number } | null = null;
  for (const id of Object.keys(SECTIONS) as OrbGroupId[]) {
    for (const p of SECTIONS[id].pages) {
      if ((path === p || path.startsWith(`${p}/`)) && p.length > (best?.len ?? 0)) best = { id, len: p.length };
    }
  }
  return best?.id ?? null;
}
