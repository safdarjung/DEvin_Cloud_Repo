// Which renderer hosts a task: the generated form (default), the attendance register,
// or (rule-6 keys, out of scope for this packet) a plain "open this in <page>" link.
import type { TaskFieldView, TaskRendererKey, TaskView } from "@/modules/ai/tasks/types";
import { getAt, optionLabel, setAt, type Values } from "./fields";

export type RendererPlan =
  | { type: "form" }
  | { type: "roster" }
  | { type: "link"; page: string; href: (slug: string) => string };

const LINKS: Record<Exclude<TaskRendererKey, "attendance.register">, { page: string; path: string }> = {
  "exams.marksGrid": { page: "Exams", path: "exams" },
  "finance.recordPayment": { page: "Finance", path: "finance" },
  "exams.recheckDecision": { page: "Exams", path: "exams" },
};

export function rendererPlan(key: TaskRendererKey | undefined): RendererPlan {
  if (!key) return { type: "form" };
  if (key === "attendance.register") return { type: "roster" };
  const l = LINKS[key];
  return l ? { type: "link", page: l.page, href: (slug) => `/${slug}/${l.path}` } : { type: "form" };
}

export interface RosterShape {
  array: TaskFieldView;
  student: TaskFieldView;
  status: TaskFieldView;
}

/** The roster's array field with a student column and a status enum, or null (then the generic form is used). */
export function rosterShape(view: TaskView): RosterShape | null {
  for (const array of view.fields) {
    if (array.kind !== "array" || array.multiple || !array.fields) continue;
    const student = array.fields.find((f) => f.kind === "entity" && f.entity === "student");
    const enums = array.fields.filter((f) => f.kind === "enum" && f.options?.length);
    const status = enums.find((f) => /status/i.test(f.path)) ?? enums[0];
    if (student && status) return { array, student, status };
  }
  return null;
}

const rowsOf = (values: Values, shape: RosterShape): unknown[] => {
  const arr = getAt(values, shape.array.path);
  return Array.isArray(arr) ? arr : [];
};
const statusKey = (shape: RosterShape) => shape.status.path.slice(`${shape.array.path}/*`.length);
const studentKey = (shape: RosterShape) => shape.student.path.slice(`${shape.array.path}/*`.length);

export const rowStatusPath = (shape: RosterShape, i: number) => `${shape.array.path}/${i}${statusKey(shape)}`;
export const rowStudentPath = (shape: RosterShape, i: number) => `${shape.array.path}/${i}${studentKey(shape)}`;

export function rosterCounts(values: Values, shape: RosterShape): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries((shape.status.options ?? []).map((o) => [o, 0]));
  rowsOf(values, shape).forEach((_, i) => {
    const s = getAt(values, rowStatusPath(shape, i));
    if (typeof s === "string") out[s] = (out[s] ?? 0) + 1;
  });
  return out;
}

export function setAllStatus(values: Values, shape: RosterShape, status: string): Values {
  return rowsOf(values, shape).reduce<Values>((acc, _, i) => setAt(acc, rowStatusPath(shape, i), status), values);
}

/** The option that means "present" (first match of /present/i, else the first option). */
export function presentOption(shape: RosterShape): string | undefined {
  const o = shape.status.options ?? [];
  return o.find((x) => /^present$/i.test(optionLabel(shape.status, x)) || /^(p|present)$/i.test(x)) ?? o[0];
}

export const rosterRowCount = (values: Values, shape: RosterShape): number => rowsOf(values, shape).length;
