// Shared helpers for server-side list search + pagination (PostgREST .or() / .range()).

export const LIST_PAGE_SIZE = 50;

/** ILIKE treats `%`/`_` as wildcards; escape them so "A_1" or "100%" is literal. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Wrap a value in double quotes so `,` `(` `)` inside it cannot split a PostgREST `.or()` string. */
export function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `%term%` pattern, escaped and quoted for use inside `.or()`. */
export function ilikeTerm(term: string): string {
  return quoteOrValue(`%${escapeIlike(term.trim())}%`);
}

/** Coerce a `?page=` query param to a safe 1-based page number. */
export function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Inclusive [from, to] row range for `.range()`. */
export function pageRange(page: number, size = LIST_PAGE_SIZE): [number, number] {
  const from = (page - 1) * size;
  return [from, from + size - 1];
}

export interface PageResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
