import "server-only";
// Orb task bridge — JSON-pointer helpers and entity resolution (design §3
// "propose_task execute"). Never trust a model-supplied id: every entity value,
// text or uuid, is looked up through a picker source under the caller's RLS.
// One match is prefilled with its display name, several become candidates,
// none (or an id the caller cannot see) leaves the field empty.
import { uuid } from "@/lib/schemas/common";
import type { TenantContext } from "@/lib/auth/types";
import { findEntity, normalizeLabel, searchEntities, type EntityScope } from "./entities";
import type { ClassifiedTask, EntityOption, EntityType } from "./types";

export type Values = Record<string, unknown>;

/** Candidates shown on the card when a value matched several records. */
export const MAX_CANDIDATES = 5;

const segments = (pointer: string): string[] => pointer.split("/").slice(1);

/** Concrete pointers that hold a value for a pattern: "/records/*\/studentId" → "/records/0/studentId", … */
export function concretePaths(values: unknown, pattern: string): string[] {
  const walk = (node: unknown, segs: readonly string[], prefix: string): string[] => {
    if (segs.length === 0) return node === undefined ? [] : [prefix];
    if (node === null || typeof node !== "object") return [];
    const [head, ...rest] = segs;
    if (head === "*") return Array.isArray(node) ? node.flatMap((item, i) => walk(item, rest, `${prefix}/${i}`)) : [];
    if (Array.isArray(node) || !Object.hasOwn(node, head!)) return [];
    return walk((node as Values)[head!], rest, `${prefix}/${head}`);
  };
  return walk(values, segments(pattern), "");
}

/** "/records/3/studentId" → "/records/*\/studentId". */
export function patternOf(pointer: string): string {
  return pointer.replace(/\/\d+(?=\/|$)/g, "/*");
}

export function getAt(values: unknown, pointer: string): unknown {
  let node = values;
  for (const seg of segments(pointer)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Values)[seg];
  }
  return node;
}

/** Deletes a concrete pointer in place (callers pass their own clone). */
function deleteAt(root: Values, pointer: string): void {
  const segs = segments(pointer);
  const last = segs.pop();
  const parent = getAt(root, segs.length ? `/${segs.join("/")}` : "");
  if (last === undefined || parent === null || typeof parent !== "object") return;
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete (parent as Values)[last];
}

function setAt(root: Values, pointer: string, value: unknown): void {
  const segs = segments(pointer);
  const last = segs.pop();
  const parent = getAt(root, segs.length ? `/${segs.join("/")}` : "");
  if (last !== undefined && parent !== null && typeof parent === "object") (parent as Values)[last] = value;
}

/** A copy without every value at these patterns (human-only, generated and context fields). */
export function withoutPaths(values: Values, patterns: readonly string[]): Values {
  const out = structuredClone(values);
  for (const pattern of patterns) {
    // Deepest and last indexes first so a splice never shifts a pointer still to delete.
    for (const pointer of concretePaths(out, pattern).reverse()) {
      const key = segments(pointer).at(-1);
      const parent = getAt(out, pointer.slice(0, pointer.lastIndexOf("/")));
      if (Array.isArray(parent)) setAt(out, pointer, undefined);
      else if (key !== undefined) deleteAt(out, pointer);
    }
  }
  return out;
}

export interface Resolution {
  values: Values;
  resolved: Record<string, EntityOption>;
  candidates: Record<string, EntityOption[]>;
}

type Outcome = { option: EntityOption } | { candidates: EntityOption[] } | null;

/** One value to one record: a uuid must be readable by the caller; text must match one label. */
export async function resolveOne(ctx: TenantContext, entity: EntityType, raw: string, scope: EntityScope = {}): Promise<Outcome> {
  const value = raw.trim();
  if (!value) return null;
  if (uuid.safeParse(value).success) {
    const option = await findEntity(ctx, entity, value, scope);
    return option ? { option } : null;
  }
  const options = await searchEntities(ctx, entity, value, scope);
  const exact = options.filter((o) => normalizeLabel(o.label) === normalizeLabel(value));
  if (exact.length === 1) return { option: exact[0]! };
  if (options.length === 1) return { option: options[0]! };
  return options.length > 1 ? { candidates: options.slice(0, MAX_CANDIDATES) } : null;
}

const SCOPE_KEYS = ["classSectionId", "gradeId", "subjectId"] as const;

function scopeOf(values: Values): EntityScope {
  const scope: Record<string, string> = {};
  for (const key of SCOPE_KEYS) {
    const v = values[key];
    if (typeof v === "string" && uuid.safeParse(v).success) scope[key] = v;
  }
  return scope;
}

/**
 * Resolves every entity field of a task in schema order (a section before its
 * subject before its unit, so each narrows the next). `known` holds pointers a
 * server expander already read under RLS (a roster); they are kept as given.
 * Context fields are removed: the server fills them, never the model.
 */
export async function resolveEntities(
  ctx: TenantContext,
  task: Pick<ClassifiedTask, "entities">,
  input: Values,
  known: Readonly<Record<string, EntityOption>> = {},
): Promise<Resolution> {
  const values = structuredClone(input);
  const resolved: Record<string, EntityOption> = { ...known };
  const candidates: Record<string, EntityOption[]> = {};
  const memo = new Map<string, Promise<Outcome>>();
  const lookup = (entity: EntityType, raw: string) => {
    const key = `${entity}\u0000${raw}\u0000${JSON.stringify(scopeOf(values))}`;
    if (!memo.has(key)) memo.set(key, resolveOne(ctx, entity, raw, scopeOf(values)));
    return memo.get(key)!;
  };

  for (const [pattern, entity] of Object.entries(task.entities)) {
    for (const pointer of concretePaths(values, pattern).reverse()) {
      if (entity === "context") {
        deleteAt(values, pointer);
        continue;
      }
      if (known[pointer]) continue;
      const raw = getAt(values, pointer);
      if (Array.isArray(raw)) {
        const kept: string[] = [];
        for (const [i, item] of raw.entries()) {
          const outcome = typeof item === "string" ? await lookup(entity, item) : null;
          if (outcome && "option" in outcome && !kept.includes(outcome.option.id)) {
            resolved[`${pointer}/${kept.length}`] = outcome.option;
            kept.push(outcome.option.id);
          } else if (outcome && "candidates" in outcome) candidates[`${pointer}/${i}`] = outcome.candidates;
        }
        if (kept.length) setAt(values, pointer, kept);
        else deleteAt(values, pointer);
        continue;
      }
      const outcome = typeof raw === "string" ? await lookup(entity, raw) : null;
      if (outcome && "option" in outcome) {
        setAt(values, pointer, outcome.option.id);
        resolved[pointer] = outcome.option;
      } else {
        if (outcome) candidates[pointer] = outcome.candidates;
        deleteAt(values, pointer);
      }
    }
  }
  return { values, resolved, candidates };
}
