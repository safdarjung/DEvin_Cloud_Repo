import type { SeedContext } from "../lib/context.ts";

// TODO(T-013): 12 grades x 6 sections = 72 (capacity 45), class teachers,
// subjects by grade group, subject assignments, enrolments with roll
// numbers, 4 curriculum units per subject per grade (05 §8).
export async function run(_ctx: SeedContext): Promise<void> {}
