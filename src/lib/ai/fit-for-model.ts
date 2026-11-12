// A tool result as JSON of at most `max` characters for the model. Cutting the JSON text at the cap
// lost the totals after a long list and gave no sign anything was missing ("25 students" when the list
// held 50). Here every scalar field is kept, the longest lists are shortened item by item, and a
// "truncated" note saying how many items are shown comes first. Pure.
type Obj = Record<string, unknown>;

const size = (v: unknown): number => (JSON.stringify(v) ?? "null").length;

export function fitForModel(data: unknown, max: number): string {
  const full = JSON.stringify(data) ?? "null";
  if (full.length <= max) return full;

  // Top-level lists only; a bare array is treated as { rows: [...] }.
  const root: Obj = Array.isArray(data) ? { rows: data } : data !== null && typeof data === "object" ? { ...(data as Obj) } : {};
  const lists = Object.keys(root).filter((k) => Array.isArray(root[k]));
  if (lists.length === 0) return `${full.slice(0, Math.max(0, max - 60))}…[cut: result too long, ask a narrower question]`;

  const total = Object.fromEntries(lists.map((k) => [k, (root[k] as unknown[]).length]));
  const kept: Obj = { ...root };
  const build = (): Obj => {
    const notes = lists.filter((k) => (kept[k] as unknown[]).length < (total[k] as number)).map((k) => `${k}: showing ${(kept[k] as unknown[]).length} of ${total[k]}`);
    return notes.length ? { truncated: `${notes.join("; ")}. Totals are for all items; ask with a filter (class, name) for the rest.`, ...kept } : kept;
  };
  // Shorten the largest list a little at a time until the whole result fits.
  for (let guard = 0; guard < 2000 && size(build()) > max; guard++) {
    const longest = lists.reduce((a, b) => (size(kept[a]) >= size(kept[b]) ? a : b));
    const arr = kept[longest] as unknown[];
    if (arr.length === 0) break;
    kept[longest] = arr.slice(0, Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * 0.85))));
  }
  const out = JSON.stringify(build());
  return out.length <= max ? out : `${out.slice(0, Math.max(0, max - 60))}…[cut: result too long, ask a narrower question]`;
}
