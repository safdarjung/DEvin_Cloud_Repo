// Pure: default promotion target for each from-section (next grade, same section name; none = graduates).
export interface MapSection {
  id: string;
  name: string;
  gradeSortKey: number;
}

export function suggestTargets(from: MapSection[], to: MapSection[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of from) {
    const higher = to.filter((t) => t.gradeSortKey > f.gradeSortKey);
    if (higher.length === 0) {
      out[f.id] = null;
      continue;
    }
    const nextKey = Math.min(...higher.map((t) => t.gradeSortKey));
    const inNext = higher.filter((t) => t.gradeSortKey === nextKey).sort((a, b) => a.name.localeCompare(b.name));
    out[f.id] = (inNext.find((t) => t.name === f.name) ?? inNext[0]).id;
  }
  return out;
}
