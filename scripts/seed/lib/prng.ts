// Deterministic PRNG for the seed (05 §8: "every run produces identical
// ids... names, and numbers"). Public-domain mulberry32 — not
// cryptographic, reruns must be bit-identical, nothing here needs
// cryptographic strength.
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_PRNG_SEED = 20261028;
