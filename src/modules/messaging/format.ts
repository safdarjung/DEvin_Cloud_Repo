const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Message timestamp in IST, e.g. "6 Nov, 3:05 pm". */
export function formatIst(iso: string): string {
  return IST.format(new Date(iso));
}
