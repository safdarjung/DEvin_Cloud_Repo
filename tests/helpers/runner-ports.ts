// Runner sweeps (reports, insights, forecasts, late fees, workflows, …) enqueue real jobs for every
// institution with the module on — including the seeded demo tenant. A db test that runs the real
// runner for its own job must not mutate shared seed data, so it turns sweeps off except the ones
// it is actually testing.
export function withoutSweeps<T extends object>(ports: T, keep: readonly string[] = []): T {
  const out = { ...ports } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (key.startsWith("enqueue") && !keep.includes(key)) out[key] = async () => 0;
  }
  return out as T;
}
