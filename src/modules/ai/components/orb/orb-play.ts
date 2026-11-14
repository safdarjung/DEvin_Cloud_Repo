// Pure helpers for the orb's play: the "Surprise me" pick, the particle burst on a press or a
// finished answer, and the constellation lines between a hot dot and the rest of its section.

/** A random key, never the last one while another exists; null when there is none. */
export function pickSurprise(keys: readonly string[], last: string | null, rand: () => number): string | null {
  const pool = keys.length > 1 ? keys.filter((k) => k !== last) : keys;
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? null;
}

export interface Particle {
  /** Where it ends, as a share of the burst's radius (0.55..1). */
  dx: number;
  dy: number;
  /** Diameter (px) and start delay (s). */
  size: number;
  delay: number;
}

/** n particles evenly round a circle with a little seeded jitter, so the same press draws the same burst. */
export function burstParticles(n: number, seed: number): Particle[] {
  const jitter = (i: number, k: number) => {
    const s = Math.sin((i + 1) * 12.9898 + seed * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + 0.6 * jitter(i, 0)) / n) * 2 * Math.PI;
    const d = 0.55 + 0.45 * jitter(i, 1);
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, size: 3 + 4 * jitter(i, 2), delay: 0.06 * jitter(i, 3) };
  });
}

/** One SVG line from the hot dot to each dot of its section (stage px, origin at the centre). */
export function constellationPath(hot: readonly [number, number], kin: readonly (readonly [number, number])[]): string {
  const h = `M${hot[0].toFixed(1)} ${hot[1].toFixed(1)}`;
  return kin.map((k) => `${h}L${k[0].toFixed(1)} ${k[1].toFixed(1)}`).join("");
}
