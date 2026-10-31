// Deterministic PRNG for Fabric fixtures (same algorithm as scripts/seed/lib
// mulberry32; duplicated because src/ must not import scripts/).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next: () => number;
  int: (min: number, max: number) => number; // inclusive
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
  id: (prefix: string, n: number) => string;
}

export function rng(seed = 7): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    id: (prefix, n) => `${prefix}-${String(n).padStart(4, "0")}`,
  };
}

export interface FixtureOpts {
  seed?: number;
  now: Date;
  institutionId: string;
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

export const INDIAN_FIRST_NAMES = ["Aarav","Vivaan","Aditya","Vihaan","Arjun","Sai","Reyansh","Ishaan","Kabir","Rohan","Ananya","Diya","Aadhya","Saanvi","Myra","Kiara","Riya","Ira","Meera","Zara","Priya","Neha","Kavya","Tara"] as const;
export const INDIAN_LAST_NAMES = ["Sharma","Verma","Reddy","Nair","Iyer","Patel","Singh","Gupta","Khan","Joshi","Menon","Rao","Das","Pillai","Bose","Mehta"] as const;
export const SECTION_LABELS = ["VI-A","VI-B","VII-A","VII-B","VIII-A","VIII-B","IX-A","IX-B","X-A","X-B","XI-A","XII-A"] as const;
export const SUBJECTS = ["Mathematics","Science","English","Hindi","Social Science","Computer Science"] as const;
