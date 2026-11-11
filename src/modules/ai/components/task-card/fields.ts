// Pure helpers for the approval card: money and marks maths on strings (no floats),
// JSON-pointer paths, initial values, validation, and error mapping. No React here.
import type { FieldKind, TaskFieldView, TaskProposalOutput, TaskRisk, TaskView } from "@/modules/ai/tasks/types";

export type Values = Record<string, unknown>;
/** Concrete pointer path -> messages. */
export type ErrorMap = Readonly<Record<string, readonly string[]>>;

// ── money and marks ─────────────────────────────────────────────────────────

const DECIMAL_2 = /^\d+(\.\d{1,2})?$/;

/** Strips ₹, spaces and commas (Indian or western grouping). */
export function cleanNumberText(raw: string): string {
  return raw.replace(/[₹\s,]/g, "");
}

/** "1,00,000.50" -> 10000050; null for 3 decimals, negatives, junk or unsafe size. Never uses float maths. */
export function rupeesToPaise(raw: string): number | null {
  const s = cleanNumberText(raw);
  if (!DECIMAL_2.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = `${whole}${frac.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  const n = Number(paise);
  return Number.isSafeInteger(n) ? n : null;
}

/** 10000050 -> "100000.50"; 10000 -> "100"; 1 -> "0.01". */
export function paiseToRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/** Indian digit grouping for display: 10000050 -> "₹1,00,000.50". */
export function formatRupees(paise: number): string {
  const [whole, frac] = paiseToRupees(paise).split(".");
  const neg = whole.startsWith("-");
  const digits = neg ? whole.slice(1) : whole;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}₹${grouped}${frac ? `.${frac}` : ""}`;
}

/** Marks: a non-negative number with at most 2 decimals; null when invalid. */
export function parseMarks(raw: string): number | null {
  const s = cleanNumberText(raw);
  return DECIMAL_2.test(s) ? Number(s) : null;
}

// ── pointer paths ───────────────────────────────────────────────────────────

export function splitPointer(path: string): string[] {
  return path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function getAt(values: unknown, path: string): unknown {
  let cur: unknown = values;
  for (const seg of splitPointer(path)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Immutable set; creates arrays for numeric segments and objects otherwise. */
export function setAt(values: Values, path: string, value: unknown): Values {
  const segs = splitPointer(path);
  const walk = (node: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    const seg = segs[i];
    const isIndex = /^\d+$/.test(seg);
    const base: unknown = node ?? (isIndex ? [] : {});
    if (Array.isArray(base)) {
      const next = base.slice();
      next[Number(seg)] = walk(base[Number(seg)], i + 1);
      return next;
    }
    return { ...(base as Record<string, unknown>), [seg]: walk((base as Record<string, unknown>)[seg], i + 1) };
  };
  return walk(values, 0) as Values;
}

/** Builds a nested input object from pointer-path entries ("/records/0/status" -> {records:[{status}]}). */
export function assembleValues(entries: Readonly<Record<string, unknown>>): Values {
  let out: Values = {};
  for (const [path, v] of Object.entries(entries)) out = setAt(out, path, v);
  return out;
}

function removeAt(values: Values, path: string): Values {
  const segs = splitPointer(path);
  const walk = (node: unknown, i: number): unknown => {
    if (node === null || typeof node !== "object") return node;
    const seg = segs[i];
    if (Array.isArray(node)) {
      const next = node.slice();
      if (i === segs.length - 1) delete next[Number(seg)];
      else next[Number(seg)] = walk(node[Number(seg)], i + 1);
      return next;
    }
    const rec = { ...(node as Record<string, unknown>) };
    if (i === segs.length - 1) delete rec[seg];
    else rec[seg] = walk(rec[seg], i + 1);
    return rec;
  };
  return walk(values, 0) as Values;
}

/** "/records/3/status" -> "/records/*\/status" (to find the field that owns a concrete path). */
export function toPattern(concrete: string): string {
  return concrete.split("/").map((s) => (/^\d+$/.test(s) ? "*" : s)).join("/");
}

/** The concrete path of a child field inside row `index` of an array at concrete path `parentConcrete`. */
export function bindChildPath(child: string, parentPattern: string, parentConcrete: string, index: number): string {
  return `${parentConcrete}/${index}${child.slice(`${parentPattern}/*`.length)}`;
}

// ── field walking ───────────────────────────────────────────────────────────

export interface Leaf {
  field: TaskFieldView;
  /** Concrete JSON pointer. */
  path: string;
  /** Row numbers (1-based) of the enclosing repeaters, outermost first. */
  rows: number[];
}

/** Every scalar-ish field instance, expanding arrays by the length of the values they hold. */
export function leaves(fields: readonly TaskFieldView[], values: Values): Leaf[] {
  const out: Leaf[] = [];
  const visit = (fs: readonly TaskFieldView[], parentPattern: string, parentConcrete: string, rows: number[]) => {
    for (const f of fs) {
      const concrete = parentPattern === "" ? f.path : `${parentConcrete}${f.path.slice(parentPattern.length)}`;
      if (f.kind === "array" && !f.multiple && f.fields) {
        const arr = getAt(values, concrete);
        const n = Array.isArray(arr) ? arr.length : 0;
        for (let i = 0; i < n; i++) {
          const rowPattern = `${f.path}/*`;
          const rowConcrete = `${concrete}/${i}`;
          visit(f.fields.filter((c) => c.path.startsWith(rowPattern)), rowPattern, rowConcrete, [...rows, i + 1]);
        }
      } else if (f.kind === "object" && f.fields) {
        visit(f.fields, f.path, concrete, rows);
      } else {
        out.push({ field: f, path: concrete, rows });
      }
    }
  };
  visit(fields, "", "", []);
  return out;
}

/** Flat index of every field (patterns, not instances) for label lookup. */
export function fieldIndex(fields: readonly TaskFieldView[]): Map<string, TaskFieldView> {
  const m = new Map<string, TaskFieldView>();
  const walk = (fs: readonly TaskFieldView[]) => {
    for (const f of fs) {
      m.set(f.path, f);
      if (f.fields) walk(f.fields);
    }
  };
  walk(fields);
  return m;
}

const HIDDEN_KINDS: readonly FieldKind[] = ["generated", "context"];
export const isHiddenKind = (k: FieldKind): boolean => HIDDEN_KINDS.includes(k);

// ── initial values ──────────────────────────────────────────────────────────

const MONEY_KINDS: readonly FieldKind[] = ["rupees", "rupee_text", "paise"];

/**
 * Editing state from the view: money shown as rupee text; human-only fields always empty
 * (even when view.values holds them: the model never supplies those); hidden kinds dropped.
 */
export function initialValues(view: TaskView): Values {
  let v = structuredClone(view.values) as Values;
  for (const leaf of leaves(view.fields, v)) {
    if (leaf.field.humanOnly) {
      v = removeAt(v, leaf.path);
      continue;
    }
    if (isHiddenKind(leaf.field.kind)) {
      v = removeAt(v, leaf.path);
      continue;
    }
    const cur = getAt(v, leaf.path);
    if (cur === undefined || cur === null) continue;
    if (leaf.field.kind === "paise" && typeof cur === "number") v = setAt(v, leaf.path, paiseToRupees(cur));
    else if (MONEY_KINDS.includes(leaf.field.kind) && typeof cur === "number") v = setAt(v, leaf.path, String(cur));
  }
  // Top-level human-only keys not covered by a field instance (defence in depth).
  for (const f of view.fields) if (f.humanOnly) v = removeAt(v, f.path);
  return v;
}

// ── validation and submit ───────────────────────────────────────────────────

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Message for one field instance, or null. */
export function validateLeaf(field: TaskFieldView, raw: unknown): string | null {
  if (field.kind === "boolean") return null;
  if (isEmpty(raw)) return field.required || field.humanOnly ? (field.humanOnly ? "You enter this yourself." : "Required.") : null;
  const s = typeof raw === "string" ? raw : null;
  switch (field.kind) {
    case "paise":
    case "rupees":
    case "rupee_text": {
      if (s === null || rupeesToPaise(s) === null) return "Enter an amount in rupees with at most 2 decimals.";
      return null;
    }
    case "marks": {
      if (s === null) return "Enter marks as a number.";
      const n = parseMarks(s);
      if (n === null) return "Enter marks as a number with at most 2 decimals.";
      if (field.min !== undefined && n < field.min) return `At least ${field.min}.`;
      if (field.max !== undefined && n > field.max) return `At most ${field.max}.`;
      return null;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(s);
      if (!Number.isFinite(n)) return "Enter a number.";
      if (field.min !== undefined && n < field.min) return `At least ${field.min}.`;
      if (field.max !== undefined && n > field.max) return `At most ${field.max}.`;
      return null;
    }
    case "text":
    case "long_text":
    case "natural_key":
      if (s !== null && field.maxLength !== undefined && s.length > field.maxLength) return `At most ${field.maxLength} characters.`;
      return null;
    default:
      return null;
  }
}

/** Client-side errors for the whole card, keyed by concrete path. */
export function validateAll(view: TaskView, values: Values): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const leaf of leaves(view.fields, values)) {
    if (isHiddenKind(leaf.field.kind) || leaf.field.kind === "unknown") continue;
    const msg = validateLeaf(leaf.field, getAt(values, leaf.path));
    if (msg) out[leaf.path] = [msg];
  }
  return out;
}

/** Edited state -> input for ai.proposal.approve: money converted exactly, empties dropped. */
export function buildInput(view: TaskView, values: Values): Values {
  let out = structuredClone(values) as Values;
  for (const leaf of leaves(view.fields, values)) {
    const raw = getAt(values, leaf.path);
    if (isEmpty(raw)) {
      out = removeAt(out, leaf.path);
      continue;
    }
    if (typeof raw !== "string") continue;
    switch (leaf.field.kind) {
      case "paise": {
        const p = rupeesToPaise(raw);
        if (p !== null) out = setAt(out, leaf.path, p);
        break;
      }
      case "rupees": {
        const p = rupeesToPaise(raw);
        if (p !== null) out = setAt(out, leaf.path, Number(paiseToRupees(p)));
        break;
      }
      case "rupee_text": {
        const p = rupeesToPaise(raw);
        if (p !== null) out = setAt(out, leaf.path, paiseToRupees(p));
        break;
      }
      case "marks": {
        const n = parseMarks(raw);
        if (n !== null) out = setAt(out, leaf.path, n);
        break;
      }
      case "number":
        if (Number.isFinite(Number(raw))) out = setAt(out, leaf.path, Number(raw));
        break;
      default:
    }
  }
  return compactArrays(out);
}

/** removeAt leaves holes in arrays; squeeze them out. */
function compactArrays(node: unknown): never {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return Array.from(n.entries()).filter(([, v]) => v !== undefined).map(([, v]) => walk(v));
    if (n !== null && typeof n === "object") return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, walk(v)]));
    return n;
  };
  return walk(node) as never;
}

// ── server error mapping ────────────────────────────────────────────────────

/** Normalises server fieldErrors keys to JSON pointers ("records.3.status" and "/records/3/status" both work). */
export function normalizeErrors(fieldErrors: Readonly<Record<string, readonly string[] | string>> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fieldErrors ?? {})) {
    const path = k.startsWith("/") ? k : k === "" ? "/" : `/${k.split(".").join("/")}`;
    out[path] = [...(out[path] ?? []), ...(Array.isArray(v) ? v : [v])];
  }
  return out;
}

/** Errors that belong to one repeater row (concrete array path + index), re-keyed by the child's path inside the row. */
export function rowErrors(errors: ErrorMap, arrayPath: string, index: number): Record<string, readonly string[]> {
  const prefix = `${arrayPath}/${index}`;
  const out: Record<string, readonly string[]> = {};
  for (const [p, m] of Object.entries(errors)) if (p === prefix || p.startsWith(`${prefix}/`)) out[p] = m;
  return out;
}

export interface ErrorSummaryItem {
  path: string;
  label: string;
  message: string;
}

/** Summary lines: "Row 4: Status: must be present, absent, late". Unknown paths fall back to the raw tail. */
export function summarizeErrors(view: TaskView, values: Values, errors: ErrorMap): ErrorSummaryItem[] {
  const idx = fieldIndex(view.fields);
  const items: ErrorSummaryItem[] = [];
  for (const [path, msgs] of Object.entries(dedupeGroupErrors(view, errors))) {
    const field = idx.get(toPattern(path));
    const rowNums = path.split("/").filter((s) => /^\d+$/.test(s)).map((s) => Number(s) + 1);
    const prefix = rowNums.length > 0 ? `Row ${rowNums.join(".")}: ` : "";
    const label = field?.label ?? (path === "/" ? "Request" : (splitPointer(path).at(-1) ?? path));
    for (const message of msgs) items.push({ path, label: `${prefix}${label}`, message });
  }
  void values;
  return items;
}

// ── stack ───────────────────────────────────────────────────────────────────

/** "Approve all" is offered only when every card is low-risk reversible, not waiting, and has no human-only field. */
export function canApproveAll(cards: readonly Pick<TaskProposalOutput["view"], "risk" | "dependsOn" | "fields" | "family">[]): boolean {
  if (cards.length < 2) return false;
  return cards.every((c) => c.risk === ("low_risk_reversible" satisfies TaskRisk) && !c.family && !c.fields.some((f) => f.humanOnly));
}

/** Seconds left until `expiresAt`; 0 once past. */
export function secondsLeft(expiresAt: string, now: number): number {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((t - now) / 1000)) : 0;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const m = Math.floor(seconds / 60);
  return m >= 1 ? `Expires in ${m} min` : `Expires in ${seconds} s`;
}

// ── picker scope ────────────────────────────────────────────────────────────

/** Sibling entity values (same row or top level) keyed by field name, so a picker can narrow (section -> subject -> unit). */
export function scopeFor(view: TaskView, values: Values, path: string): Record<string, string> {
  const dir = (p: string) => p.slice(0, p.lastIndexOf("/"));
  const out: Record<string, string> = {};
  for (const leaf of leaves(view.fields, values)) {
    if (leaf.field.kind !== "entity" || leaf.path === path || dir(leaf.path) !== dir(path)) continue;
    const v = getAt(values, leaf.path);
    if (typeof v === "string" && v) out[leaf.path.slice(leaf.path.lastIndexOf("/") + 1)] = v;
  }
  return out;
}

// ── Asia/Kolkata date-times (fixed +05:30, no DST) ──────────────────────────

const IST_OFFSET_MS = 330 * 60_000;

/** ISO instant -> "YYYY-MM-DDTHH:mm" in India time, for <input type="datetime-local">. */
export function isoToIstLocal(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16) : "";
}

/** "YYYY-MM-DDTHH:mm" read as India time -> ISO instant (UTC); "" when invalid. */
export function istLocalToIso(local: string): string {
  const t = Date.parse(`${local}:00Z`);
  return Number.isFinite(t) ? new Date(t - IST_OFFSET_MS).toISOString() : "";
}

/** id -> display option for every prefilled or candidate record in the view. */
export function knownOptions(view: TaskView): Record<string, { id: string; label: string; hint?: string }> {
  const out: Record<string, { id: string; label: string; hint?: string }> = {};
  for (const o of Object.values(view.resolved)) out[o.id] = o;
  for (const list of Object.values(view.candidates)) for (const o of list) out[o.id] = o;
  return out;
}

// ── completeness ────────────────────────────────────────────────────────────

export interface Missing {
  path: string;
  label: string;
  kind: FieldKind;
}

/** Required (and human-only) fields with no value; a required repeater with no rows counts as missing. */
export function missingRequired(view: TaskView, values: Values): Missing[] {
  const out: Missing[] = [];
  for (const leaf of leaves(view.fields, values)) {
    const f = leaf.field;
    if (isHiddenKind(f.kind) || f.kind === "unknown" || f.kind === "boolean") continue;
    if ((f.required || f.humanOnly) && isEmpty(getAt(values, leaf.path))) out.push({ path: leaf.path, label: f.label, kind: f.kind });
  }
  for (const f of view.fields) {
    if (f.kind !== "array" || f.multiple || !f.fields || !f.required) continue;
    const arr = getAt(values, f.path);
    if (!Array.isArray(arr) || arr.length === 0) out.push({ path: f.path, label: f.label, kind: "array" });
  }
  return out;
}

/** Client-side format errors on fields that DO have a value (empties are reported by missingRequired). */
export function invalidFilled(view: TaskView, values: Values): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [p, m] of Object.entries(validateAll(view, values))) if (!isEmpty(getAt(values, p))) out[p] = m;
  return out;
}

/** requireOneOf groups with no filled path. */
export function unmetOneOf(view: TaskView, values: Values): string[][] {
  return (view.requireOneOf ?? []).filter((g) => !g.some((p) => !isEmpty(getAt(values, p)))).map((g) => [...g]);
}

/** True when every required field has a value, every one-of group has one, and the client checks pass. */
export function isComplete(view: TaskView, values: Values): boolean {
  return missingRequired(view, values).length === 0 && unmetOneOf(view, values).length === 0 && Object.keys(invalidFilled(view, values)).length === 0;
}

/** Display label of an enum code: optionLabels[i] when present, else the code. */
export function optionLabel(field: Pick<TaskFieldView, "options" | "optionLabels">, code: string): string {
  const i = field.options?.indexOf(code) ?? -1;
  return (i >= 0 ? field.optionLabels?.[i] : undefined) ?? code.replace(/_/g, " ");
}

/** The same server message on several paths of one requireOneOf group is kept on the first path only. */
export function dedupeGroupErrors(view: TaskView, errors: ErrorMap): ErrorMap {
  const out: Record<string, readonly string[]> = { ...errors };
  for (const g of view.requireOneOf ?? []) {
    const seen = new Set<string>();
    for (const p of g) {
      const msgs = out[p];
      if (!msgs) continue;
      const keep = msgs.filter((m) => !seen.has(m));
      msgs.forEach((m) => seen.add(m));
      if (keep.length) out[p] = keep;
      else delete out[p];
    }
  }
  return out;
}

/** "Choose student and copy. Enter accession no." or "" when nothing blocks. */
export function blockerText(view: TaskView, values: Values): string {
  const lower = (s: string) => s.toLowerCase();
  const pick = missingRequired(view, values).filter((m) => m.kind === "entity" || m.kind === "enum").map((m) => lower(m.label));
  const type = missingRequired(view, values).filter((m) => m.kind !== "entity" && m.kind !== "enum" && m.kind !== "array").map((m) => lower(m.label));
  const add = missingRequired(view, values).filter((m) => m.kind === "array").map((m) => lower(m.label));
  const bad = Object.keys(invalidFilled(view, values)).map((p) => fieldIndex(view.fields).get(toPattern(p))?.label).filter(Boolean).map((l) => lower(l as string));
  const idx = fieldIndex(view.fields);
  const oneOf = unmetOneOf(view, values).map((g) => {
    const fs = g.map((p) => idx.get(p)).filter((f): f is TaskFieldView => !!f);
    const verb = fs.length > 0 && fs.every((f) => f.kind === "entity" || f.kind === "enum") ? "Choose" : "Enter";
    return `${verb} ${fs.map((f) => `a ${lower(f.label)}`).join(" or ")}.`;
  });
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  const parts = [pick.length ? `Choose ${join(pick)}.` : "", type.length ? `Enter ${join(type)}.` : "", add.length ? `Add ${join(add)}.` : "", bad.length ? `Check ${join([...new Set(bad)])}.` : ""];
  return [...parts, ...oneOf].filter(Boolean).join(" ");
}

/** The card opens in its form when something required is still empty; complete cards open as a summary. */
export function initialEditing(view: TaskView, values: Values): boolean {
  return !isComplete(view, values);
}

/** Concrete path to focus first: the first empty required field, else the first path of an unmet one-of group. */
export function firstBlockedPath(view: TaskView, values: Values): string | undefined {
  return missingRequired(view, values)[0]?.path ?? unmetOneOf(view, values)[0]?.[0];
}
