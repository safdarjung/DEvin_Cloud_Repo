// Pure YYYY-MM-DD helpers for the roster week view (UTC arithmetic, no timezone drift).
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => toIso(new Date(toDate(iso).getTime() + n * 86_400_000));

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const dow = (toDate(iso).getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  return addDays(iso, -dow);
}

export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));
