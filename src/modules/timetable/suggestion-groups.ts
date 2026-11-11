// Pure helpers for the Plan tab: group suggestions by section, filter, and page them.
import type { TimetableSuggestion } from "./suggest";

export const GROUP_PAGE = 20;
/** Applying more than this many suggestions at once asks for a confirmation that states the number. */
export const CONFIRM_ABOVE = 20;

export interface SuggestionGroup {
  id: string;
  label: string;
  /** `index` points into the original suggestions array (selection and apply use it). */
  items: { index: number; suggestion: TimetableSuggestion }[];
}

/** Groups by section (labels sorted naturally), after the optional section and text filters; text matches the action line (subject, teacher). */
export function groupSuggestions(
  suggestions: TimetableSuggestion[],
  labels: Record<string, string>,
  filter: { section?: string; text?: string } = {},
): SuggestionGroup[] {
  const text = filter.text?.trim().toLowerCase();
  const groups = new Map<string, SuggestionGroup>();
  suggestions.forEach((suggestion, index) => {
    const id = suggestion.slot.classSectionId;
    if (filter.section && id !== filter.section) return;
    if (text && !suggestion.action.toLowerCase().includes(text)) return;
    const group = groups.get(id) ?? { id, label: labels[id] ?? "Section", items: [] };
    group.items.push({ index, suggestion });
    groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}

/** Rows to render for a group: `pages` pages of GROUP_PAGE. */
export const visibleCount = (total: number, pages: number) => Math.min(total, pages * GROUP_PAGE);
