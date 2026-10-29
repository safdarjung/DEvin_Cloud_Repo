export type SeedScale = "full" | "small";

export function getSeedScale(): SeedScale {
  return process.env.SEED_SCALE === "small" ? "small" : "full";
}

// 05 §8: full = 6 sections/grade; small (CI only) = 2, but every named
// demo entity in §8.1 must still exist.
export const SECTIONS_PER_GRADE: Record<SeedScale, number> = {
  full: 6,
  small: 2,
};
