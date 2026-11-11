// Read-only sentences for the card's summary view, built from the edited values and view.resolved.
import type { TaskFieldView, TaskView } from "@/modules/ai/tasks/types";
import { formatRupees, getAt, isHiddenKind, isoToIstLocal, knownOptions, leaves, optionLabel, rupeesToPaise, type Values } from "./fields";

const humanize = (s: string) => s.replace(/_/g, " ");

/** "Issue a library book" -> "Issue book"; short labels stay as they are. */
export function approveVerb(label: string): string {
  const w = label.trim().split(/\s+/);
  return w.length >= 3 ? `${w[0]} ${w[w.length - 1].toLowerCase()}` : label.trim();
}

export interface SummaryLine {
  label: string;
  text: string;
  /** True for a field the person still has to type. */
  needsYou?: boolean;
}

function show(kind: string, raw: unknown, field?: TaskFieldView): string {
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw !== "string" && typeof raw !== "number") return JSON.stringify(raw);
  const s = String(raw);
  if (kind === "paise" || kind === "rupees" || kind === "rupee_text") {
    const p = rupeesToPaise(s);
    return p === null ? s : formatRupees(p);
  }
  if (kind === "datetime") return `${isoToIstLocal(s).replace("T", " ")} (India time)`;
  if (kind === "enum") return field ? optionLabel(field, s) : humanize(s);
  return s;
}

/** One line per filled scalar; repeaters collapse to "N rows". Skips hidden kinds. */
export function summaryLines(view: TaskView, values: Values): SummaryLine[] {
  const known = knownOptions(view);
  const out: SummaryLine[] = [];
  for (const f of view.fields) {
    if (isHiddenKind(f.kind)) continue;
    if (f.kind === "array" && !f.multiple && f.fields) {
      const arr = getAt(values, f.path);
      out.push({ label: f.label, text: `${Array.isArray(arr) ? arr.length : 0} rows` });
    }
  }
  for (const leaf of leaves(view.fields, values)) {
    if (leaf.rows.length > 0 || isHiddenKind(leaf.field.kind)) continue;
    const raw = getAt(values, leaf.path);
    if (leaf.field.humanOnly && (raw === undefined || raw === "")) {
      out.push({ label: leaf.field.label, text: "you enter this", needsYou: true });
      continue;
    }
    if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
      out.push(leaf.field.required ? { label: leaf.field.label, text: "Not set yet (required)", needsYou: true } : { label: leaf.field.label, text: "Not set" });
      continue;
    }
    const name = (id: unknown) => (typeof id === "string" ? view.resolved[leaf.path]?.label ?? known[id]?.label ?? "Selected record" : String(id));
    const text =
      leaf.field.kind === "entity"
        ? Array.isArray(raw) ? raw.map(name).join(", ") : name(raw)
        : Array.isArray(raw) ? raw.map((x) => show(leaf.field.kind, x, leaf.field)).join(", ") : show(leaf.field.kind, raw, leaf.field);
    out.push({ label: leaf.field.label, text });
  }
  return out;
}

export const RISK_TEXT = {
  low_risk_reversible: { word: "Low risk", note: "Can be undone." },
  user_confirmed: { word: "Needs your OK", note: "Applies as soon as you approve." },
  human_approved: { word: "Needs careful check", note: "This changes official records. It cannot be taken back from here." },
} as const;
