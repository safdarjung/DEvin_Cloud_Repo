export const BOTTOM_NAV_MAX = 5;

interface HrefItem {
  href: string;
}

/**
 * Bottom bar slots: all items when they fit, otherwise the first
 * `max - 1` (nav.ts order is priority order) plus a "More" drawer slot.
 */
export function selectBottomNav<T extends HrefItem>(items: readonly T[], max = BOTTOM_NAV_MAX): { primary: T[]; hasMore: boolean } {
  if (items.length <= max) return { primary: [...items], hasMore: false };
  return { primary: items.slice(0, max - 1), hasMore: true };
}

/** Longest matching href wins so /exams/rechecks doesn't also light up /exams. */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | undefined {
  return hrefs
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
}
