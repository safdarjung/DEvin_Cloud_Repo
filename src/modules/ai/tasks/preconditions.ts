// Orb task bridge — which records an action can act on, by status (the exam workflow, 06 §W7:
// draft -> marks_entry -> verification -> published). Pickers list only these records, and a card the
// model proposes for any other record is refused with the reason, so the orb never offers "Reopen marks
// entry" for an exam whose marks entry is already open (owner report, 2026-11-14).
import type { EntityOption } from "./types";

const EXAM_STATE: Record<string, string> = {
  draft: "not open for marks yet",
  marks_entry: "open for marks entry",
  verification: "in verification",
  published: "published",
};

/** action -> entity type -> statuses the action accepts. Unlisted actions accept any record. */
export const ACTION_STATUSES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "exam.marks_entry.open": { exam: ["draft"] },
  "exam.marks_entry.close": { exam: ["marks_entry"] },
  "exam.marks_entry.reopen": { exam: ["verification"] },
  "exam.result.publish": { exam: ["verification"] },
  "exam.marks_due.set": { exam: ["draft", "marks_entry", "verification"] },
};

/** True when the action may act on this record (records without a status are not checked). */
export function statusAllows(action: string, entity: string, option: Pick<EntityOption, "status">): boolean {
  const allowed = ACTION_STATUSES[action]?.[entity];
  return !allowed || option.status === undefined || allowed.includes(option.status);
}

/** Why the action cannot run on this record, in words for the person; null when it can. */
export function statusBlock(action: string, entity: string, option: Pick<EntityOption, "label" | "status">): string | null {
  if (statusAllows(action, entity, option)) return null;
  const allowed = ACTION_STATUSES[action]![entity]!;
  const now = EXAM_STATE[option.status!] ?? option.status!;
  return `${option.label} is ${now}, so this cannot run on it now. It needs an exam that is ${allowed.map((s) => EXAM_STATE[s] ?? s).join(" or ")}.`;
}
