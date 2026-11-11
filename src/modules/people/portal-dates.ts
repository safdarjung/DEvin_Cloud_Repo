// Date helpers shared by the portal timetable / library / exams pages and the "My day" card.
// "Today" itself comes from todayInInstitutionTimezone (attendance/queries); these only format or diff it.
const TZ = "Asia/Kolkata";
const DAY_MS = 86_400_000;
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const portalDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
export const portalTime = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

/** YYYY-MM-DD in IST for a timestamp. */
export const istDay = (d: Date | string): string => isoDay.format(new Date(d));
/** "HH:MM" in IST right now. */
export const istNowHHMM = (): string => hhmm.format(new Date());
/** Weekday 0=Sun..6=Sat of a YYYY-MM-DD date. */
export const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();
/** Whole days from `fromIso` to `toIso` (both YYYY-MM-DD). */
export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
/** Date-only value (YYYY-MM-DD) formatted for display. */
export const fmtIsoDate = (iso: string): string => portalDate.format(new Date(`${iso}T00:00:00Z`));
export const countdown = (days: number): string => (days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`);
