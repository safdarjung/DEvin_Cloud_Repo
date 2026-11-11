// Pure paise helpers for the fee-plan forms: user text -> integer paise, even instalment split. No float maths.

/** "1500", "1500.5", "1500.50" -> paise; null when not a plain rupee amount. */
export function rupeesTextToPaise(text: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Paise -> the "1500.50" string the action schemas take as a number. */
export function paiseToRupeesText(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/** Split `totalPaise` into `parts` near-equal integers (earlier parts take the remainder); sums exactly to the total. */
export function splitPaise(totalPaise: number, parts: number): number[] {
  const base = Math.floor(totalPaise / parts);
  const extra = totalPaise - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}
